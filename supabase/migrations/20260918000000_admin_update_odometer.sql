-- ออฟฟิศแก้เลขไมล์ที่คนขับกรอกผิดได้ ผ่านสิทธิ์ vehicles.write
-- แก้ได้เฉพาะแถวที่ระบุ id ตรง ๆ (ค่าล่าสุดที่เห็นในหน้ารถยนต์) ไม่เปิดให้สร้างแถวใหม่
-- ยังกันเลขถอยหลังเทียบกับวันก่อนหน้า และกันจบงานน้อยกว่าออกรถวันเดียวกัน เหมือน log_odometer เดิม
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

  /* เทียบกับวันก่อนหน้าของคันเดียวกัน — เลขไมล์เดินหน้าอย่างเดียวตลอดอายุรถ */
  select max(reading_km) into v_last
    from public.vehicle_odometer
   where vehicle_id = v_row.vehicle_id
     and reading_date < v_row.reading_date;
  if v_last is not null and p_reading_km < v_last then
    raise exception 'เลขไมล์น้อยกว่าครั้งก่อน (%)', v_last using errcode = 'P0001';
  end if;

  /* คู่ออกรถ/จบงานของวันเดียวกัน ต้องไม่สลับด้านกัน */
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

  update public.vehicle_odometer set reading_km = p_reading_km where id = p_odometer_id;

  return json_build_object('id', p_odometer_id, 'vehicle_id', v_row.vehicle_id,
                           'reading_km', p_reading_km, 'kind', v_row.kind, 'date', v_row.reading_date);
end;
$$;

grant execute on function public.admin_update_odometer(bigint, integer) to authenticated;
