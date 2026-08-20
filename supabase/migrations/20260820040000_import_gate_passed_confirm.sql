-- ด่านนำเข้าลืม Handling
--
-- `import_tms_trip` เคยถูกแก้ให้รับ "สถานะที่เดินหน้าไปจาก Confirm" แล้ว และคอมเมนต์
-- ในฟังก์ชันก็อธิบายเหตุผลไว้ถูกต้อง แต่รายชื่อที่เขียนจริงคือ
--
--   confirm, confirmed, ondelivery, on delivery, delivering, delivered, complete, completed
--
-- ขาด `handling` ไปหนึ่งคำ ซึ่งเป็นขั้นถัดจาก Confirm พอดี บันไดของ TMS คือ
--
--   2 Confirm → 3 Handling → 4 OnDelivery → 5 Completed        (6 = ยกเลิก)
--
-- ผลคือเที่ยวที่ยืนยันแล้วและคลังกำลังจัดของอยู่ ถูกปฏิเสธด้วยข้อความ
-- "เที่ยวนี้ยังไม่ Confirm ที่ TMS" ทั้งที่ TMS ยืนยันไปแล้ว ตอนเขียนอยู่นี้
-- มีเที่ยวติดอยู่แบบนี้สามใบ ทุกใบจับคู่คนขับครบและมีใบเบิกพร้อม
--
-- ด่าน status_id ก็เช็คแค่ `<> 5` คือรับเฉพาะ Completed เป็นตัวสำรอง แถวที่ TMS
-- ส่ง id มาแต่ข้อความเป็นคำที่ไม่รู้จัก จึงหลุดทุกขั้นยกเว้นขั้นสุดท้าย
-- เปลี่ยนเป็นช่วง 2..5 ซึ่งคือ "ผ่าน Confirm มาแล้วและยังไม่ถูกยกเลิก" ทั้งบันได
--
-- แก้เฉพาะสองสตริงนี้ ไม่แตะตรรกะอื่นในฟังก์ชันเลย ถ้าหาไม่เจอให้ล้มดัง ๆ
-- ดีกว่าเขียนทับฟังก์ชันยาวสองร้อยบรรทัดด้วยสำเนาที่อาจคัดตกไปหนึ่งบรรทัด
--
-- ด่านนำเข้าอัตโนมัติแยกกันโดยตั้งใจ (20260820030000) ตัวนั้นรับแค่ 2 กับ 3
-- เพราะการส่งเที่ยวที่ออกวิ่งไปแล้วเข้าจอคนขับเองเงียบ ๆ คือขอให้เขากดรับงาน
-- ที่กำลังทำอยู่ ส่วนตรงนี้มีคนกดและเห็นสถานะอยู่ตรงหน้า การเก็บงานย้อนหลัง
-- เป็นสิ่งที่คนตั้งใจทำได้

do $$
declare
  v_def  text;
  v_list text := '''confirm'', ''confirmed'', ''ondelivery''';
  v_id   text := 'coalesce(v_t.status_id, 0) <> 5';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'import_tms_trip'
   limit 1;

  if v_def is null then
    raise exception 'ไม่พบ import_tms_trip';
  end if;

  if position(v_list in v_def) = 0 then
    raise exception 'รายชื่อสถานะใน import_tms_trip ไม่อยู่ในรูปที่คาดไว้ — ตรวจด้วยมือก่อน';
  end if;
  if position(v_id in v_def) = 0 then
    raise exception 'เงื่อนไข status_id ใน import_tms_trip ไม่อยู่ในรูปที่คาดไว้ — ตรวจด้วยมือก่อน';
  end if;

  v_def := replace(v_def, v_list, '''confirm'', ''confirmed'', ''handling'', ''ondelivery''');
  v_def := replace(v_def, v_id, 'coalesce(v_t.status_id, 0) not between 2 and 5');

  execute v_def;
end
$$;
