-- ล้างงานที่ระบบสร้างเองจากการเดา แล้วเริ่มใหม่จากศูนย์
--
-- เที่ยววิ่งกับออเดอร์ทั้งหมดในฐานตอนนี้เกิดจาก auto_import_trips ซึ่งเดาว่าชื่อคนขับ
-- ใน TMS คือใคร แล้วสร้างงานให้เอง เดาผิดสะสมมาเรื่อย ๆ จนไม่มีใครเชื่อถือข้อมูลชุดนี้
-- (1,219 ใบไม่มีลูกค้าผูกอยู่ น้ำหนักเป็น 0 ทั้งหมด และไม่มี POD สักใบ)
-- เจ้าของระบบตัดสินใจล้างทิ้งแล้วเริ่มใหม่ โดยคนวางแผนเป็นคนสั่งงานเองทุกเที่ยว
--
-- ของดิบจาก TMS (tms_trips, tms_shipments) **ไม่ถูกแตะ** — สั่งงานใหม่ได้ทันทีจากของเดิม
-- ทะเบียนรถ พนักงานขับ บัญชีผู้ใช้ และการจับคู่ชื่อจาก TMS ก็อยู่ครบ

-- POD ไม่มีสักแถว (ตรวจแล้ว) แต่ต้องลบก่อนอยู่ดีเพราะ order_id เป็น NOT NULL
delete from public.pod;
delete from public.order_items;

-- ใบดิบจาก TMS จำไว้ว่าเคยถูกแปลงเป็นออเดอร์ใบไหน (tms_shipments.order_id)
-- ต้องปลดก่อน ไม่งั้น FK กันการลบไว้ทั้งชุด และเมื่อออเดอร์ถูกลบแล้ว
-- ใบเหล่านั้นต้องกลับไปเป็น "ยังไม่ถูกสั่งงาน" เพื่อสั่งใหม่ได้
update public.tms_shipments set order_id = null where order_id is not null;

delete from public.orders;
-- เที่ยวดิบจาก TMS ก็ชี้กลับมาที่เที่ยววิ่งเหมือนกัน ปลดก่อนลบด้วยเหตุผลเดียวกัน
-- ผลพลอยได้คือหน้าเที่ยวจาก TMS เลิกขึ้นว่า "นำเข้าแล้ว" ทั้งที่งานถูกลบไปแล้ว
update public.tms_trips set trip_id = null where trip_id is not null;

delete from public.trip_drivers;
delete from public.trips;

-- รถกับคนขับที่ค้างสถานะ "กำลังขนส่ง" จากเที่ยวที่เพิ่งถูกลบ ต้องกลับมาว่าง
update public.drivers  set status = 'available' where status = 'on_trip';
update public.vehicles set status = 'available' where status = 'on_trip';

-- ลำดับการแวะของแต่ละใบในเที่ยว — คนขับเป็นคนจัดเอง ไม่ใช่เรียงตามเลขที่ระบบสร้าง
-- null แปลว่ายังไม่จัด ให้เรียงตามกำหนดส่งไปก่อน
alter table public.orders add column if not exists seq smallint;

comment on column public.orders.seq is
  'ลำดับที่คนขับจัดเองว่าจะแวะร้านไหนก่อนในเที่ยวนั้น null = ยังไม่จัด';
