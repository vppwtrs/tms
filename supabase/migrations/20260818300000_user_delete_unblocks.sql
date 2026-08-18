-- ลบผู้ใช้ไม่ได้ เพราะคอลัมน์ "ใครทำ" กันไว้หมด
--
-- ตารางร่องรอยหลายตัวชี้กลับมาที่ public.users แบบ NO ACTION:
--   tms_driver_map.mapped_by, tms_vehicle_map.mapped_by, tms_dealer_map.mapped_by,
--   tms_sync_log.synced_by, users.approved_by, quotes/customer_*.created_by
-- คนที่เคยจับคู่คนขับหรือเคยกดดึงข้อมูลแม้ครั้งเดียวจึงลบไม่ได้ตลอดไป
-- (ตรวจจริง: บัญชีคนวางแผนคนหนึ่งมี 162 แถวใน tms_sync_log และ 29 คีย์ทะเบียนรถ)
--
-- คอลัมน์พวกนี้เป็น "ร่องรอยว่าใครทำ" ไม่ใช่ข้อมูลธุรกิจที่ขาดไม่ได้ —
-- ค่าที่เหมาะเมื่อบัญชีถูกลบคือ null (ไม่รู้แล้วว่าใคร) ไม่ใช่การห้ามลบทั้งบัญชี
-- เปลี่ยนเป็น ON DELETE SET NULL ทุกตัวที่คอลัมน์ยอมรับ null
--
-- ยกเว้น pod.collected_by ที่เป็น NOT NULL — POD คือหลักฐานการส่งมอบ
-- "ใครเป็นคนเก็บ" เป็นส่วนหนึ่งของหลักฐาน ทิ้งไม่ได้ จึงคงการบล็อกไว้
-- แต่ต้องบอกเหตุผลให้ชัดแทนที่จะล้มเงียบ ๆ (ทำฝั่ง Edge Function)

do $$
declare
  v record;
begin
  for v in
    select tc.constraint_name, tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
      join information_schema.referential_constraints rc
        on rc.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
      join information_schema.columns c
        on c.table_schema = 'public' and c.table_name = tc.table_name
       and c.column_name = kcu.column_name
     where tc.constraint_type = 'FOREIGN KEY'
       and tc.table_schema = 'public'
       and ccu.table_name = 'users'
       and rc.delete_rule = 'NO ACTION'
       and c.is_nullable = 'YES'
  loop
    execute format('alter table public.%I drop constraint %I', v.table_name, v.constraint_name);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.users (id) on delete set null',
      v.table_name, v.constraint_name, v.column_name);
  end loop;
end;
$$;
