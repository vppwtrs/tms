-- ประตูรับงานของคนขับ — จุดหยุดที่ระบบไม่เคยมี
--
-- ปัญหา: การนำเข้าเป็นอัตโนมัติทั้งเส้น เที่ยวจาก TMS กลายเป็นงานในระบบทันที
-- และ sync_tms_trip_status ยังดันสถานะตาม TMS ทุกรอบ เที่ยวจึงเดินจาก
-- "วางแผน" ไป "กำลังวิ่ง" ไป "จบ" ได้เองโดยที่คนขับไม่เคยแตะอะไรเลยสักครั้ง
-- แอปฝั่งคนขับจึงไม่มีความหมาย — งานผ่านหน้าเขาไปโดยไม่มีจังหวะให้รับ
--
-- ทางแก้: accepted_at เป็นประตู ไม่ใช่สถานะใหม่
--  * เพิ่มค่าใน enum trip_status ต้องไปไล่แก้ทุก case ที่ map สถานะ และของเก่าทุกแถว
--  * ประตูเป็นคนละแกนกับสถานะจริง ๆ อยู่แล้ว: "ถึงมือคนขับหรือยัง" กับ
--    "งานเดินไปถึงไหน" เป็นคำถามคนละข้อ เอามารวมเป็นแกนเดียวจะอธิบายยากกว่า
--
-- เจ้าของงานเคาะแล้ว: คนขับ "รับทราบ" อย่างเดียว ปฏิเสธไม่ได้ (TMS จ่ายคนมาแล้ว
-- และ tms-gateway เขียนกลับ TMS ไม่ได้ตามข้อตกลง) แต่แจ้งปัญหาให้คนวางแผนเห็นได้
-- และ TMS ต้องไม่ดันสถานะข้ามประตูนี้

alter table public.trips
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by bigint references public.drivers (id),
  add column if not exists issue_note  text,
  add column if not exists issue_at    timestamptz;

comment on column public.trips.accepted_at is
  'คนขับกดรับงานเมื่อไหร่ — null บนเที่ยวที่ยังไม่จบ = ยังไม่ถึงมือคนขับ';
comment on column public.trips.issue_note is
  'ปัญหาที่คนขับแจ้ง — ไม่ใช่การปฏิเสธงาน งานยังเป็นของเขาจนกว่าคนวางแผนจะจัดการ';

/* เที่ยวที่จบไปแล้วไม่มีอะไรให้รับ ปล่อยไว้จะกลายเป็นค้างในช่อง "รอคนขับรับ" ตลอดกาล
   ใช้เวลาถึงปลายทางเป็นเวลารับ เพราะเป็นเวลาเดียวที่รู้ว่างานผ่านมือคนขับจริง */
update public.trips
   set accepted_at = coalesce(arrived_at, departed_at, created_at),
       accepted_by = driver_id
 where accepted_at is null
   and status in ('completed', 'cancelled');

-- คนขับกดรับงาน
create or replace function public.accept_trip(p_trip_id bigint)
returns json
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_me   bigint := app.current_driver_id();
  v_trip public.trips;
  v_tms  int;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  if v_trip.driver_id is distinct from v_me
     and not exists (select 1 from public.trip_drivers td
                      where td.trip_id = p_trip_id and td.driver_id = v_me) then
    raise exception 'เที่ยวนี้ไม่ใช่งานของคุณ' using errcode = '42501';
  end if;

  if v_trip.accepted_at is not null then
    return json_build_object('trip_id', p_trip_id, 'already', true);
  end if;

  /* รับแล้วค่อยให้สถานะจาก TMS ที่ค้างอยู่มีผล — ระหว่างที่ยังไม่รับ
     sync_tms_trip_status ถูกกันไว้ ไม่งั้นงานจะวิ่งข้ามหัวคนขับไปเอง */
  select status_id into v_tms from public.tms_trips where trip_id = p_trip_id;

  update public.trips
     set accepted_at = now(),
         accepted_by = v_me,
         status = case
           when status = 'planned' and coalesce(v_tms, 0) in (3, 4) then 'in_progress'
           else status
         end,
         departed_at = case
           when status = 'planned' and coalesce(v_tms, 0) in (3, 4)
           then coalesce(departed_at, now())
           else departed_at
         end
   where id = p_trip_id;

  return json_build_object('trip_id', p_trip_id, 'already', false);
end;
$fn$;

-- คนขับแจ้งปัญหา — ไม่ใช่การปฏิเสธ งานยังเป็นของเขา
create or replace function public.report_trip_issue(p_trip_id bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_me bigint := app.current_driver_id();
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'กรุณาระบุปัญหา' using errcode = 'P0002';
  end if;

  update public.trips
     set issue_note = btrim(p_note), issue_at = now()
   where id = p_trip_id
     and (driver_id = v_me
          or exists (select 1 from public.trip_drivers td
                      where td.trip_id = id and td.driver_id = v_me));

  if not found then
    raise exception 'เที่ยวนี้ไม่ใช่งานของคุณ' using errcode = '42501';
  end if;
end;
$fn$;

-- คนวางแผนเคลียร์ปัญหาที่คุยจบแล้ว
create or replace function public.clear_trip_issue(p_trip_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;
  update public.trips set issue_note = null, issue_at = null where id = p_trip_id;
end;
$fn$;

grant execute on function public.accept_trip(bigint)              to authenticated;
grant execute on function public.report_trip_issue(bigint, text)  to authenticated;
grant execute on function public.clear_trip_issue(bigint)         to authenticated;
