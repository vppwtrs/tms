/* 0011 — เติมสองคอลัมน์ที่หน้าคนขับต้องใช้จริงแต่ view ยังไม่มี
 *
 * เจอตอนย้าย MyJobs มาใช้ Supabase: หน้าจอเดิมใช้ distance_km กับ customer_address
 * แต่ my_orders ที่เขียนไว้ใน 0004 ไม่มีทั้งคู่
 *
 * customer_address ไม่ใช่ของประดับ — เป็นปุ่มที่คนขับกดแล้วเปิดแผนที่นำทาง
 * ถ้าไม่มี คนขับต้องพิมพ์ที่อยู่เองขณะขับรถ ซึ่งแย่กว่าไม่มีปุ่มเสียอีก
 *
 * ทั้งสองคอลัมน์ไม่ใช่ตัวเลขเงิน กฎ "คนขับห้ามเห็นเงิน" ยังอยู่ครบ
 * ก่อนเติมคอลัมน์ใด ๆ ลง view นี้ ให้ถามก่อนเสมอว่ามันบอกราคาหรือต้นทุนหรือไม่
 *
 * ต้อง drop ก่อน create — create or replace view เปลี่ยนจำนวนคอลัมน์ไม่ได้
 * เมื่อ drop แล้ว grant หายไปด้วย จึงต้องให้ใหม่ทั้ง revoke และ grant
 */

drop view if exists public.my_orders;

create view public.my_orders with (security_invoker = off) as
  select o.id,
         o.order_no,
         o.trip_id,
         o.status,
         o.priority,
         o.origin,
         o.destination,
         o.distance_km,
         o.goods_desc,
         o.weight_kg,
         o.scheduled_at,
         o.delivered_at,
         o.notes,
         c.name    as customer_name,
         c.phone   as customer_phone,
         c.address as customer_address,
         exists (select 1 from public.pod p where p.order_id = o.id) as has_pod
    from public.orders o
    join public.trips t     on t.id = o.trip_id
    left join public.customers c on c.id = o.customer_id
   where t.driver_id = app.current_driver_id()
     and app.has_perm('myjobs.view');

comment on view public.my_orders is
  'จุดส่งของในเที่ยวตัวเอง — ไม่มีคอลัมน์ fee หรือต้นทุนใด ๆ โดยตั้งใจ';

/* Supabase แจก grant ให้ anon กับทุก object ใหม่ใน public อัตโนมัติ
   view นี้เป็น security_invoker = off คือข้าม RLS ตามออกแบบ ถ้าปล่อยให้ anon ถืออยู่
   คนที่ไม่ได้ล็อกอินจะอ่านงานของคนขับได้ — ต้องตัดทุกครั้งที่สร้าง view ใหม่ */
revoke all on public.my_orders from anon;
grant select on public.my_orders to authenticated;
