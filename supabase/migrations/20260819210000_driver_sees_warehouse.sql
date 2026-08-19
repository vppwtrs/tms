-- คนขับไม่รู้ว่าต้องไปโหลดของที่คลังไหน
--
-- รหัสคลังกับเขตมาจาก TMS พร้อมเที่ยว แต่ถูกเขียนรวมไว้ในข้อความหมายเหตุของเที่ยว
-- ("นำเข้าจาก TMS · เที่ยว X · KM23-CW-02 · เขต BKK1") ซึ่งเป็นข้อความที่คนอ่านได้
-- แต่หน้าจอเอาไปทำอะไรไม่ได้ ต้องเดาจากการตัดคำ
--
-- ฝั่งออฟฟิศเพิ่งได้เห็นคลังบนการ์ดเที่ยว โดยอ่านผ่านลิงก์กลับไปที่ tms_trips
-- แต่คนขับอ่านผ่าน view my_trips ซึ่งไม่มีคอลัมน์นั้น — และเขาคือคนที่ต้องขับไป
-- โหลดของจริง บริษัทที่มีหลายคลังในเมืองเดียวกัน การไปผิดคลังคือเสียครึ่งเช้า
--
-- เพิ่มคอลัมน์ต่อท้ายเท่านั้น (42P16) — แทรกกลางต้อง drop view ซึ่งพาลทิ้ง grant ไปด้วย

create or replace view public.my_trips as
  select t.id, t.trip_no, t.status, t.departed_at, t.arrived_at, t.notes,
         v.plate_no, v.vehicle_type,
         t.accepted_at, t.issue_note, t.issue_at,
         /* ของคนที่กำลังเปิดแอปอยู่ ไม่ใช่ของทั้งเที่ยว */
         (select td.accepted_at from public.trip_drivers td
           where td.trip_id = t.id and td.driver_id = app.current_driver_id()) as my_accepted_at,
         (t.driver_id = app.current_driver_id()) as is_primary,
         (select count(*)::int from public.trip_drivers td where td.trip_id = t.id) as driver_count,
         (select count(*)::int from public.trip_drivers td
           where td.trip_id = t.id and td.accepted_at is not null) as accepted_count,
         /* อ่านจากเที่ยวดิบตรง ๆ ไม่ก็อปคอลัมน์มาไว้ที่ trips — ค่าจึงไม่มีวันเพี้ยน
            จากต้นทาง และไม่ต้อง backfill ของเก่า
            เที่ยวที่สร้างเองในระบบไม่มีเที่ยวดิบ ได้ null ซึ่งถูกแล้ว มันไม่มีคลังต้นทาง */
         (select tt.warehouse_code from public.tms_trips tt where tt.trip_id = t.id limit 1) as warehouse_code,
         (select tt.area from public.tms_trips tt where tt.trip_id = t.id limit 1) as area
    from public.trips t
    join public.vehicles v on v.id = t.vehicle_id
   where app.has_perm('myjobs.view')
     and (
       t.driver_id = app.current_driver_id()
       or exists (
         select 1 from public.trip_drivers td
          where td.trip_id = t.id and td.driver_id = app.current_driver_id()
       )
     );

grant select on public.my_trips to authenticated;
