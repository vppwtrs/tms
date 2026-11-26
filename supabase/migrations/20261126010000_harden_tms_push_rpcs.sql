-- ปิดช่องจากรายงานตรวจความปลอดภัย 25 พ.ย. 2026
-- push_tms_trips_and_sync เป็น security definer ไม่มี guard ไม่มี revoke — ใครมี JWT (หรืออาจแค่ anon key) ก็เขียนทริปได้
-- push_tms_trips / push_tms_shipments สร้างตรงใน DB ไม่มีใน repo จึงปิดสิทธิ์ anon ไว้ด้วย

-- 1) เพิ่ม guard ให้ push_tms_trips_and_sync (เนื้อหาที่เหลือเหมือนเดิมจาก 20260818310000_shipment_plate_driver.sql)
--    ใช้ tms.view ให้ตรงกับสิทธิ์ของหน้า /tms-trips ที่รันรอบดึงทุก 5 นาที (AppCloud.tsx:137)
create or replace function public.push_tms_trips_and_sync(p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_push json;
  v_sync json;
  v_fill int;
  v_user bigint := app.current_user_id();
  v_date date;
  v_pl   int;
begin
  if not app.has_perm('tms.view') then
    raise exception 'ไม่มีสิทธิ์นำเข้าเที่ยว' using errcode = '42501';
  end if;

  v_push := public.push_tms_trips(p_rows);
  v_sync := public.sync_tms_trip_status();
  v_fill := app.fill_shipment_trip_fields();

  -- หนึ่งแถวต่อการ push หนึ่งครั้ง ใช้วันที่ล่าสุดในชุดเป็นตัวแทน
  select max(nullif(r->>'orderDate', '')::date),
         coalesce(sum(jsonb_array_length(coalesce(r->'pickingLists', '[]'::jsonb))), 0)::int
    into v_date, v_pl
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as e(r);

  if v_date is not null then
    insert into public.tms_sync_log (trip_date, rows_pushed, picking_lists,
                                     rows_inserted, rows_updated, source, synced_by)
    values (v_date,
            coalesce((v_push->>'seen')::int, 0),
            v_pl,
            coalesce((v_push->>'inserted')::int, 0),
            coalesce((v_push->>'updated')::int, 0),
            'trip',
            v_user);
  end if;

  return json_build_object(
    'push', v_push,
    'synced_trips', (v_sync->>'trips')::int,
    'synced_orders', (v_sync->>'orders')::int,
    'filled_shipments', v_fill
  );
end;
$$;

-- 2) ปิดสิทธิ์ anon / public — เปิดให้เฉพาะคนล็อกอินกับ service_role
revoke execute on function public.push_tms_trips_and_sync(jsonb) from public, anon;
grant  execute on function public.push_tms_trips_and_sync(jsonb) to authenticated, service_role;
revoke execute on function public.push_tms_trips(jsonb) from public, anon;
grant  execute on function public.push_tms_trips(jsonb) to authenticated, service_role;
revoke execute on function public.push_tms_shipments(jsonb) from public, anon;
grant  execute on function public.push_tms_shipments(jsonb) to authenticated, service_role;

-- 3) ฟังก์ชันภายใน schema app — ไม่มีเหตุให้ผู้ใช้เรียกตรง
--    ตรวจแล้วว่าผู้เรียกทุกตัวเป็น security definer (วิ่งด้วยสิทธิ์เจ้าของ) จึงถอนจาก authenticated ได้โดยไม่กระทบ
--    - purge_old_trip_locations: เรียกจาก log_trip_location (20260818380000, 20261001000000)
--    - fill_shipment_trip_fields: เรียกจาก push_tms_trips_and_sync
revoke all on function app.purge_old_trip_locations() from public, anon, authenticated;
revoke all on function app.fill_shipment_trip_fields() from public, anon, authenticated;

-- 4) view my_trips / my_orders — ข้าม security_invoker ไว้ก่อน เพราะยังไม่ปลอดภัย
--    - my_trips นับ driver_count / accepted_count จาก trip_drivers ทั้งเที่ยว แต่ policy trip_drivers_select
--      ให้คนขับเห็นแค่แถวของตัวเอง (ตัวเลขจะเพี้ยนเป็น 1) และอ่าน tms_trips ที่เป็นข้อมูลฝั่งจัดเที่ยว
--    - ตาราง trips / vehicles / orders / customers / pod / tms_trips สร้างตรงใน DB ไม่มี policy ใน repo
--      ตรวจไม่ได้ว่าคนขับ (myjobs.view) select ได้ครบ ถ้าเปิดแล้วจอคนขับอาจว่างเปล่า
-- alter view public.my_orders set (security_invoker = on);
-- alter view public.my_trips  set (security_invoker = on);
