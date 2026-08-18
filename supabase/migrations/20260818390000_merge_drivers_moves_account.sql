-- รวมพนักงานขับล้มเมื่อคนที่ถูกรวมมีบัญชีผู้ใช้
--
-- merge_drivers ย้ายบัญชีด้วย update drivers set user_id = coalesce(user_id, v_drop.user_id)
-- ที่แถวที่เก็บไว้ **ก่อน** ลบแถวที่ถูกรวม ระหว่างสองคำสั่งนั้นมีสองแถวถือ user_id เดียวกัน
-- unique drivers_user_id_key จึงตีกลับทั้งธุรกรรม
--
-- โผล่สองทาง: กดปุ่ม "รวมเข้าด้วยกัน" ที่หน้าพนักงานขับ และการสร้างบัญชีให้คนขับที่มีชื่อ
-- อยู่แล้ว (admin-users ยุบแถวที่ create_app_user สร้างเข้ากับคนที่เลือกผ่านฟังก์ชันนี้)
-- ทั้งสองทางขึ้นข้อความเดียวกัน: duplicate key value violates unique constraint
--
-- แก้ด้วยการปลดบัญชีออกจากแถวที่จะถูกลบก่อน แล้วค่อยย้ายไปไว้ที่แถวที่เก็บไว้

create or replace function public.merge_drivers(p_keep bigint, p_drop bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_keep public.drivers;
  v_drop public.drivers;
  v_trips int;
begin
  if not app.has_perm('drivers.write') then
    raise exception 'ไม่มีสิทธิ์จัดการพนักงานขับ' using errcode = '42501';
  end if;
  if p_keep = p_drop then
    raise exception 'เลือกคนละคนกัน' using errcode = 'P0001';
  end if;

  select * into v_keep from public.drivers where id = p_keep;
  select * into v_drop from public.drivers where id = p_drop;
  if v_keep.id is null or v_drop.id is null then
    raise exception 'ไม่พบพนักงานขับที่เลือก' using errcode = 'P0002';
  end if;

  /* บัญชีผู้ใช้ผูกได้คนละหนึ่ง ถ้าทั้งคู่มีบัญชี การรวมจะทำให้บัญชีหนึ่งหลุดเงียบ ๆ
     แล้วคนนั้นจะเปิดแอปไม่เห็นงานโดยไม่มีใครรู้ว่าเกิดอะไรขึ้น */
  if v_keep.user_id is not null and v_drop.user_id is not null then
    raise exception 'ทั้งสองคนผูกบัญชีผู้ใช้ไว้คนละบัญชี — ต้องปลดบัญชีของ % ก่อน', v_drop.name
      using errcode = 'P0001';
  end if;

  select count(*) into v_trips from public.trips where driver_id = p_drop;

  update public.trips set driver_id  = p_keep where driver_id  = p_drop;
  update public.trips set accepted_by = p_keep where accepted_by = p_drop;

  delete from public.trip_drivers x
   where x.driver_id = p_drop
     and exists (select 1 from public.trip_drivers k
                  where k.trip_id = x.trip_id and k.driver_id = p_keep);
  update public.trip_drivers set driver_id = p_keep where driver_id = p_drop;

  update public.tms_driver_map set driver_id = p_keep where driver_id = p_drop;

  /* ปลดบัญชีออกจากแถวที่จะถูกลบก่อนเสมอ — drivers.user_id เป็น unique
     ถ้าย้ายไปไว้ที่แถวที่เก็บทั้งที่แถวเก่ายังถืออยู่ จะชนคีย์แล้วล้มทั้งการรวม */
  if v_drop.user_id is not null then
    update public.drivers set user_id = null where id = p_drop;
  end if;

  /* เบอร์/ใบขับขี่/บัญชี ของคนที่ถูกรวมเข้ามา เติมให้เฉพาะช่องที่ตัวหลักยังว่าง
     ไม่เขียนทับของเดิม เพราะแถวหลักคือแถวที่คนกรอกดูแลมานานกว่า */
  update public.drivers
     set phone        = coalesce(phone, v_drop.phone),
         license_no   = coalesce(license_no, v_drop.license_no),
         license_type = coalesce(license_type, v_drop.license_type),
         joined_at    = coalesce(joined_at, v_drop.joined_at),
         user_id      = coalesce(user_id, v_drop.user_id)
   where id = p_keep;

  delete from public.drivers where id = p_drop;

  /* สถานะว่าง/ไม่ว่าง คิดใหม่จากเที่ยวที่ยังไม่จบ ไม่ใช่คงค่าเดิมของแถวใดแถวหนึ่ง */
  update public.drivers d
     set status = case
           when exists (select 1 from public.trip_drivers td
                          join public.trips t on t.id = td.trip_id
                         where td.driver_id = d.id
                           and t.status in ('planned', 'in_progress'))
           then 'on_trip' else 'available' end
   where d.id = p_keep and d.status <> 'off_duty';

  return json_build_object(
    'kept', p_keep, 'name', v_keep.name,
    'removed', p_drop, 'removed_name', v_drop.name,
    'moved_trips', v_trips
  );
end;
$fn$;
