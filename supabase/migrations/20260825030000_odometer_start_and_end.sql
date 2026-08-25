-- เลขไมล์หัวท้าย ไม่ใช่วันละครั้ง
--
-- ของเดิมเก็บวันละหนึ่งเลขต่อรถต่อคนขับ ซึ่งตอบได้แค่ระยะสะสม ระยะของ "วันนี้"
-- ต้องเอาเลขวันนี้ลบเลขเมื่อวาน แปลว่าวันไหนไม่ได้กรอก วันถัดไปก็คิดไม่ได้ด้วย
-- และแยกไม่ออกว่ากิโลที่วิ่งเป็นของงานหรือของการเอารถไปใช้ระหว่างวัน
--
-- หัวท้ายตอบได้ตรง ๆ: ระยะของวัน = เลขตอนกลับ − เลขตอนเริ่ม จบในวันเดียว
-- ไม่ต้องพึ่งข้อมูลของเมื่อวาน และวันที่ขาดไปไม่ทำให้วันอื่นพัง
--
-- แลกกับการถามคนขับสองครั้งต่อวัน ซึ่งยอมรับได้เพราะทั้งสองครั้งเป็นจังหวะที่
-- คนขับยืนอยู่หน้ารถอยู่แล้ว — ตอนขึ้นรถก่อนออกงาน กับตอนจอดเข้าคลัง

/* kind บอกว่าเป็นเลขต้นวันหรือปลายวัน — ของเก่าทั้งหมดคือเลขที่กรอกตอนเริ่ม
   จึงตั้ง default เป็น start แล้วแถวเดิมได้ค่าถูกโดยไม่ต้อง backfill */
alter table public.vehicle_odometer
  add column if not exists kind text not null default 'start'
    check (kind in ('start', 'end'));

comment on column public.vehicle_odometer.kind is
  'start = เลขตอนขึ้นรถก่อนออกงาน, end = เลขตอนกลับถึงคลัง — ระยะของวันคือผลต่างของสองอันนี้';

alter table public.vehicle_odometer
  drop constraint if exists vehicle_odometer_vehicle_id_driver_id_reading_date_key;

create unique index if not exists vehicle_odometer_day_kind_idx
  on public.vehicle_odometer (vehicle_id, driver_id, reading_date, kind);

/* ---------------------------------------------------------------
   log_odometer — รับ kind เพิ่ม

   ด่านเดิมยังอยู่ครบ บวกด่านใหม่: เลขปลายวันต้องไม่น้อยกว่าเลขต้นวันของวันเดียวกัน
   รถวิ่งกลับมาแล้วเลขไมล์ลดลงไม่ได้ ถ้าลดแปลว่าอ่านผิดหรือกรอกผิดคัน
   --------------------------------------------------------------- */
create or replace function public.log_odometer(
  p_vehicle_id bigint,
  p_reading_km integer,
  p_kind text default 'start'
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
  v_last  integer;
  v_start integer;
  v_trip  bigint;
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

  /* เทียบกับวันก่อน ๆ — เลขไมล์เดินหน้าอย่างเดียวตลอดอายุรถ */
  select max(reading_km) into v_last
    from public.vehicle_odometer
   where vehicle_id = p_vehicle_id
     and reading_date < v_today;

  if v_last is not null and p_reading_km < v_last then
    raise exception 'เลขไมล์น้อยกว่าครั้งก่อน (%) — อ่านเลขบนหน้าปัดอีกครั้ง', v_last
      using errcode = 'P0001';
  end if;

  /* ปลายวันต้องไม่น้อยกว่าต้นวันของวันเดียวกัน — ระยะติดลบไม่มีอยู่จริง */
  if v_kind = 'end' then
    select reading_km into v_start
      from public.vehicle_odometer
     where vehicle_id = p_vehicle_id and driver_id = v_me
       and reading_date = v_today and kind = 'start';
    if v_start is not null and p_reading_km < v_start then
      raise exception 'เลขไมล์ตอนกลับ (%) น้อยกว่าตอนออกรถ (%) — อ่านเลขอีกครั้ง',
        p_reading_km, v_start using errcode = 'P0001';
    end if;
  end if;

  insert into public.vehicle_odometer (vehicle_id, driver_id, reading_km, reading_date, trip_id, kind)
  values (p_vehicle_id, v_me, p_reading_km, v_today, v_trip, v_kind)
  on conflict (vehicle_id, driver_id, reading_date, kind)
    do update set reading_km = excluded.reading_km,
                  taken_at   = now(),
                  trip_id    = excluded.trip_id;

  return json_build_object('vehicle_id', p_vehicle_id, 'reading_km', p_reading_km,
                           'kind', v_kind, 'date', v_today);
end;
$function$;

/* ฟังก์ชันเดิมสองอาร์กิวเมนต์ต้องทิ้ง ไม่งั้น PostgREST เจอสองแบบแล้วเลือกไม่ถูก
   ตอนเรียกด้วยสองอาร์กิวเมนต์ ซึ่งเป็นสิ่งที่แอปที่ deploy อยู่ทำอยู่ตอนนี้ */
drop function if exists public.log_odometer(bigint, integer);

/* ---------------------------------------------------------------
   odometer_status — คืนทั้งเลขต้นวันและปลายวัน

   จอต้องแยกได้ว่า "ยังไม่ได้กรอกตอนเช้า" กับ "กรอกเช้าแล้ว รอตอนกลับ"
   เพราะสองอย่างนี้ทำให้จอต้องขวางคนละปุ่มกัน
   --------------------------------------------------------------- */
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
   where vehicle_id = p_vehicle_id and reading_date < v_today
   order by reading_date desc, id desc
   limit 1;

  return json_build_object('logged_today', v_start is not null,
                           'start_km', v_start,
                           'end_km', v_end,
                           'reading_km', coalesce(v_end, v_start),
                           'last_km', v_last);
end;
$function$;

revoke all on function public.log_odometer(bigint, integer, text) from public;
grant execute on function public.log_odometer(bigint, integer, text) to authenticated;
