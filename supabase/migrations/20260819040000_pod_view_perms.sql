-- คนวางแผนเห็น "ไม่มี POD" ทั้งที่คนขับเซ็นแล้ว
--
-- อาการ: หน้าออเดอร์ขึ้น badge "ไม่มี POD" ทุกใบ ตรวจในฐานแล้วมีจริง 3 แถว status = collected
--
-- สาเหตุ: นโยบาย pod_select คือ app.has_perm('pod.view')
--         และ pod_photos_read / pod_update อ้าง pod.view, pod.write, pod.verify
--         แต่สิทธิ์สามชื่อนี้ไม่เคยถูกใส่ใน public.permissions และไม่เคยแจกให้บทบาทไหน
--         has_perm จึงคืน false เสมอ — คนวางแผนอ่านตาราง pod ไม่ได้เลย
--         คนขับยังเห็นของตัวเองเพราะมีนโยบายแยก pod_self_select (collected_by = ตัวเอง)
--         ตระกูลเดียวกับ drivers.delete (20260818050000) และ myjobs.progress (20260819030000)
--
-- หมายเหตุ: การแจกสิทธิ์ที่นี่เป็นค่าตั้งต้นของบทบาท ปรับรายคนได้ที่หน้าผู้ใช้และสิทธิ์

insert into public.permissions (permission, label)
values
  ('pod.view', 'ดูหลักฐานการส่ง'),
  ('pod.write', 'จัดการหลักฐานการส่ง'),
  ('pod.verify', 'ยืนยันหลักฐานการส่ง'),
  /* สองตัวนี้อยู่ในรายการสิทธิ์ฝั่งเว็บและใน admin-seed-role-presets มาตลอด
     แต่ไม่เคยมีในตาราง permissions จริง (FK ของ role_permissions เลยตีตกตอนแจก)
     ที่คนขับยังเก็บ POD ได้เพราะ save_pod ตรวจ myjobs.pod หรือ pod.write ไม่ได้ตรวจสองตัวนี้ */
  ('pod.insert', 'ส่งหลักฐานการส่ง'),
  ('pod.update', 'แก้ไขหลักฐานการส่ง')
on conflict (permission) do nothing;

insert into public.role_permissions (role, permission)
values
  ('admin', 'pod.view'), ('admin', 'pod.write'), ('admin', 'pod.verify'),
  -- คนวางแผนต้องเห็นและแนบรูปเพิ่มได้ แต่การ "ยืนยัน" ยังเป็นของแอดมิน
  ('dispatcher', 'pod.view'), ('dispatcher', 'pod.write'),
  -- ดูอย่างเดียวก็ต้องเห็นว่าใบไหนมีหลักฐาน ไม่งั้นรายงานไม่ตรงกับความจริง
  ('viewer', 'pod.view'),
  -- คนขับเห็นของตัวเองผ่าน pod_self_select อยู่แล้ว ไม่ต้องเปิดให้เห็นของคนอื่น
  ('driver', 'pod.insert'), ('driver', 'pod.update')
on conflict do nothing;
