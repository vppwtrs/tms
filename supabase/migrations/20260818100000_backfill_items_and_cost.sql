-- เติมย้อนหลังให้เที่ยว/ใบที่นำเข้าไปก่อนหน้านี้
--
-- ตารางกับตรรกะใหม่มีผลกับการนำเข้าครั้งต่อไปเท่านั้น ของที่นำเข้าไปแล้ว
-- จะไม่มีรายการของและไม่มีค่าขนส่งตลอดไป ทั้งที่ข้อมูลต้นทางยังอยู่ใน tms_shipments
-- และ tms_trips ครบ — เชื่อมกลับได้ด้วย order_id / trip_id ที่ปั๊มไว้ตอนนำเข้า

update public.trips t
   set freight_cost        = nullif(x.cost, 0),
       freight_actual_cost = nullif(x.actual_cost, 0)
  from public.tms_trips x
 where x.trip_id = t.id
   and t.freight_cost is null
   and t.freight_actual_cost is null;

insert into public.order_items (order_id, item_no, item_name, qty)
select s.order_id,
       s.item_no,
       max(s.item_name),
       sum(coalesce(s.item_split_qty, s.item_qty, 0))
  from public.tms_shipments s
 where s.order_id is not null
   and coalesce(btrim(s.item_no), '') <> ''
 group by s.order_id, s.item_no
on conflict (order_id, item_no) do nothing;
