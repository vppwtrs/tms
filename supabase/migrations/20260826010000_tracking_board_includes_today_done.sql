-- หน้าติดตามรถต้องเห็นเที่ยวที่จบไปแล้ววันนี้ด้วย
--
-- ของเดิมคืนเฉพาะ planned / in_progress / returning ซึ่งแปลว่าวินาทีที่คนขับกดปิดเที่ยว
-- รถคันนั้นหายออกจากหน้าจอทันที พร้อมกับเส้นทางทั้งวันและหมุดหลักฐานทุกจุดของมัน
--
-- ซึ่งกลับหัวกับจังหวะที่คนถามจริง ๆ: คำถาม "รถคันนี้ไปถึงร้านกี่โมง" กับ "ทำไมถึงช้า"
-- เกิดหลังงานจบ ไม่ใช่ระหว่างวิ่ง ระหว่างวิ่งคนดูแค่ว่ารถอยู่ไหน
--
-- เพิ่มเฉพาะที่จบ "วันนี้" ไม่ใช่ทั้งหมด — หน้านี้เป็นของวันนี้ เหมือนกระดานจัดรถ
-- ประวัติย้อนหลังอยู่ที่หน้าออเดอร์ ถ้าดึงทุกเที่ยวมาทั้งหมด รายการจะยาวขึ้นทุกวัน
-- จนหาคันที่กำลังวิ่งไม่เจอ ซึ่งเป็นงานหลักของหน้านี้
--
-- วันนี้นับตามเวลากรุงเทพ ไม่ใช่ UTC — เกณฑ์เดียวกับที่ log_odometer ใช้
-- ถ้านับตาม UTC เที่ยวที่ปิดหลังเที่ยงคืนจะยังค้างอยู่ในหน้าจอของวันถัดไปอีกเจ็ดชั่วโมง
--
-- arrived_at (ปิดงานที่ร้านสุดท้าย) กับ returned_at (กลับถึงคลัง) เป็นของใหม่ในผลลัพธ์ เติมท้าย ไม่ได้แทนที่ช่องไหน ตัวที่เรียกอยู่เดิม
-- จึงไม่กระทบ (ฝั่ง JS อ่านเป็น object ตามชื่อ ไม่ได้อ่านตามลำดับ)

create or replace function public.tracking_board()
returns json
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  select coalesce(json_agg(x order by x.trip_no), '[]'::json)
    from (
      select t.id as trip_id,
             t.trip_no,
             t.status,
             t.departed_at,
             t.arrived_at,
             t.returned_at,
             v.plate_no,
             (select string_agg(d.name, ', ' order by td.seq)
                from public.trip_drivers td
                join public.drivers d on d.id = td.driver_id
               where td.trip_id = t.id) as drivers,
             (select json_build_object('lat', l.lat, 'lng', l.lng,
                                       'accuracy_m', l.accuracy_m,
                                       'recorded_at', l.recorded_at)
                from public.trip_locations l
               where l.trip_id = t.id
               order by l.recorded_at desc
               limit 1) as last_seen,
             (select count(*) from public.orders o
               where o.trip_id = t.id and o.status = 'delivered') as stops_done,
             (select count(*) from public.orders o where o.trip_id = t.id) as stops_total,
             (select coalesce(json_agg(json_build_object(
                       'order_id', p.order_id, 'lat', p.lat, 'lng', p.lng,
                       'collected_at', p.collected_at) order by p.collected_at), '[]'::json)
                from public.pod p
                join public.orders o on o.id = p.order_id
               where o.trip_id = t.id and p.lat is not null) as pod_points
        from public.trips t
        join public.vehicles v on v.id = t.vehicle_id
       where (t.status in ('planned', 'in_progress', 'returning')
              or (t.status = 'completed'
                  and t.arrived_at is not null
                  and (timezone('Asia/Bangkok', t.arrived_at))::date
                      = (timezone('Asia/Bangkok', now()))::date))
         and (app.has_perm('dispatch.view')
              or t.driver_id = app.current_driver_id()
              or exists (select 1 from public.trip_drivers td
                          where td.trip_id = t.id
                            and td.driver_id = app.current_driver_id()))
    ) x;
$function$;
