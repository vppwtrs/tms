-- บังคับตั้งรหัสผ่านใหม่ตอนล็อกอินครั้งแรก
--
-- admin สร้างบัญชีให้คนขับด้วยรหัสสุ่ม แล้วรหัสนั้นถูกส่งต่อทางไลน์/บอกปากเปล่า
-- ตราบใดที่คนขับยังไม่เปลี่ยน คนที่เห็นข้อความนั้นก็ยังเข้าระบบแทนเขาได้
-- ธงนี้ทำให้แอปกั้นหน้าจอไว้จนกว่าเจ้าของบัญชีจะตั้งรหัสของตัวเอง
--
-- บัญชีที่ล็อกอินด้วยรหัสของ TMS บริษัท (auth_source = 'tms') ไม่เกี่ยวเลย
-- รหัสฝั่งเราของบัญชีพวกนั้นถูกสุ่มใหม่ทุกครั้งที่ล็อกอินอยู่แล้ว

alter table public.users
  add column if not exists must_change_password boolean not null default false;

comment on column public.users.must_change_password is
  'true = ยังใช้รหัสที่ผู้ดูแลตั้งให้ ต้องตั้งรหัสของตัวเองก่อนใช้งาน';

-- ของเดิมทั้งหมดถือว่าไม่ต้องเปลี่ยน — บังคับย้อนหลังคือล็อกคนที่ใช้งานอยู่ออกจากระบบ
-- โดยที่ไม่มีใครแจ้งเขาล่วงหน้า ธงนี้มีผลกับบัญชีที่สร้าง/รีเซ็ตหลังจากนี้เท่านั้น

/* ขอบเขตที่ต้องรู้: ธงนี้เป็นด่านของ "หน้าจอ" ไม่ใช่ของฐานข้อมูล
   คนที่ถือรหัสชั่วคราวและรู้วิธียิง RPC ตรง ยังเรียก clear_my_password_flag()
   ปลดธงเองได้โดยไม่เปลี่ยนรหัส — SQL ไม่มีทางรู้ว่ารหัสถูกเปลี่ยนแล้วจริงหรือยัง
   (auth.users อยู่คนละ schema และเก็บเป็น hash)
   สิ่งที่ด่านนี้แก้จริงคือ "รหัสชั่วคราวถูกใช้ต่อไปเรื่อย ๆ เพราะไม่มีใครเตือน"
   ไม่ใช่ "คนตั้งใจเลี่ยง" ซึ่งคนตั้งใจเลี่ยงก็คือเจ้าของบัญชีเอง ไม่ใช่คนอื่น

   ปลดธงหลังเปลี่ยนรหัสสำเร็จ — เจ้าของบัญชีปลดของตัวเองได้เท่านั้น
   ไม่เปิดเป็น policy ให้ update users ตรง ๆ เพราะนั่นเปิดทั้งแถวรวมถึง role */
create or replace function public.clear_my_password_flag()
returns void
language sql
security definer
set search_path = public
as $$
  update public.users
  set must_change_password = false
  where auth_id = auth.uid()
$$;

revoke all on function public.clear_my_password_flag() from public;
grant execute on function public.clear_my_password_flag() to authenticated;
