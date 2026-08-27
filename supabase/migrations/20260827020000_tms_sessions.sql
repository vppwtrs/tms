-- ที่เก็บ token ของ TMS ฝั่งเซิร์ฟเวอร์ — เอาออกจากเบราว์เซอร์
--
-- เดิม tms-gateway/auth คืน token ของระบบบริษัทลงมาให้หน้าเว็บเก็บใน sessionStorage
-- แปลว่า XSS จุดเดียวในเว็บเรา = token ที่เข้าถึงข้อมูลภายในบริษัทได้หลุดออกไป
-- ซึ่งเป็นความเสียหายที่ไม่ได้จบที่ระบบเรา แต่ลามไปถึงระบบของบริษัท
--
-- ===== ทำไมถึงยอมขัดกฎข้อ 4 ที่หัวไฟล์ tms-gateway =====
-- กฎเขียนว่า "ฟังก์ชันนี้ไม่มีรหัสของบริษัทเก็บไว้เลยสักตัว" ซึ่งเขียนไว้ตอนเทียบกับ
-- แผน tms-sync ที่ต้องเก็บ "รหัสผ่าน service account" ไว้ถาวร — ของนั้นถูกยึดไปแล้ว
-- คนร้ายล็อกอิน TMS ได้เลยและตลอดไป
--
-- ของที่เก็บตรงนี้ต่างกันสามอย่าง: เป็น token ไม่ใช่รหัสผ่าน (ตั้งใหม่ไม่ได้ เดาต่อยอด
-- ไม่ได้) · อายุสั้นตามที่ TMS กำหนดมาเอง · เป็นของรายคนที่เจ้าตัวเพิ่งล็อกอินเข้ามา
-- ไม่ใช่บัญชีกลางที่เปิดประตูให้ทั้งบริษัท
--
-- และแลกมากับการปิดรูที่ใหญ่กว่า: token ไม่เคยเดินทางถึงเบราว์เซอร์อีกเลย

create table if not exists public.tms_sessions (
  auth_id    uuid        primary key references auth.users(id) on delete cascade,
  token      text        not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

/* ไม่มี policy สักอันโดยตั้งใจ — RLS เปิดแล้วไม่มี policy = ปฏิเสธทุกคน
   รวมทั้งเจ้าของ token เอง เหลือทางเดียวคือ service_role ที่ Edge Function ใช้
   ผลคือต่อให้ใครยึด session ของผู้ใช้ไปได้ ก็ยัง select ตารางนี้ไม่ได้
   ทำได้อย่างเดียวคือเรียกงานที่อยู่ใน OPS ผ่าน gateway เหมือนผู้ใช้คนนั้น */
alter table public.tms_sessions enable row level security;

/* ไม่มี grant ให้ anon หรือ authenticated — ไม่ใช่แค่พึ่ง RLS อย่างเดียว
   สองชั้นเพราะตารางนี้พลาดแล้วเสียหายถึงระบบของบริษัท ไม่ใช่แค่ของเรา */
revoke all on table public.tms_sessions from anon, authenticated;

/* กวาดของเก่าทิ้ง — ต่อจาก tms_login_sweep ใน 20260827010000 ตัวเดียวกัน
   ไม่แยกฟังก์ชันใหม่เพราะทั้งคู่ถูกเรียกจากที่เดียวกันและด้วยเหตุผลเดียวกัน
   token ที่หมดอายุแล้วไม่มีประโยชน์กับใคร แต่ยังเป็นของบริษัทที่นอนอยู่ในฐานเรา */
create or replace function public.tms_login_sweep()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.tms_login_attempts where window_start < now() - interval '1 day';
  delete from public.tms_sessions      where expires_at   < now() - interval '1 hour';
$$;

revoke all on function public.tms_login_sweep() from public;
grant execute on function public.tms_login_sweep() to service_role;
