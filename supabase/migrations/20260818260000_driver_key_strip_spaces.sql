-- กุญแจชื่อคนขับยังไม่พอ — "เอกชัย (เอก )" กับ "เอกชัย (เอก)" ยังเป็นคนละคน
--
-- รอบก่อนยุบช่องว่างซ้ำให้เหลือช่องเดียว ซึ่งไม่ช่วยกรณีนี้เลย เพราะช่องว่างมีอยู่
-- ช่องเดียวอยู่แล้ว แค่อยู่หน้าวงเล็บปิด กุญแจสองอันจึงยังต่างกันหนึ่งตัวอักษร
--
-- ตัดช่องว่าง "ทั้งหมด" ทิ้งไปเลยเหมือนกุญแจทะเบียนรถ — เทียบแล้วรวมเฉพาะชื่อที่
-- ต่างกันแค่การเว้นวรรคจริง ๆ คนละชื่อยังคงเป็นคนละคน:
--   เอกชัยบุญอินทร์(เอก)  <>  เอกชัย(เอก)

create or replace function app.driver_key(p_name text)
returns text language sql immutable as $fn$
  select nullif(regexp_replace(coalesce(p_name, ''), '\s', '', 'g'), '');
$fn$;

/* ชื่อสำหรับ "แสดง" เป็นคนละเรื่องกับกุญแจ — ตัดหัวท้ายและยุบช่องว่างซ้ำเท่านั้น
   ถ้าเอากุญแจไปเป็นชื่อ คนขับจะกลายเป็น "เอกชัยบุญอินทร์(เอก)" ซึ่งอ่านไม่ออก */
create or replace function app.driver_label(p_name text)
returns text language sql immutable as $fn$
  select nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
$fn$;

do $$
declare
  v_key  text;
  v_keep bigint;
  v_drop bigint[];
begin
  for v_key in
    select app.driver_key(name) from public.drivers
     where app.driver_key(name) is not null
     group by 1 having count(*) > 1
  loop
    select id into v_keep from public.drivers
     where app.driver_key(name) = v_key
     order by (user_id is null), id
     limit 1;

    select array_agg(id) into v_drop from public.drivers
     where app.driver_key(name) = v_key and id <> v_keep;

    update public.trips set driver_id = v_keep where driver_id = any(v_drop);
    update public.trips set accepted_by = v_keep where accepted_by = any(v_drop);

    delete from public.trip_drivers x
     where x.driver_id = any(v_drop)
       and exists (select 1 from public.trip_drivers k
                    where k.trip_id = x.trip_id and k.driver_id = v_keep);
    update public.trip_drivers set driver_id = v_keep where driver_id = any(v_drop);

    update public.tms_driver_map set driver_id = v_keep where driver_id = any(v_drop);
    delete from public.drivers where id = any(v_drop);
  end loop;
end;
$$;

-- ชื่อที่เก็บไว้ให้เป็นรูปที่อ่านง่าย ไม่มีช่องว่างเกินค้าง
update public.drivers
   set name = app.driver_label(name)
 where app.driver_label(name) is distinct from name;

create or replace function public.create_driver_from_tms(p_driver_key text)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id    bigint;
  v_label text := app.driver_label(p_driver_key);
  v_key   text := app.driver_key(p_driver_key);
begin
  if not app.has_perm('drivers.write') then
    raise exception 'ไม่มีสิทธิ์สร้างพนักงานขับ' using errcode = '42501';
  end if;
  if coalesce(v_key, '') = '' then
    raise exception 'ไม่มีชื่อพนักงานขับให้สร้าง' using errcode = 'P0002';
  end if;

  select driver_id into v_id from public.tms_driver_map
   where driver_key = p_driver_key and driver_id is not null;

  if v_id is null then
    select min(id) into v_id from public.drivers
     where app.driver_key(name) = v_key;
  end if;

  if v_id is null then
    insert into public.drivers (name) values (v_label) returning id into v_id;
  end if;

  insert into public.tms_driver_map (driver_key, driver_id, mapped_by, mapped_at)
  values (p_driver_key, v_id, app.current_user_id(), now())
  on conflict (driver_key) do update set
    driver_id = excluded.driver_id, ignored = false,
    mapped_by = excluded.mapped_by, mapped_at = now();

  return json_build_object('driver_id', v_id, 'name', v_label);
end;
$fn$;
