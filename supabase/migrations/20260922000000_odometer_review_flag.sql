-- เลขไมล์ที่ดูผิดปกติ: ถามยืนยันก่อน แล้วบันทึกแบบรอแอดมินตรวจ แทนการบล็อกตาย
--
-- เหตุการณ์ 22 ก.ย. 2569: TMS บริษัทใส่ทะเบียนผิด เลขของ NAVARA (62,752) จึงไปอยู่ที่ 4ฒญ9845
-- คนขับกรอกเลขจริง (~7,590) โดนปฏิเสธว่า "น้อยกว่าครั้งก่อน" 36 ครั้งตลอด 5 ชั่วโมง
-- สุดท้ายไปอ่านหน้าปัดรถ KIA คันข้าง ๆ (187,471) มากรอกเพื่อให้ผ่าน แล้วจบงานไม่ได้อีกรอบ
--
-- สองรูรั่ว:
--   1. คนขับไม่มีทางออก — ด่านเดียวที่มีคือ "ห้ามถอยหลัง" และมันเชื่อข้อมูลเก่าที่อาจผิดเอง
--   2. ด่านกันแค่ถอยหลัง เลขที่กระโดดขึ้นเป็นแสนผ่านได้เงียบ ๆ
--
-- ทางแก้: ตอนออกรถไม่ตรวจอะไรเลย รับเลขตามที่คนขับอ่าน — การเริ่มงานต้องไม่ถูกขวาง
-- ตรวจตอนจบงานที่เดียว: ตอนกลับน้อยกว่าตอนออก / มากกว่าเกิน 2,000 กม. — ปฏิเสธครั้งแรก
-- ด้วยรหัส OD001 ให้จอถามยืนยัน ถ้าคนขับยืนยัน (p_force) บันทึกได้แต่ติดธง needs_review
-- เลขตอนออกรถที่ผิดจะโผล่ตรงนี้เอง เพราะผลต่างของวันติดลบหรือยาวผิดปกติ
-- แถวที่ติดธงไม่ถูกนับเป็น "เลขครั้งก่อน" ของใคร ข้อมูลผิดหนึ่งแถวจึงไม่ลามไปบล็อกวันถัดไป
-- แอดมินแก้เลข (admin_update_odometer) = ตรวจแล้ว ธงหายไปเอง

alter table public.vehicle_odometer
  add column if not exists needs_review boolean not null default false,
  add column if not exists review_note  text;

comment on column public.vehicle_odometer.needs_review is
  'คนขับยืนยันเลขที่ระบบมองว่าผิดปกติ — รอแอดมินตรวจ ไม่ถูกใช้เป็นเลขอ้างอิงของครั้งถัดไป';

/* เพดานการกระโดดต่อครั้ง — กระบะส่งของในเขตวิ่งวันละไม่กี่ร้อยกิโล
   2,000 เผื่อรถจอดไม่ได้กรอกหลายวันแล้ว แต่ยังจับเลขผิดหลักหรือผิดคันได้ทั้งหมด */
create or replace function public.log_odometer(
  p_vehicle_id bigint,
  p_reading_km integer,
  p_kind text default 'start',
  p_force boolean default false
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me    bigint := app.current_driver_id();
  v_today date   := (timezone('Asia/Bangkok', now()))::date;
  v_kind  text   := coalesce(nullif(btrim(p_kind), ''), 'start');
  v_jump  constant integer := 2000;
  v_last  integer;
  v_start integer;
  v_trip  bigint;
  v_note  text;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์บันทึกเลขไมล์' using errcode = '42501';
  end if;
  if v_me is null then
    raise exception 'บัญชีนี้ไม่ได้ผูกกับคนขับ' using errcode = 'P0001';
  end if;
  if v_kind not in ('start', 'end') then
    raise exception 'ชนิดของเลขไมล์ไม่ถูกต้อง' using errcode = 'P0001';
  end if;
  if p_reading_km is null or p_reading_km < 0 then
    raise exception 'เลขไมล์ไม่ถูกต้อง' using errcode = 'P0001';
  end if;

  /* ต้องเป็นรถที่คนขับมีงานอยู่จริง ไม่ใช่รถคันไหนก็ได้ในระบบ */
  select t.id into v_trip
    from public.trips t
   where t.vehicle_id = p_vehicle_id
     and t.status <> 'cancelled'
     and (t.driver_id = v_me
          or exists (select 1 from public.trip_drivers td
                      where td.trip_id = t.id and td.driver_id = v_me))
   order by case when t.status = 'in_progress' then 0
                 when t.status = 'returning' then 1
                 when t.status = 'planned' then 2 else 3 end,
            t.id desc
   limit 1;

  if v_trip is null then
    raise exception 'ไม่ได้รับงานของรถคันนี้' using errcode = '42501';
  end if;

  /* ตรวจเฉพาะตอนจบงาน — ตอนออกรถรับเลขตามที่คนขับอ่าน ไม่ขวางการเริ่มงานเด็ดขาด
     เลขตอนออกรถที่ผิดจะโผล่เองตอนจบ เพราะผลต่างของวันจะติดลบหรือยาวผิดปกติ
     เทียบกับเลขตอนออกรถของวันเดียวกันก่อน ไม่มีค่อยใช้เลขล่าสุดของวันก่อน ๆ
     (ข้ามแถวที่รอตรวจ มันยังไม่ใช่ความจริง) */
  if v_kind = 'end' then
    select reading_km into v_start
      from public.vehicle_odometer
     where vehicle_id = p_vehicle_id and driver_id = v_me
       and reading_date = v_today and kind = 'start';

    if v_start is null then
      select max(reading_km) into v_last
        from public.vehicle_odometer
       where vehicle_id = p_vehicle_id
         and reading_date < v_today
         and not needs_review;
    end if;

    if v_start is not null and p_reading_km < v_start then
      v_note := format('ตอนกลับน้อยกว่าตอนออกรถ (%s)', v_start);
    elsif v_start is not null and p_reading_km > v_start + v_jump then
      v_note := format('ตอนกลับมากกว่าตอนออกรถ (%s) เกิน %s กม.', v_start, v_jump);
    elsif v_last is not null and p_reading_km < v_last then
      v_note := format('น้อยกว่าครั้งก่อน (%s)', v_last);
    elsif v_last is not null and p_reading_km > v_last + v_jump then
      v_note := format('มากกว่าครั้งก่อน (%s) เกิน %s กม.', v_last, v_jump);
    end if;
  end if;

  /* OD001 = ผิดปกติแต่ยืนยันได้ จอจับรหัสนี้แล้วถามคนขับ ไม่ใช่โยน error ตาย */
  if v_note is not null and not coalesce(p_force, false) then
    raise exception 'เลขไมล์ % — อ่านเลขบนหน้าปัดอีกครั้ง', v_note
      using errcode = 'OD001', hint = 'odometer_suspect';
  end if;

  insert into public.vehicle_odometer
    (vehicle_id, driver_id, reading_km, reading_date, trip_id, kind, needs_review, review_note)
  values
    (p_vehicle_id, v_me, p_reading_km, v_today, v_trip, v_kind, v_note is not null, v_note)
  on conflict (vehicle_id, driver_id, reading_date, kind)
    do update set reading_km   = excluded.reading_km,
                  taken_at     = now(),
                  trip_id      = excluded.trip_id,
                  needs_review = excluded.needs_review,
                  review_note  = excluded.review_note;

  return json_build_object('vehicle_id', p_vehicle_id, 'reading_km', p_reading_km,
                           'kind', v_kind, 'date', v_today, 'needs_review', v_note is not null);
end;
$function$;

drop function if exists public.log_odometer(bigint, integer, text);
revoke all on function public.log_odometer(bigint, integer, text, boolean) from public;
grant execute on function public.log_odometer(bigint, integer, text, boolean) to authenticated;

/* "ครั้งก่อน" ที่โชว์ให้คนขับดู ต้องมาจากชุดเดียวกับที่ด่านใช้ ไม่งั้นจอบอกเลขหนึ่ง ฐานเทียบอีกเลข */
create or replace function public.odometer_status(p_vehicle_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me    bigint := app.current_driver_id();
  v_today date   := (timezone('Asia/Bangkok', now()))::date;
  v_start integer;
  v_end   integer;
  v_last  integer;
begin
  if not app.has_perm('myjobs.view') then
    raise exception 'ไม่มีสิทธิ์ดูเลขไมล์' using errcode = '42501';
  end if;

  select reading_km into v_start
    from public.vehicle_odometer
   where vehicle_id = p_vehicle_id and driver_id = v_me
     and reading_date = v_today and kind = 'start';

  select reading_km into v_end
    from public.vehicle_odometer
   where vehicle_id = p_vehicle_id and driver_id = v_me
     and reading_date = v_today and kind = 'end';

  select reading_km into v_last
    from public.vehicle_odometer
   where vehicle_id = p_vehicle_id and reading_date < v_today and not needs_review
   order by reading_date desc, id desc
   limit 1;

  return json_build_object('logged_today', v_start is not null,
                           'start_km', v_start,
                           'end_km', v_end,
                           'reading_km', coalesce(v_end, v_start),
                           'last_km', v_last);
end;
$function$;

/* แอดมินแก้ = ตรวจแล้ว — ล้างธงในคำสั่งเดียวกัน
   เทียบกับวันก่อนโดยข้ามแถวที่รอตรวจ เหมือนฝั่งคนขับ */
create or replace function public.admin_update_odometer(p_odometer_id bigint, p_reading_km integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row   public.vehicle_odometer%rowtype;
  v_last  integer;
  v_other integer;
begin
  if not app.has_perm('vehicles.write') then
    raise exception 'ไม่มีสิทธิ์แก้เลขไมล์' using errcode = '42501';
  end if;
  if p_reading_km is null or p_reading_km < 0 then
    raise exception 'เลขไมล์ไม่ถูกต้อง' using errcode = 'P0001';
  end if;

  select * into v_row from public.vehicle_odometer where id = p_odometer_id;
  if not found then
    raise exception 'ไม่พบรายการเลขไมล์นี้' using errcode = 'P0001';
  end if;

  select max(reading_km) into v_last
    from public.vehicle_odometer
   where vehicle_id = v_row.vehicle_id
     and reading_date < v_row.reading_date
     and not needs_review;
  if v_last is not null and p_reading_km < v_last then
    raise exception 'เลขไมล์น้อยกว่าครั้งก่อน (%)', v_last using errcode = 'P0001';
  end if;

  select reading_km into v_other
    from public.vehicle_odometer
   where vehicle_id = v_row.vehicle_id
     and driver_id = v_row.driver_id
     and reading_date = v_row.reading_date
     and kind = case v_row.kind when 'start' then 'end' else 'start' end;
  if v_other is not null then
    if v_row.kind = 'start' and p_reading_km > v_other then
      raise exception 'เลขไมล์ตอนออกรถ (%) มากกว่าตอนกลับ (%)', p_reading_km, v_other using errcode = 'P0001';
    end if;
    if v_row.kind = 'end' and p_reading_km < v_other then
      raise exception 'เลขไมล์ตอนกลับ (%) น้อยกว่าตอนออกรถ (%)', p_reading_km, v_other using errcode = 'P0001';
    end if;
  end if;

  update public.vehicle_odometer
     set reading_km = p_reading_km, needs_review = false, review_note = null
   where id = p_odometer_id;

  return json_build_object('id', p_odometer_id, 'vehicle_id', v_row.vehicle_id,
                           'reading_km', p_reading_km, 'kind', v_row.kind, 'date', v_row.reading_date);
end;
$$;

grant execute on function public.admin_update_odometer(bigint, integer) to authenticated;
