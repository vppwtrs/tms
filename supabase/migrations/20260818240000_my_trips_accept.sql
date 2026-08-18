-- หน้าคนขับต้องรู้ว่าตัวเองกดรับงานนี้แล้วหรือยัง
--
-- view my_trips ไม่มี accepted_at ฝั่งแอปจึงแยกไม่ออกระหว่าง "งานใหม่ที่ยังไม่รับ"
-- กับ "งานที่รับแล้วรอออกรถ" ซึ่งเป็นสองสถานะที่ต้องการปุ่มคนละปุ่ม
--
-- ยังไม่ใส่คอลัมน์เงินเหมือนเดิม — กฎ "ห้ามตัวเลขเงินในหน้าคนขับ" บังคับด้วยการที่
-- view ไม่มีคอลัมน์นั้น ไม่ใช่ด้วยการที่หน้าจอไม่แสดง

create or replace view public.my_trips as
  select t.id, t.trip_no, t.status, t.departed_at, t.arrived_at, t.notes,
         v.plate_no, v.vehicle_type,
         /* คอลัมน์ใหม่ต้องต่อท้ายเท่านั้น — create or replace view เปลี่ยนลำดับหรือ
            แทรกกลางไม่ได้ (42P16) จะต้อง drop ก่อน ซึ่งพาลทำให้ policy ที่อ้างถึงหายไปด้วย */
         t.accepted_at, t.issue_note, t.issue_at
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
