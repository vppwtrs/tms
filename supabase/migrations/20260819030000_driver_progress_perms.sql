-- คนขับเห็นงานแต่กดรับงานไม่ได้ — ไม่มีปุ่มขึ้นเลย
--
-- อาการ: หน้า "งานของฉัน" แสดงเที่ยว TRP-2026-0002 พร้อมข้อความ
--        "งานใหม่จาก TMS — กดรับงานก่อนถึงจะเริ่มเดินทางได้" แต่แถบปุ่มล่างจอไม่โผล่
--
-- สาเหตุ: แถบปุ่มผูกกับ canProgress = can('myjobs.progress')
--         สิทธิ์ชื่อนี้ถูกอ้างในโค้ดทั้งสองฝั่ง (RPC accept_trip / start_trip / complete_trip
--         และหน้าเว็บ CloudMyJobs) แต่ไม่เคยถูกขึ้นทะเบียนใน public.permissions
--         และไม่เคยแจกให้บทบาทไหน — แบบเดียวกับ drivers.delete ใน 20260818050000
--         ผลคือ has_perm คืน false เสมอ ปุ่มไม่ขึ้น และต่อให้กดได้ฐานก็ปฏิเสธ
--         myjobs.pod (ปุ่มเก็บ POD) หายไปด้วยเหตุเดียวกัน
--
-- แก้: ขึ้นทะเบียนทั้งสองตัว แล้วแจกให้ driver (คนทำงาน) และ admin
--      ไม่แจก dispatcher — คนวางแผนไม่ควรกดรับงานหรือปิดจุดส่งแทนคนขับ
--      ถ้าอยากให้แจกเป็นราย ๆ ไป ทำได้ที่หน้าผู้ใช้และสิทธิ์

insert into public.permissions (permission, label)
values
  ('myjobs.progress', 'เดินงานของฉัน (รับงาน/เริ่ม/ปิดจุดส่ง)'),
  ('myjobs.pod', 'เก็บหลักฐานการส่งของงานฉัน')
on conflict (permission) do nothing;

insert into public.role_permissions (role, permission)
values
  ('admin', 'myjobs.progress'), ('admin', 'myjobs.pod'),
  ('driver', 'myjobs.progress'), ('driver', 'myjobs.pod'),
  ('driver', 'myjobs.view')
on conflict do nothing;
