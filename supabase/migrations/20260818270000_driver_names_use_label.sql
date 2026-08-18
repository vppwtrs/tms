-- app.tms_driver_names ต้องคืนชื่อรูปที่อ่านได้ ไม่ใช่กุญแจ
--
-- ตอนที่กุญแจยังเป็นแค่ "ยุบช่องว่างซ้ำ" การให้ tms_driver_names เรียก driver_key
-- ยังพอใช้ได้ แต่พอกุญแจเปลี่ยนเป็น "ตัดช่องว่างทั้งหมด" ชื่อที่แยกออกมาจะกลายเป็น
-- "เอกชัย(เอก)" ซึ่งไม่ตรงกับคีย์ใน tms_driver_map ที่เก็บไว้พร้อมช่องว่าง
-- ผลคือทุกเที่ยวจะกลายเป็น "ยังไม่จับคู่คนขับ" และการนำเข้าอัตโนมัติหยุดทั้งหมด
--
-- กุญแจใช้ "เทียบ" เท่านั้น ชื่อที่ไหลไปเป็นคีย์และขึ้นหน้าจอต้องใช้ driver_label

create or replace function app.tms_driver_names(p_raw text)
returns text[] language sql immutable as $fn$
  select coalesce(array_agg(n order by ord), '{}')
    from unnest(string_to_array(coalesce(p_raw, ''), ',')) with ordinality as t(part, ord)
    cross join lateral (select app.driver_label(t.part)) as c(n)
   where c.n is not null;
$fn$;
