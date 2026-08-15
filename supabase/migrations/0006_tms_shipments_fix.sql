/* 0006 — แก้ tms_shipments ให้ตรงกับข้อมูลที่ TMS ส่งมาจริง
 *
 * 0001 ตั้งคอลัมน์ไว้ตามที่ "คิดว่า" API ส่งมา แต่ไปเทียบกับ extractor แล้วไม่ตรงสามเรื่อง
 * (extractor เจอของจริงมาก่อน — ดู extractor/tms-extractor/public/app.js)
 *
 * 1. รายงาน actualshipment ไม่มีฟิลด์ planDeliveryDate
 *    planDeliveryDate เป็นชื่อ "พารามิเตอร์ตอนค้นหา" เท่านั้น ฟิลด์วันที่ที่ส่งกลับมาคือ
 *    orderDate / planPickupDate / pickupDate / onDeliveryDate / deliveryDate
 *    คอลัมน์เดิมจึงเป็น null ทุกแถวตลอดกาล และ index บนมันก็ไร้ประโยชน์
 *    เปลี่ยนเป็น trip_date รับค่า orderDate ตรงกับที่รายงานเรียกว่า "Trip Date"
 *
 * 2. PL ที่ถูกแบ่งส่งหลายเที่ยว (เลขลงท้าย -C-04) ยอด qty ของทั้งใบไม่เท่ากับ unit ของเที่ยวนี้
 *    splitQty น่าจะเป็นจำนวนที่ยกไปจริง — ต้องเก็บทั้งคู่ถึงจะตอบได้ว่าอันไหนคือตัวจริง
 *    ถ้าไม่เก็บตั้งแต่ตอน sync คำถามนี้ตอบไม่ได้ตลอดไป เพราะข้อมูลไม่เคยลงฐาน
 *
 * 3. qty_source บันทึกผลเทียบตอน sync ว่ายอดไหนตรงกับ unit — 'qty' / 'split' / null (ไม่ตรงทั้งคู่)
 *    สะสมไว้พอครบสักเดือนก็ query ตอบได้เลยว่าส่วนใหญ่ตรงกับตัวไหน แล้วค่อยยุบเหลือคอลัมน์เดียว
 */

alter table public.tms_shipments rename column plan_delivery_date to trip_date;
alter index tms_shipments_date_idx rename to tms_shipments_trip_date_idx;

alter table public.tms_shipments
  add column item_split_qty integer,
  add column qty_source     text,
  add constraint tms_shipments_qty_source_check
    check (qty_source is null or qty_source in ('qty', 'split'));

comment on column public.tms_shipments.trip_date is
  'orderDate จากรายงาน = "Trip Date" — ไม่ใช่วันที่วางแผนส่ง';
comment on column public.tms_shipments.item_split_qty is
  'splitQty ของ PL ที่ถูกแบ่งส่งหลายเที่ยว — null ถ้า TMS ไม่ส่งมา';
comment on column public.tms_shipments.qty_source is
  'ยอดไหนตรงกับ unit ตอน sync: qty / split / null = ไม่ตรงทั้งคู่ ต้องมีคนดู';
