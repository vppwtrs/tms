-- หลายคนต่อหนึ่งเที่ยว — รับงานแยกรายคน ปิดเที่ยวเฉพาะคนขับหลัก
--
-- ฐานรองรับหลายคนมาตั้งแต่ trip_drivers (20260818130000) และ import_tms_trip รับ
-- p_driver_ids ได้แล้ว (20260818350000) แต่ "การรับงาน" ยังเป็นของเที่ยว ไม่ใช่ของคน
-- คนแรกที่กดรับ = ทั้งเที่ยวถือว่ารับแล้ว ผู้ช่วยที่ยังไม่ได้ขึ้นรถก็ถูกนับว่ารับด้วย
-- กระดานจึงบอกไม่ได้ว่าคนครบหรือยัง ซึ่งเป็นคำถามแรกของคนวางแผนทุกเช้า
--
-- กติกาที่เจ้าของระบบเคาะ: ปิดเที่ยวได้เฉพาะคนขับหลัก
-- ผู้ช่วยยังปิดจุดส่งและเก็บ POD ได้ตามเดิม (นั่นคือเหตุผลที่เขาไปด้วย)
-- แต่การประกาศว่า "เที่ยวนี้จบแล้ว" เป็นของคนที่รับผิดชอบเที่ยว
--
-- trips.accepted_at ยังอยู่ในฐานะ "เที่ยวนี้เริ่มถูกรับแล้ว" — ประตูเดิมไม่เปลี่ยน
-- ของใหม่คือ trip_drivers.accepted_at ที่ตอบว่า "ใครรับแล้วบ้าง"

/* ---------- 1) รับงานเป็นรายคน ---------- */

alter table public.trip_drivers
  add column if not exists accepted_at timestamptz;

comment on column public.trip_drivers.accepted_at is
  'คนนี้กดรับงานเมื่อไหร่ — null = ยังไม่รับ ต่างจาก trips.accepted_at ที่เป็นของทั้งเที่ยว';

/* เที่ยวที่ถูกรับไปแล้วก่อนมีคอลัมน์นี้ ถือว่าทุกคนในเที่ยวรับแล้ว
   ไม่ใช่ความจริงทั้งหมด แต่ทางเลือกอีกทางคือทำให้เที่ยวที่กำลังวิ่งอยู่จริง
   กลายเป็น "ยังไม่มีใครรับ" กลางคัน ซึ่งแย่กว่ามาก */
update public.trip_drivers td
   set accepted_at = t.accepted_at
  from public.trips t
 where t.id = td.trip_id
   and t.accepted_at is not null
   and td.accepted_at is null;

/* ---------- 2) เพดาน 6 คนต่อเที่ยว บังคับที่ฐาน ---------- */

-- ไม่ใช่กฎเชิงนโยบาย — รถกระบะนั่งได้ 6 คน เที่ยวที่มี 12 คนคือข้อมูลผิด
-- ไม่ใช่งานจริง และมันเกิดจากการกดซ้ำหรือจับคู่ชื่อผิด ซึ่งเคยเกิดมาแล้ว
create or replace function app.trip_drivers_cap()
returns trigger
language plpgsql
as $fn$
begin
  if (select count(*) from public.trip_drivers where trip_id = new.trip_id) > 6 then
    raise exception 'เที่ยวหนึ่งมีพนักงานขับได้ไม่เกิน 6 คน' using errcode = 'P0001';
  end if;
  return null;
end;
$fn$;

drop trigger if exists trip_drivers_cap on public.trip_drivers;
create constraint trigger trip_drivers_cap
  after insert on public.trip_drivers
  deferrable initially immediate
  for each row execute function app.trip_drivers_cap();

/* ---------- 3) ใครปิดเที่ยว ---------- */

alter table public.trips
  add column if not exists closed_by bigint references public.drivers (id) on delete set null;

comment on column public.trips.closed_by is
  'คนขับที่กดปิดเที่ยว — ตอนนี้ปิดได้เฉพาะคนขับหลัก แต่บันทึกไว้เพื่อให้ตรวจย้อนหลังได้';

/* คนขับหลักของเที่ยว — trips.driver_id เป็นตัวหลัก ถอยไปใช้ seq ต่ำสุดใน trip_drivers
   สำหรับเที่ยวเก่าที่ driver_id หลุด (เช่นบัญชีคนขับถูกลบ) */
create or replace function app.trip_primary_driver(p_trip_id bigint)
returns bigint
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select t.driver_id from public.trips t where t.id = p_trip_id),
    (select td.driver_id from public.trip_drivers td
      where td.trip_id = p_trip_id
      order by td.seq, td.driver_id
      limit 1)
  );
$fn$;

/* "รับแล้ว 2/3" — กระดานกับหน้าคนขับถามคำถามเดียวกัน ใช้ฟังก์ชันเดียวกัน
   ต้องประกาศก่อน accept_trip เพราะ accept_trip เรียกตัวนี้ */
create or replace function public.trip_accept_state(p_trip_id bigint)
returns json
language sql
stable
security definer
set search_path = public
as $fn$
  /* security definer ข้าม RLS ของ trip_drivers จึงต้องตรวจสิทธิ์เอง
     คนขับเห็นได้เฉพาะเที่ยวที่ตัวเองอยู่ในนั้น ไม่ใช่ทุกเที่ยวในระบบ */
  select json_build_object(
    'drivers',  count(*)::int,
    'accepted', count(*) filter (where accepted_at is not null)::int
  )
  from public.trip_drivers td
  where td.trip_id = p_trip_id
    and (app.has_perm('dispatch.view')
         or exists (select 1 from public.trip_drivers m
                     where m.trip_id = p_trip_id
                       and m.driver_id = app.current_driver_id()));
$fn$;

/* ---------- 4) accept_trip บันทึกรายคน ---------- */

create or replace function public.accept_trip(p_trip_id bigint)
returns json
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_me    bigint := app.current_driver_id();
  v_trip  public.trips;
  v_tms   int;
  v_mine  boolean;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  v_mine := v_trip.driver_id = v_me
         or exists (select 1 from public.trip_drivers td
                     where td.trip_id = p_trip_id and td.driver_id = v_me);
  if not v_mine then
    raise exception 'เที่ยวนี้ไม่ใช่งานของคุณ' using errcode = '42501';
  end if;

  /* แถวของตัวเองอาจไม่มี ถ้าเป็นคนขับหลักของเที่ยวเก่าที่ยังไม่ถูกเติมเข้า trip_drivers */
  insert into public.trip_drivers as td (trip_id, driver_id, seq, accepted_at)
  values (p_trip_id, v_me, 1, now())
  on conflict (trip_id, driver_id) do update
    set accepted_at = coalesce(td.accepted_at, now());

  if v_trip.accepted_at is not null then
    /* เที่ยวถูกรับไปแล้วโดยคนอื่น แต่การรับของ "คนนี้" เพิ่งเกิดขึ้นจริง
       จึงไม่ใช่ already ทั้งก้อนเหมือนเดิม — หน้าจอต้องเปลี่ยนปุ่มให้เขาด้วย */
    return json_build_object('trip_id', p_trip_id, 'already', true,
                             'accepted', public.trip_accept_state(p_trip_id));
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

  return json_build_object('trip_id', p_trip_id, 'already', false,
                           'accepted', public.trip_accept_state(p_trip_id));
end;
$fn$;

/* ---------- 5) ปิดเที่ยวเฉพาะคนขับหลัก ---------- */

create or replace function public.complete_trip(p_trip_id bigint)
returns void
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_pending integer;
  v_me      bigint := app.current_driver_id();
  v_primary bigint;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  if not exists (select 1 from public.trips where id = p_trip_id) then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  v_primary := app.trip_primary_driver(p_trip_id);

  /* ข้อความต้องแยกสองกรณีให้ขาด: "ไม่ใช่งานของคุณ" กับ "เป็นงานของคุณแต่คุณไม่ใช่คนหลัก"
     ถ้าพูดเหมือนกัน ผู้ช่วยจะคิดว่าระบบลืมเขาแล้วโทรหาออฟฟิศ */
  if v_primary is distinct from v_me then
    if exists (select 1 from public.trip_drivers td
                where td.trip_id = p_trip_id and td.driver_id = v_me) then
      raise exception 'ปิดเที่ยวได้เฉพาะคนขับหลัก — จุดส่งที่คุณปิดไว้ถูกบันทึกแล้ว'
        using errcode = 'P0001';
    end if;
    raise exception 'ไม่พบเที่ยวนี้ หรือไม่ใช่เที่ยวของคุณ' using errcode = 'P0002';
  end if;

  select count(*) into v_pending
    from public.orders o
   where o.trip_id = p_trip_id
     and o.status not in ('delivered', 'cancelled');

  if v_pending > 0 then
    raise exception 'ยังส่งไม่ครบ เหลืออีก % จุด', v_pending using errcode = 'P0001';
  end if;

  update public.trips
     set status = 'completed',
         arrived_at = coalesce(arrived_at, now()),
         closed_by = v_me
   where id = p_trip_id and status = 'in_progress';

  if not found then
    raise exception 'ปิดได้เฉพาะเที่ยวที่กำลังวิ่งอยู่' using errcode = 'P0001';
  end if;

  update public.drivers set status = 'available'
   where id in (select driver_id from public.trip_drivers where trip_id = p_trip_id)
      or id = v_me;

  update public.vehicles v set status = 'available'
    from public.trips t
   where t.id = p_trip_id and v.id = t.vehicle_id;
end;
$fn$;

/* ---------- 6) หน้าคนขับต้องรู้ว่าตัวเองรับหรือยัง และเป็นคนหลักไหม ---------- */

-- คอลัมน์ใหม่ต่อท้ายเท่านั้น (42P16) — แทรกกลางต้อง drop view ซึ่งพาลทิ้ง grant ไปด้วย
create or replace view public.my_trips as
  select t.id, t.trip_no, t.status, t.departed_at, t.arrived_at, t.notes,
         v.plate_no, v.vehicle_type,
         t.accepted_at, t.issue_note, t.issue_at,
         /* ของคนที่กำลังเปิดแอปอยู่ ไม่ใช่ของทั้งเที่ยว */
         (select td.accepted_at from public.trip_drivers td
           where td.trip_id = t.id and td.driver_id = app.current_driver_id()) as my_accepted_at,
         (t.driver_id = app.current_driver_id()) as is_primary,
         (select count(*)::int from public.trip_drivers td where td.trip_id = t.id) as driver_count,
         (select count(*)::int from public.trip_drivers td
           where td.trip_id = t.id and td.accepted_at is not null) as accepted_count
    from public.trips t
    join public.vehicles v on v.id = t.vehicle_id
   where app.has_perm('myjobs.view')
     and (
       t.driver_id = app.current_driver_id()
       or exists (
         select 1 from public.trip_drivers td
          where td.trip_id = t.id and td.driver_id = app.current_driver_id()
       )
     );

grant select on public.my_trips to authenticated;

/* ---------- 7) เตือนคนซ้ำในวันเดียวกัน ---------- */

-- คนวางแผนเลือกคนขับจากรายชื่อ ซึ่งไม่บอกว่าคนนั้นถูกจ่ายไปเที่ยวอื่นของวันเดียวกันแล้ว
-- เตือน ไม่ห้าม — วันที่รถเสียแล้วต้องสลับคนกลางวัน การห้ามคือการบังคับให้เลี่ยงระบบ
create or replace function public.drivers_busy_on(p_date date, p_driver_ids bigint[])
returns json
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_out json;
begin
  /* ตอบเฉพาะคนที่จัดเที่ยวได้ — รายชื่อ "ใครติดงานอะไรวันนี้" คือข้อมูลของฝ่ายวางแผน
     security definer ข้าม RLS จึงต้องกันเองตรงนี้ */
  if not (app.has_perm('dispatch.view') or app.has_perm('dispatch.write')) then
    raise exception 'ไม่มีสิทธิ์ดูตารางงานของพนักงานขับ' using errcode = '42501';
  end if;

  select coalesce(json_agg(json_build_object(
           'driver_id', x.driver_id,
           'driver_name', x.name,
           'trip_id', x.trip_id,
           'trip_no', x.trip_no,
           'status', x.status
         ) order by x.name, x.trip_no), '[]'::json)
    into v_out
    from (
      select distinct td.driver_id, d.name, t.id as trip_id, t.trip_no, t.status
        from public.trip_drivers td
        join public.trips t on t.id = td.trip_id
        join public.drivers d on d.id = td.driver_id
        /* วันของงานคือ order_date ที่ TMS ให้มา ไม่ใช่วันที่แถวถูกสร้าง
           และไม่ใช่ departed_at::date ซึ่งเป็น timestamptz — cast บนเซิร์ฟเวอร์ที่เป็น UTC
           จะตัดวันคลาดไป 7 ชั่วโมง เที่ยวเย็นของไทยจึงถูกนับเป็นของวันถัดไป
           เที่ยวที่สร้างเองในระบบไม่มีแถวใน tms_trips ถอยไปใช้ created_at */
        left join public.tms_trips x2 on x2.trip_id = t.id
       where td.driver_id = any(coalesce(p_driver_ids, '{}'::bigint[]))
         and t.status in ('planned', 'in_progress')
         and coalesce(x2.order_date, t.created_at::date) = coalesce(p_date, current_date)
    ) x;

  return v_out;
end;
$fn$;

revoke all on function public.drivers_busy_on(date, bigint[]) from public;
grant execute on function public.drivers_busy_on(date, bigint[]) to authenticated;
grant execute on function public.trip_accept_state(bigint) to authenticated;
/* ไม่ grant app.trip_primary_driver ให้ authenticated — complete_trip เรียกมันในฐานะ
   security definer อยู่แล้ว การเปิดให้เรียกตรงคือแจกวิธีถามว่าเที่ยวไหนใครคุมฟรี ๆ */
