-- รวมพนักงานขับสองแถวที่เป็นคนเดียวกัน
--
-- TMS สะกดชื่อคนเดียวกันได้หลายแบบ บางแบบต่างกันแค่ช่องว่าง (กุญแจ app.driver_key
-- จัดการให้แล้ว) แต่บางแบบต่างกันจริง ๆ เช่น มี/ไม่มีนามสกุล:
--   "เอกชัย บุญอินทร์ (เอก)"  กับ  "เอกชัย (เอก)"
-- แบบหลังระบบตัดสินแทนไม่ได้ — ชื่อที่ขึ้นต้นเหมือนกันไม่ได้แปลว่าคนเดียวกันเสมอไป
-- จึงต้องมีคนยืนยัน แล้วระบบจำไว้ให้ผ่าน tms_driver_map
--
-- หลังรวมแล้ว คีย์ทุกแบบชี้มาที่คนเดียวกัน รอบดึงถัดไปที่ TMS ส่งชื่อแบบไหนมา
-- create_driver_from_tms จะเจอคีย์เดิมใน map ก่อนเสมอ ไม่สร้างคนใหม่อีก

create or replace function public.merge_drivers(p_keep bigint, p_drop bigint)
returns json
language plpgsql
security definer
set search_path = public
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

  /* trip_drivers มี pk (trip_id, driver_id) — เที่ยวที่มีทั้งสองคนอยู่ด้วยกัน
     ต้องตัดแถวที่จะซ้ำทิ้งก่อนย้าย ไม่งั้นชน pk แล้วล้มทั้งการรวม */
  delete from public.trip_drivers x
   where x.driver_id = p_drop
     and exists (select 1 from public.trip_drivers k
                  where k.trip_id = x.trip_id and k.driver_id = p_keep);
  update public.trip_drivers set driver_id = p_keep where driver_id = p_drop;

  /* คีย์ของ TMS คือสิ่งที่ทำให้ระบบ "จำ" ได้ว่าชื่อแบบนี้คือคนนี้
     ย้ายมาทั้งหมด รอบดึงถัดไปจึงไม่สร้างคนซ้ำขึ้นมาอีก */
  update public.tms_driver_map set driver_id = p_keep where driver_id = p_drop;

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

grant execute on function public.merge_drivers(bigint, bigint) to authenticated;

-- รวมคู่ที่เจ้าของงานยืนยันแล้วว่าเป็นคนเดียวกัน
do $$
declare
  v_keep bigint;
  v_drop bigint;
begin
  select id into v_keep from public.drivers where app.driver_key(name) = app.driver_key('เอกชัย บุญอินทร์ (เอก)');
  select id into v_drop from public.drivers where app.driver_key(name) = app.driver_key('เอกชัย (เอก)');

  if v_keep is not null and v_drop is not null then
    update public.trips        set driver_id   = v_keep where driver_id   = v_drop;
    update public.trips        set accepted_by = v_keep where accepted_by = v_drop;
    delete from public.trip_drivers x
     where x.driver_id = v_drop
       and exists (select 1 from public.trip_drivers k
                    where k.trip_id = x.trip_id and k.driver_id = v_keep);
    update public.trip_drivers set driver_id = v_keep where driver_id = v_drop;
    update public.tms_driver_map set driver_id = v_keep where driver_id = v_drop;
    delete from public.drivers where id = v_drop;
  end if;
end;
$$;
