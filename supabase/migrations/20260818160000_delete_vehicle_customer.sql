-- ปุ่มลบรถและลบลูกค้าไม่โผล่ ด้วยเหตุผลเดียวกับพนักงานขับ
--
-- นโยบาย RLS อ้าง app.has_perm('vehicles.delete') / ('customers.delete')
-- และหน้าเว็บผูกปุ่มกับคีย์เดียวกัน แต่สิทธิ์สองตัวนี้ไม่เคยถูกขึ้นทะเบียนใน
-- public.permissions และไม่เคยแจกให้บทบาทไหน — ทั้งสองเมนูจึงลบอะไรไม่ได้เลย
-- ข้อมูลที่เพิ่มผิด/เพิ่มซ้ำ ค้างอยู่ในระบบถาวรโดยไม่มีทางเอาออก
--
-- quotes.view / quotes.write มีนโยบายอยู่แต่ไม่เคยขึ้นทะเบียนเหมือนกัน
-- ขึ้นทะเบียนไว้ให้แจกได้จากหน้าสิทธิ์ ไม่งั้นตารางนั้นไม่มีใครเข้าถึงได้เลย

insert into public.permissions (permission, label)
values ('vehicles.delete',  'ลบรถ'),
       ('customers.delete', 'ลบลูกค้า'),
       ('quotes.view',      'ดูใบเสนอราคา'),
       ('quotes.write',     'จัดการใบเสนอราคา')
on conflict (permission) do nothing;

insert into public.role_permissions (role, permission)
values ('admin', 'vehicles.delete'),
       ('admin', 'customers.delete'),
       ('admin', 'quotes.view'),
       ('admin', 'quotes.write'),
       ('dispatcher', 'vehicles.delete'),
       ('dispatcher', 'customers.delete'),
       ('dispatcher', 'quotes.view')
on conflict do nothing;

-- ลบผ่าน RPC เพื่อบอกเหตุผลเป็นภาษาคน แทน error ของ FK
create or replace function public.delete_vehicle(p_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_plate text;
  v_trips int;
begin
  if not app.has_perm('vehicles.delete') then
    raise exception 'ไม่มีสิทธิ์ลบรถ' using errcode = '42501';
  end if;

  select plate_no into v_plate from public.vehicles where id = p_id;
  if v_plate is null then
    raise exception 'ไม่พบรถคันนี้' using errcode = 'P0002';
  end if;

  select count(*) into v_trips from public.trips where vehicle_id = p_id;
  if v_trips > 0 then
    raise exception 'ลบไม่ได้ — % มีประวัติเที่ยวขนส่ง % เที่ยว ให้เปลี่ยนสถานะเป็น "ซ่อมบำรุง" แทน',
      v_plate, v_trips using errcode = 'P0001';
  end if;

  /* ตัดคีย์ที่ชี้มาที่คันนี้ทิ้ง ไม่ให้เหลือคีย์ที่ไม่มีรถผูก
     ซึ่งจะกลายเป็นทะเบียน "ยังไม่จับคู่" ที่ลบไม่ออกในหน้าเที่ยว */
  delete from public.tms_vehicle_map where vehicle_id = p_id;
  delete from public.vehicles where id = p_id;

  return json_build_object('deleted', p_id, 'plate_no', v_plate);
end;
$fn$;

create or replace function public.delete_customer(p_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name   text;
  v_orders int;
begin
  if not app.has_perm('customers.delete') then
    raise exception 'ไม่มีสิทธิ์ลบลูกค้า' using errcode = '42501';
  end if;

  select name into v_name from public.customers where id = p_id;
  if v_name is null then
    raise exception 'ไม่พบลูกค้ารายนี้' using errcode = 'P0002';
  end if;

  select count(*) into v_orders from public.orders where customer_id = p_id;
  if v_orders > 0 then
    raise exception 'ลบไม่ได้ — % มีออเดอร์ในระบบ % ใบ',
      v_name, v_orders using errcode = 'P0001';
  end if;

  /* ของที่ผูกกับลูกค้าแต่ไม่ใช่ประวัติการส่ง ลบตามไปได้ ไม่ต้องให้คนไปไล่ลบเอง */
  delete from public.tms_dealer_map      where customer_id = p_id;
  delete from public.customer_tasks      where customer_id = p_id;
  delete from public.customer_interactions where customer_id = p_id;
  delete from public.quotes              where customer_id = p_id;
  delete from public.customers           where id = p_id;

  return json_build_object('deleted', p_id, 'name', v_name);
end;
$fn$;

grant execute on function public.delete_vehicle(bigint)  to authenticated;
grant execute on function public.delete_customer(bigint) to authenticated;
