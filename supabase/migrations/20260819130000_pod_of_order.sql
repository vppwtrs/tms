-- เปิดดูหลักฐานการส่งมอบฝั่งคลาวด์
--
-- ลายเซ็นถูกบันทึกลงฐานมาตลอด (pod.signature_data เป็น data URL ของ canvas)
-- แต่ไม่มีหน้าจอไหนในสแตกคลาวด์ที่อ่านมันออกมาเลย ตัวที่เรนเดอร์ลายเซ็นเป็น
-- PodModal ฝั่ง LAN ซึ่งยิง /pod/order/:id ของ Express — endpoint ที่ production
-- ไม่มี หน้าออเดอร์คลาวด์จึงบอกได้แค่ "มี POD / ไม่มี POD" กดเข้าไปดูไม่ได้
--
-- หลักฐานที่เก็บแล้วเปิดดูไม่ได้ ไม่ต่างจากไม่ได้เก็บ เวลามีข้อโต้แย้งจริง
-- คนที่ต้องตอบลูกค้าคือคนวางแผน ไม่ใช่คนขับที่ถือมือถืออยู่บนถนน
--
-- ดึงทีเดียวจบทั้งใบ: ตัวหลักฐาน + รูปทุกมุม + ชื่อคนเก็บ
-- แยกเป็นหลายรอบแล้วหน้าจอจะโชว์ลายเซ็นก่อนรูปมาถึง ซึ่งอ่านแล้วเข้าใจผิดว่ารูปหาย

create or replace function public.pod_of_order(p_order_id bigint)
returns json
language sql
stable
security definer
set search_path to 'public', 'auth'
as $fn$
  select json_build_object(
           'id', p.id,
           'order_id', p.order_id,
           'recipient_name', p.recipient_name,
           'signature_data', p.signature_data,
           'notes', p.notes,
           'status', p.status,
           'lat', p.lat,
           'lng', p.lng,
           'collected_at', p.collected_at,
           'updated_at', p.updated_at,
           'collected_by_name', u.name,
           /* รูปมาจากตาราง pod_photos เป็นหลัก ส่วน photo_path เดิมเป็นของ POD
              รุ่นก่อนที่เก็บได้รูปเดียว ใบเก่าถูกย้ายเข้า pod_photos ไปแล้วตอน
              20260818370000 จึงไม่ต้องรวมซ้ำที่นี่ */
           'photos', coalesce((
             select json_agg(json_build_object('path', f.path, 'kind', f.kind) order by f.id)
               from public.pod_photos f
              where f.pod_id = p.id
           ), '[]'::json)
         )
    from public.pod p
    join public.orders o on o.id = p.order_id
    join public.trips t on t.id = o.trip_id
    left join public.users u on u.id = p.collected_by
   where p.order_id = p_order_id
     /* ด่านเดียวกับ pod_photos_of_order — ออฟฟิศดูได้ด้วยสิทธิ์ คนขับดูได้เฉพาะงานตัวเอง
        ผู้ช่วยที่ไปด้วยก็ต้องดูได้ เขาคือคนที่ยืนอยู่หน้าร้านตอนเซ็นพอ ๆ กับคนขับหลัก */
     and (app.has_perm('pod.view')
          or t.driver_id = app.current_driver_id()
          or exists (select 1 from public.trip_drivers td
                      where td.trip_id = t.id
                        and td.driver_id = app.current_driver_id()));
$fn$;

grant execute on function public.pod_of_order(bigint) to authenticated;
