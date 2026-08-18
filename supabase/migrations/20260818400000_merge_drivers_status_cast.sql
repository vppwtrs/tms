-- รวมพนักงานขับล้มที่บรรทัดสุดท้าย: column "status" is of type driver_status but expression is of type text
--
-- ประโยค case ที่คิดสถานะใหม่คืนค่าเป็น text ส่วน drivers.status เป็น enum driver_status
-- Postgres ไม่แปลงให้เอง บั๊กนี้อยู่ในฟังก์ชันมาตลอด แต่ไม่เคยถูกเห็น
-- เพราะการรวมล้มที่ unique drivers_user_id_key ก่อนจะเดินมาถึงบรรทัดนี้ทุกครั้ง
--
-- แก้ทีเดียวทั้งฟังก์ชันด้วยการใส่ cast ตรงที่เขียนค่าลงคอลัมน์

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

  /* ปลดบัญชีออกจากแถวที่จะถูกลบก่อนเสมอ — drivers.user_id เป็น unique */
  if v_drop.user_id is not null then
    update public.drivers set user_id = null where id = p_drop;
  end if;

  update public.drivers
     set phone        = coalesce(phone, v_drop.phone),
         license_no   = coalesce(license_no, v_drop.license_no),
         license_type = coalesce(license_type, v_drop.license_type),
         joined_at    = coalesce(joined_at, v_drop.joined_at),
         user_id      = coalesce(user_id, v_drop.user_id)
   where id = p_keep;

  delete from public.drivers where id = p_drop;

  /* สถานะว่าง/ไม่ว่าง คิดใหม่จากเที่ยวที่ยังไม่จบ — ต้อง cast เป็น enum ให้ชัด */
  update public.drivers d
     set status = (case
           when exists (select 1 from public.trip_drivers td
                          join public.trips t on t.id = td.trip_id
                         where td.driver_id = d.id
                           and t.status in ('planned', 'in_progress'))
           then 'on_trip' else 'available' end)::driver_status
   where d.id = p_keep and d.status <> 'off_duty';

  return json_build_object(
    'kept', p_keep, 'name', v_keep.name,
    'removed', p_drop, 'removed_name', v_drop.name,
    'moved_trips', v_trips
  );
end;
$fn$;
