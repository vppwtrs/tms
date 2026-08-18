-- นำเข้าเที่ยวอัตโนมัติจากฝั่งฐาน — โดยเฉพาะเที่ยวที่ TMS ปิดงานแล้ว
--
-- เดิมการนำเข้าอัตโนมัติทำในเบราว์เซอร์ (autoImportReadyTrips) โดยเรียก preview_tms_trips
-- แบบไม่ส่งวันที่ ซึ่งคืนข้อมูล "วันเดียว" เท่านั้น รอบอัตโนมัติจึงเห็นแค่วันเริ่มต้นของหน้า
-- พอกฎวันเริ่มต้นถูกเปลี่ยนให้เอาวันนี้ก่อน เที่ยวที่ปิดงานไปเมื่อวานก็ไม่มีใครเก็บอีกเลย
-- ค้างเป็นประวัติที่ไม่เคยเข้าระบบ ทั้งที่ไม่มีอะไรต้องให้คนตัดสินใจแล้ว
--
-- ย้ายมาทำในฐานเพื่อให้กวาดได้ทุกวันในคราวเดียว ไม่ผูกกับวันที่หน้าจอกำลังเปิดอยู่
--
-- ขอบเขตที่ตั้งใจ:
--  * Completed (5) — เก็บย้อนหลังทุกวัน งานจบแล้ว นำเข้า = บันทึกประวัติ
--    import_tms_trip ไม่จับรถ/คนขับเป็น on_trip ให้อยู่แล้วเมื่อสถานะเป็น completed
--  * สถานะอื่น — เฉพาะวันนี้ เพราะการสร้างงานที่ยังไม่จบของเมื่อวานขึ้นมาใหม่
--    เท่ากับปลุกงานค้างที่คนอาจจัดการนอกระบบไปแล้ว
--  * ต้องจับคู่ชื่อคนขับครบทุกคนก่อน — ระบบไม่เดาว่าใครเป็นใคร
--    เที่ยวที่ยังจับคู่ไม่ครบจะถูกข้ามไว้ให้คนกดเองในหน้า "เที่ยวจาก TMS"

create or replace function public.auto_import_trips()
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_t        record;
  v_res      json;
  v_imported int := 0;
  v_orders   int := 0;
  v_waiting  int := 0;
  v_failed   int := 0;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  for v_t in
    select t.tms_id,
           t.trip_no,
           /* จับคู่ครบ = ทุกชื่อที่แยกออกมาแล้วมีคนในระบบรออยู่
              เทียบจำนวน ไม่ใช่เช็คแค่ชื่อแรก เที่ยวที่ไปสองคนต้องครบทั้งคู่ */
           cardinality(app.tms_driver_names(t.driver_name)) as names,
           (select count(*)
              from unnest(app.tms_driver_names(t.driver_name)) as u(n)
              join public.tms_driver_map m
                on m.driver_key = u.n and not m.ignored and m.driver_id is not null
           ) as mapped
      from public.tms_trips t
     where t.trip_id is null
       and t.status_id is distinct from 6
       and (t.status_id = 5 or t.order_date = current_date)
       and app.tms_driver_names(t.driver_name) <> '{}'
     order by t.order_date, t.trip_no
  loop
    if v_t.mapped < v_t.names then
      v_waiting := v_waiting + 1;
      continue;
    end if;

    /* เที่ยวหนึ่งพังไม่ควรหยุดทั้งรอบ — ของที่เหลือยังนำเข้าได้
       เที่ยวที่พังจะยังค้างให้กดเองแล้วเห็นสาเหตุเต็ม ๆ ในหน้าจอ */
    begin
      v_res := public.import_tms_trip(v_t.tms_id);
      if not coalesce((v_res->>'already')::boolean, false) then
        v_imported := v_imported + 1;
        v_orders := v_orders + coalesce((v_res->>'created_orders')::int, 0);
      end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return json_build_object(
    'imported', v_imported,
    'created_orders', v_orders,
    'waiting_for_driver', v_waiting,
    'failed', v_failed
  );
end;
$fn$;

grant execute on function public.auto_import_trips() to authenticated;
