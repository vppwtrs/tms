/* 0005 — ถังเก็บรูปหลักฐาน POD
 *
 * ของเดิมเก็บที่ server/data/pod นอก web root แล้วเสิร์ฟผ่าน endpoint ที่ต้องล็อกอิน
 * ของใหม่เก็บใน Supabase Storage — แต่หลักการเดิมต้องอยู่ครบ: เข้าถึงตรงไม่ได้
 *
 * public = false คือบรรทัดที่สำคัญที่สุดในไฟล์นี้
 * ถ้าเป็น true ใครก็เดา URL แล้วโหลดลายเซ็นลูกค้าได้โดยไม่ต้องล็อกอินเลย
 */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pod-photos', 'pod-photos', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

/* ชื่อไฟล์เป็น <order_id>/<uuid>.jpg — ส่วนแรกของ path คือ order_id
   ใช้ตัวนี้ผูกสิทธิ์กลับไปที่เที่ยวของคนขับ */
create or replace function app.owns_order_photo(object_name text)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select exists (
    select 1
      from public.orders o
      join public.trips t on t.id = o.trip_id
     where t.driver_id = app.current_driver_id()
       and o.id = nullif(split_part(object_name, '/', 1), '')::bigint
  )
$$;

revoke execute on function app.owns_order_photo from public;
grant execute on function app.owns_order_photo to authenticated;

/* คนขับอัปโหลดได้เฉพาะรูปของงานตัวเอง */
create policy pod_photo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pod-photos'
    and (
      (app.has_perm('myjobs.pod') and app.owns_order_photo(name))
      or app.has_perm('pod.write')
    )
  );

/* ออฟฟิศที่มีสิทธิ์ดู POD เห็นได้ทุกใบ คนขับเห็นเฉพาะของตัวเอง */
create policy pod_photo_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pod-photos'
    and (app.has_perm('pod.view') or app.owns_order_photo(name))
  );

/* ไม่มี policy update/delete โดยตั้งใจ — หลักฐานที่ลบหรือเขียนทับได้ ไม่ใช่หลักฐาน
   ต้องลบจริง (เช่น นโยบายเก็บข้อมูลครบอายุ) ให้ทำผ่าน service_role */
