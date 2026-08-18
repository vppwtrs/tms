-- ทะเบียนรถคันเดียวกันเข้ามาหลายรูป ทำให้เกิดรถซ้ำในทะเบียน
--
-- TMS ส่งทะเบียนมาแบบ "3ฒน5038-02" บ้าง "3ฒน5038" บ้าง และบางคันมีเว้นวรรค
-- ("3ฒข 2735") create_vehicle_from_tms เทียบด้วยข้อความตรง ๆ จึงมองเป็นคนละคัน
-- แล้วสร้างรถใหม่ให้ทุกรูปแบบ เที่ยวของรถคันเดียวจึงกระจายอยู่หลายคัน
-- รายงานต่อคันและสถานะว่าง/ไม่ว่าง ผิดตามไปหมด
--
-- เจ้าของงานยืนยันว่าเลขท้าย "-nn" ไม่มีความหมาย เลขทะเบียนตรงกัน = คันเดียวกัน

/* ทะเบียนรูปมาตรฐาน: ตัดตั้งแต่ขีดกลางเป็นต้นไป แล้วเอาช่องว่างออกทั้งหมด
   ใช้เป็น "กุญแจเทียบ" อย่างเดียว ไม่ได้เอาไปแสดง — ป้ายที่แสดงยังเป็นข้อความเต็ม */
create or replace function app.plate_key(p_plate text)
returns text language sql immutable as $fn$
  select nullif(replace(split_part(btrim(coalesce(p_plate, '')), '-', 1), ' ', ''), '');
$fn$;

-- 1) รวมรถซ้ำที่มีอยู่แล้ว
do $$
declare
  v_key    text;
  v_keep   bigint;
  v_drop   bigint[];
begin
  for v_key in
    select app.plate_key(plate_no)
      from public.vehicles
     where app.plate_key(plate_no) is not null
     group by 1 having count(*) > 1
  loop
    /* เก็บคันที่ทะเบียนสั้นสุด (คือรูปที่ไม่มีเลขท้าย) ถ้าเท่ากันเอา id น้อยสุด
       เพราะรูปนั้นคือสิ่งที่คนอ่านแล้วรู้เรื่องที่สุด */
    select id into v_keep
      from public.vehicles
     where app.plate_key(plate_no) = v_key
     order by length(plate_no), id
     limit 1;

    select array_agg(id) into v_drop
      from public.vehicles
     where app.plate_key(plate_no) = v_key and id <> v_keep;

    /* ย้ายประวัติมาที่คันที่เก็บไว้ก่อนลบ ไม่ใช่ลบทิ้งพร้อมประวัติ */
    update public.trips set vehicle_id = v_keep where vehicle_id = any(v_drop);

    /* คีย์ TMS ทุกรูปต้องชี้มาที่คันเดียวกัน — ลบคีย์ที่ซ้ำกับของคันที่เก็บไว้ก่อน
       ไม่งั้น update จะชน unique ของ plate */
    delete from public.tms_vehicle_map m
     where m.vehicle_id = any(v_drop)
       and exists (select 1 from public.tms_vehicle_map k
                    where k.vehicle_id = v_keep and k.plate = m.plate);
    update public.tms_vehicle_map set vehicle_id = v_keep where vehicle_id = any(v_drop);

    delete from public.vehicles where id = any(v_drop);
  end loop;
end;
$$;

-- 2) ทะเบียนที่เหลือให้เป็นรูปมาตรฐาน — ตัดเลขท้ายและช่องว่างทิ้ง
--    ทำทีละคันเพื่อให้ชน unique แล้วข้ามไป ไม่ใช่ล้มทั้ง migration
do $$
declare
  v record;
begin
  for v in
    select id, plate_no, app.plate_key(plate_no) as key
      from public.vehicles
     where app.plate_key(plate_no) is not null
       and app.plate_key(plate_no) <> plate_no
  loop
    begin
      update public.vehicles set plate_no = v.key where id = v.id;
    exception when unique_violation then
      null;
    end;
  end loop;
end;
$$;

-- 3) สร้างรถจาก TMS ให้เทียบด้วยกุญแจ ไม่ใช่ข้อความดิบ
create or replace function public.create_vehicle_from_tms(p_plate text)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id   bigint;
  v_type text;
  v_key  text := app.plate_key(p_plate);
begin
  if not app.has_perm('vehicles.write') then
    raise exception 'ไม่มีสิทธิ์สร้างรถ' using errcode = '42501';
  end if;
  if coalesce(v_key, '') = '' then
    raise exception 'ไม่มีทะเบียนให้สร้าง' using errcode = 'P0002';
  end if;

  select vehicle_id into v_id from public.tms_vehicle_map
   where plate = p_plate and vehicle_id is not null;

  /* คีย์นี้ยังไม่เคยจับคู่ ไม่ได้แปลว่ารถคันนี้ยังไม่มีในระบบ —
     ทะเบียนเดียวกันเข้ามาได้หลายรูป เทียบด้วยกุญแจจึงเจอของเดิม
     เลือก id น้อยสุดให้ทุกรูปวิ่งมารวมที่คันเดียว */
  if v_id is null then
    select min(id) into v_id from public.vehicles
     where app.plate_key(plate_no) = v_key;
  end if;

  if v_id is null then
    /* ชนิดรถของ TMS (4W / 4WL / 6WM / 6WL) ไม่ตรงกับ enum ของเรา แปลหยาบ ๆ พอ
       ตัวเลขความจุปล่อยเป็นค่า default — เดาน้ำหนักบรรทุกจากชื่อชนิดรถไม่ได้
       และความจุที่ผิดจะไปโผล่เป็นคำเตือน "น้ำหนักเกิน" ตอนจัดเที่ยว */
    select case
             when vehicle_type like '6W%' then 'truck6'
             when vehicle_type like '10W%' then 'truck10'
             else 'pickup'
           end
      into v_type
      from public.tms_trips
     where app.plate_key(license_plate) = v_key
     order by order_date desc nulls last limit 1;

    insert into public.vehicles (plate_no, vehicle_type)
    values (v_key, coalesce(v_type, 'pickup')::vehicle_type)
    returning id into v_id;
  end if;

  insert into public.tms_vehicle_map (plate, vehicle_id, mapped_by, mapped_at)
  values (p_plate, v_id, app.current_user_id(), now())
  on conflict (plate) do update set
    vehicle_id = excluded.vehicle_id, ignored = false,
    mapped_by = excluded.mapped_by, mapped_at = now();

  return json_build_object('vehicle_id', v_id, 'plate', v_key);
end;
$fn$;
