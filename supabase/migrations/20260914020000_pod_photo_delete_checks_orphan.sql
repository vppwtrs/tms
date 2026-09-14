-- pod-photo-delete ลบรูปได้โดยไม่เช็คว่าเป็นไฟล์กำพร้าจริงไหม
--
-- pod_photo_admin() เช็คแค่สิทธิ์ pod.write แบบเหมารวม ไม่รู้ด้วยซ้ำว่ากำลังจะลบ
-- path ไหน role dispatcher ก็ถือ pod.write (ดู 20260819040000_pod_view_perms.sql)
-- และเห็น path รูปของออเดอร์ที่ยัง active ได้ตามปกติผ่าน pod_of_order — เอา path
-- นั้นมายิงเข้า pod-photo-delete ตรง ๆ ได้เลย ฟังก์ชันเดิมลบให้แบบไม่เช็คอะไรทั้งนั้น
-- ทั้งที่ตั้งใจไว้ (ดู comment เดิมในไฟล์ Edge Function) ว่าใช้เฉพาะไฟล์กำพร้าจาก
-- force_delete เท่านั้น — ความตั้งใจไม่เคยถูกเขียนเป็นโค้ด
--
-- ทางแก้: ให้ฐานเป็นคนตัดสินว่า path ไหน "กำพร้าจริง" ไม่ใช่เชื่อคำขอของผู้เรียก
-- กำพร้า = ไม่มีแถวไหนใน pod_photos.path หรือ pod.photo_path (คอลัมน์เก่า) อ้างถึง
-- Edge Function ต้องเรียกฟังก์ชันนี้กรอง path ก่อน แล้วลบเฉพาะที่ผ่านเท่านั้น
-- ต่อให้ role ที่เรียกมี pod.write เต็ม ๆ ก็ลบรูปที่ยังมีใบอ้างถึงอยู่ไม่ได้

create or replace function public.pod_orphan_paths(p_paths text[])
returns text[]
language sql
stable
security definer
set search_path to 'public', 'auth'
as $fn$
  select coalesce(array_agg(p), array[]::text[])
    from unnest(p_paths) as p
   where not exists (select 1 from public.pod_photos where path = p)
     and not exists (select 1 from public.pod where photo_path = p);
$fn$;

grant execute on function public.pod_orphan_paths(text[]) to authenticated;
