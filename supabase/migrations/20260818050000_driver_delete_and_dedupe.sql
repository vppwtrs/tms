-- ลบพนักงานขับได้จริง + กันการสร้างชื่อซ้ำจาก TMS
--
-- อาการ: หน้าพนักงานขับมีแต่ปุ่มแก้ไข ไม่มีปุ่มลบ และมีชื่อซ้ำกันคนละแถว
--         ("เอกชัย บุญอินทร์ (เอก)" มีทั้ง id 3 และ id 5)
--
-- สาเหตุมีสองชั้น แยกกันคนละเรื่อง:
--  1) นโยบาย RLS drivers_delete อ้าง app.has_perm('drivers.delete')
--     แต่สิทธิ์ชื่อนี้ไม่เคยถูกใส่ใน public.permissions และไม่เคยแจกให้บทบาทไหนเลย
--     ปุ่มลบฝั่งเว็บผูกกับ can('drivers.delete') จึงไม่โผล่ให้ใครเห็นตั้งแต่ต้น
--  2) create_driver_from_tms หาคนซ้ำจาก tms_driver_map ทางเดียว
--     ตอนยังไม่แยกชื่อคนขับ คีย์คือชื่อควบ "เอกชัย ... , อณัฐ ..." หนึ่งคีย์
--     พอแยกชื่อแล้วได้คีย์ใหม่คนละคี่ย์ มองไม่เห็นของเดิม เลย insert คนใหม่ทับเข้าไป

-- 1) ขึ้นทะเบียนสิทธิ์ลบ แล้วแจกให้บทบาทที่ดูแลทะเบียนพนักงานขับอยู่แล้ว
insert into public.permissions (permission, label)
values ('drivers.delete', 'ลบพนักงานขับ')
on conflict (permission) do nothing;

insert into public.role_permissions (role, permission)
values ('admin', 'drivers.delete'), ('dispatcher', 'drivers.delete')
on conflict do nothing;

-- 2) ลบผ่าน RPC เพื่อให้ได้ข้อความไทยแทน error ของ FK
--    trips.driver_id เป็น NO ACTION — ลบคนที่มีประวัติเที่ยวแล้วจะเด้ง error ดิบ
--    ซึ่งอ่านไม่รู้เรื่องว่าต้องทำอะไรต่อ
create or replace function public.delete_driver(p_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name  text;
  v_trips int;
begin
  if not app.has_perm('drivers.delete') then
    raise exception 'ไม่มีสิทธิ์ลบพนักงานขับ' using errcode = '42501';
  end if;

  select name into v_name from public.drivers where id = p_id;
  if v_name is null then
    raise exception 'ไม่พบพนักงานขับคนนี้' using errcode = 'P0002';
  end if;

  select count(*) into v_trips from public.trips where driver_id = p_id;
  if v_trips > 0 then
    raise exception 'ลบไม่ได้ — % มีประวัติเที่ยวขนส่ง % เที่ยว ให้เปลี่ยนสถานะเป็น "พักงาน" แทน',
      v_name, v_trips using errcode = 'P0001';
  end if;

  /* ตัดคีย์ที่ชี้มาที่คนนี้ทิ้งไปด้วย ไม่ใช่ปล่อยให้ driver_id เป็น null ค้างไว้ตาม FK
     คีย์ที่ค้างแบบไม่มีคนผูก จะกลายเป็นชื่อ "ยังไม่จับคู่" ที่ลบไม่ออกในหน้าเที่ยว */
  delete from public.tms_driver_map where driver_id = p_id;
  delete from public.drivers where id = p_id;

  return json_build_object('deleted', p_id, 'name', v_name);
end;
$fn$;

grant execute on function public.delete_driver(bigint) to authenticated;

-- 3) สร้างคนขับจาก TMS ให้ยึด "ชื่อ" เป็นตัวตัดสินซ้ำ ไม่ใช่แค่คีย์
create or replace function public.create_driver_from_tms(p_driver_key text)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id   bigint;
  v_name text := btrim(p_driver_key);
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
     (ชื่อควบสองคน, เว้นวรรคไม่เท่ากัน) ชื่อที่ตัดช่องว่างแล้วตรงกันถือว่าคนเดียวกัน
     เลือก id น้อยสุดเพื่อให้ทุกคีย์ที่สะกดเหมือนกันวิ่งมารวมที่แถวเดียว */
  if v_id is null then
    select min(id) into v_id from public.drivers where btrim(name) = v_name;
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
