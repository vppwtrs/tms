-- ย้ายรูปหลักฐาน POD จาก Supabase Storage ไป Cloudflare R2
--
-- เดิม: ฝั่งเว็บอัป/อ่านรูปตรงกับ bucket pod-photos ผ่าน storage RLS + signed URL
-- ใหม่: ฝั่งเว็บคุยกับ Edge Function (pod-photo-upload / pod-photo-url / pod-photo-delete)
--       ซึ่งถือ R2 credential เป็น secret แล้ว PUT/GET/DELETE เข้า R2 แทน
--
-- object key คงรูปเดิม  <order_id>/<uuid>.<ext>  ตาราง pod_photos.path ไม่เปลี่ยน
-- ตาราง/สิทธิ์ฝั่ง Postgres เกือบทั้งหมดใช้ต่อได้เลย ที่ต้องเพิ่มคือฟังก์ชันให้ Edge
-- Function เช็คสิทธิ์ก่อนแตะ R2 เพราะ R2 ไม่รู้จัก RLS
--
-- storage RLS ของ bucket pod-photos ที่มีอยู่เดิมปล่อยทิ้งไว้ได้ ไม่มีใครเรียกแล้ว
-- และยังต้องใช้ตอน migrate รูปเก่าออก (scripts/migrate-pod-to-r2.mjs อ่านผ่าน service key)

/* ตรวจว่า "ผู้เรียกมีสิทธิ์แนบรูปเข้าหลักฐานของออเดอร์นี้ไหม"
   คืน boolean แทนการ raise เพราะ Edge Function ต้องแปลงเป็น HTTP status เอง
   เงื่อนไขตรงกับด่านใน save_pod เป๊ะ — ถือ pod.write หรือเป็นคนขับ/ผู้ช่วยของเที่ยวนั้น
   และออเดอร์ต้องปิดงานแล้ว (รูปถ่ายตอนส่งของเสมอ) */
create or replace function public.pod_can_write(p_order_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $fn$
  select (app.has_perm('myjobs.pod') or app.has_perm('pod.write'))
     and exists (
       select 1
         from public.orders o
         join public.trips t on t.id = o.trip_id
        where o.id = p_order_id
          and o.status = 'delivered'
          and (t.driver_id = app.current_driver_id()
               or exists (select 1 from public.trip_drivers td
                           where td.trip_id = t.id
                             and td.driver_id = app.current_driver_id())
               or app.has_perm('pod.write'))
     );
$fn$;

/* สิทธิ์ "ลบไฟล์รูปที่กำพร้า" — กลุ่มเดียวกับที่ลบเที่ยวถาวรได้
   ใช้ตอนลบเที่ยวแล้ว force_delete คืน path ที่ไม่มีใบไหนอ้างถึงแล้วออกมา */
create or replace function public.pod_photo_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $fn$
  select app.has_perm('pod.write');
$fn$;

grant execute on function public.pod_can_write(bigint) to authenticated;
grant execute on function public.pod_photo_admin() to authenticated;
