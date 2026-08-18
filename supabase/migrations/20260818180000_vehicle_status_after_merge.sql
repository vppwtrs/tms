-- คืนสถานะรถให้ตรงกับเที่ยวที่วิ่งอยู่จริง หลังรวมทะเบียนซ้ำ
--
-- การรวมย้ายเที่ยวจากคันที่ถูกลบมาที่คันที่เก็บไว้ แต่ไม่ได้ย้ายสถานะตามมา
-- คันที่รับเที่ยวมาจึงยังเป็น "ว่าง" ทั้งที่มีเที่ยวกำลังวิ่งอยู่
-- (3ฒน5038 รับเที่ยวจาก 3ฒน5038-02 มาแล้วยังขึ้นว่าง)
--
-- ตั้งจากความจริงในตาราง trips ไม่ใช่เดาจากค่าเดิมของทั้งสองคัน

update public.vehicles v
   set status = 'on_trip'
 where v.status = 'available'
   and exists (
     select 1 from public.trips t
      where t.vehicle_id = v.id and t.status in ('planned', 'in_progress')
   );

update public.vehicles v
   set status = 'available'
 where v.status = 'on_trip'
   and not exists (
     select 1 from public.trips t
      where t.vehicle_id = v.id and t.status in ('planned', 'in_progress')
   );
