-- ชื่อคนขับที่ต่างกันแค่ช่องว่าง ยังสร้างคนซ้ำอยู่
--
-- TMS ส่ง "เอกชัย (เอก)" กับ "เอกชัย (เอก )" มาคนละครั้ง — ต่างกันแค่ช่องว่าง
-- ก่อนวงเล็บปิด create_driver_from_tms เทียบด้วย btrim(name) ซึ่งตัดได้แค่หัวท้าย
-- ช่องว่างที่อยู่ "ข้างใน" ข้อความจึงทำให้เป็นคนละคน แล้วเกิดแถวซ้ำอีกรอบ
-- (เคยแก้รอบหนึ่งแล้วด้วย btrim ใน 20260818050000 — ครั้งนั้นแก้ได้แค่ครึ่งเดียว)
--
-- วิธีเดียวกับทะเบียนรถ: มีกุญแจเทียบแยกจากข้อความที่แสดง

/* ยุบช่องว่างทุกชนิดให้เหลือช่องเดียว แล้วตัดหัวท้าย — ใช้เทียบอย่างเดียว
   ไม่ได้เอาไปเขียนทับชื่อที่แสดง เพราะชื่อที่ TMS ส่งมาคือสิ่งที่คนอ่านแล้วคุ้น */
create or replace function app.driver_key(p_name text)
returns text language sql immutable as $fn$
  select nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
$fn$;

-- รวมคนซ้ำที่เกิดไปแล้ว
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
    /* เก็บคนที่ผูกบัญชีผู้ใช้ไว้ก่อน ถ้าไม่มีใครผูกก็เอา id น้อยสุด —
       บัญชีผู้ใช้เป็นของที่สร้างยากที่สุดในสามอย่าง (แถว บัญชี ประวัติ) */
    select id into v_keep from public.drivers
     where app.driver_key(name) = v_key
     order by (user_id is null), id
     limit 1;

    select array_agg(id) into v_drop from public.drivers
     where app.driver_key(name) = v_key and id <> v_keep;

    update public.trips set driver_id = v_keep where driver_id = any(v_drop);
    update public.trips set accepted_by = v_keep where accepted_by = any(v_drop);

    /* trip_drivers มี primary key (trip_id, driver_id) — เที่ยวที่มีทั้งคนที่เก็บ
       และคนที่จะลบอยู่ด้วยกัน ต้องตัดแถวซ้ำทิ้งก่อนย้าย ไม่งั้นชน pk */
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

-- สร้างคนขับจาก TMS ให้เทียบด้วยกุญแจ
create or replace function public.create_driver_from_tms(p_driver_key text)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id   bigint;
  v_name text := app.driver_key(p_driver_key);
begin
  if not app.has_perm('drivers.write') then
    raise exception 'ไม่มีสิทธิ์สร้างพนักงานขับ' using errcode = '42501';
  end if;
  if coalesce(v_name, '') = '' then
    raise exception 'ไม่มีชื่อพนักงานขับให้สร้าง' using errcode = 'P0002';
  end if;

  select driver_id into v_id from public.tms_driver_map
   where driver_key = p_driver_key and driver_id is not null;

  /* คีย์ยังไม่เคยจับคู่ ไม่ได้แปลว่าคนนี้ยังไม่มีในระบบ — TMS ส่งชื่อมาได้หลายรูป
     เลือก id น้อยสุดเพื่อให้ทุกรูปที่สะกดเหมือนกันวิ่งมารวมที่แถวเดียว */
  if v_id is null then
    select min(id) into v_id from public.drivers
     where app.driver_key(name) = v_name;
  end if;

  if v_id is null then
    insert into public.drivers (name) values (v_name) returning id into v_id;
  end if;

  insert into public.tms_driver_map (driver_key, driver_id, mapped_by, mapped_at)
  values (p_driver_key, v_id, app.current_user_id(), now())
  on conflict (driver_key) do update set
    driver_id = excluded.driver_id, ignored = false,
    mapped_by = excluded.mapped_by, mapped_at = now();

  return json_build_object('driver_id', v_id, 'name', v_name);
end;
$fn$;

/* ชื่อที่แยกจากข้อความก้อนของ TMS ต้องผ่านการยุบช่องว่างด้วย ไม่งั้นคีย์ที่เกิดจาก
   การแยกชื่อ ("เอกชัย (เอก )") จะยังไม่ตรงกับคีย์ที่จับคู่ไว้แล้ว */
create or replace function app.tms_driver_names(p_raw text)
returns text[] language sql immutable as $fn$
  select coalesce(array_agg(n order by ord), '{}')
    from unnest(string_to_array(coalesce(p_raw, ''), ',')) with ordinality as t(part, ord)
    cross join lateral (select app.driver_key(t.part)) as c(n)
   where c.n is not null;
$fn$;
