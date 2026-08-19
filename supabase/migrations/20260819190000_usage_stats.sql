-- ดูว่ากินโควตาแพลนฟรีไปเท่าไหร่แล้ว โดยไม่ต้องเปิด dashboard ของ Supabase
--
-- คนที่ต้องตัดสินใจว่า "เก็บรูปหลักฐานย้อนหลังได้กี่เดือน" คือคนที่ดูแลระบบนี้
-- ไม่ใช่คนที่ถือบัญชี Supabase และสองคนนี้ไม่ใช่คนเดียวกันเสมอไป ตัวเลขที่ต้องใช้
-- ตัดสินใจจึงควรอยู่ในหน้าจอเดียวกับที่เขาทำงานอยู่
--
-- สามในสี่ตัวที่ dashboard แสดง อ่านได้จากในฐานเองทั้งหมด:
--   ขนาดฐาน      pg_database_size
--   ขนาดไฟล์     ผลรวม metadata->>'size' ของ storage.objects
--   ผู้ใช้ต่อเดือน auth.users.last_sign_in_at ย้อนหลัง 30 วัน
--
-- ตัวที่สี่ (egress) อ่านจากในฐานไม่ได้เลย มันถูกนับที่ชั้น network ของ Supabase
-- ไม่ใช่ใน Postgres ต้องผ่าน Management API ซึ่งต้องใช้ token ระดับบัญชี
-- หน้าจอจึงบอกตรง ๆ ว่ายังไม่มีตัวเลขนั้น ดีกว่าเดาแล้วให้คนเอาไปวางแผนผิด
--
-- หมายเหตุเรื่อง MAU: Supabase นับผู้ใช้ที่ "ยิงคำขอ auth" ในรอบบิล ส่วนที่นี่นับ
-- จากเวลาเข้าสู่ระบบล่าสุด ซึ่งใกล้เคียงแต่ไม่ใช่ตัวเดียวกัน — คนที่เปิดแอปค้างไว้
-- แล้ว refresh token เงียบ ๆ นับเป็น MAU ของ Supabase แต่ last_sign_in_at ไม่ขยับ
-- ตัวเลขนี้จึงมีไว้ดูแนวโน้ม ไม่ใช่ไว้เถียงกับใบแจ้งหนี้

create or replace function public.usage_stats()
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'storage'
as $fn$
declare
  v_db      bigint;
  v_files   bigint;
  v_objects bigint;
  v_mau     bigint;
  v_tables  json;
  v_buckets json;
begin
  /* ผูกกับ users.manage ตัวเดียวกับหน้าอื่นในกลุ่มผู้ดูแล — ตัวเลขพวกนี้บอกขนาด
     ของธุรกิจโดยอ้อม (ส่งกี่เที่ยว เก็บรูปกี่ใบ) ไม่ใช่ของที่คนขับควรเห็น */
  if not app.has_perm('users.manage') then
    raise exception 'ไม่มีสิทธิ์ดูการใช้งานระบบ' using errcode = '42501';
  end if;

  select pg_database_size(current_database()) into v_db;

  select coalesce(sum((o.metadata->>'size')::bigint), 0), count(*)
    into v_files, v_objects
    from storage.objects o;

  select count(*) into v_mau
    from auth.users u
   where u.last_sign_in_at > now() - interval '30 days';

  /* ตารางที่กินที่มากที่สุด — คนที่จะลดขนาดฐานต้องรู้ก่อนว่าจะไปลดตรงไหน
     รวม index ด้วย (total) เพราะ index ก็กินโควตาเท่ากับข้อมูล */
  select json_agg(t) into v_tables
    from (
      select c.relname as name,
             pg_total_relation_size(c.oid) as bytes,
             c.reltuples::bigint as approx_rows
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
       order by pg_total_relation_size(c.oid) desc
       limit 12
    ) t;

  select json_agg(b) into v_buckets
    from (
      select o.bucket_id as name,
             count(*) as objects,
             coalesce(sum((o.metadata->>'size')::bigint), 0) as bytes
        from storage.objects o
       group by o.bucket_id
       order by 3 desc
    ) b;

  return json_build_object(
    'db_bytes', v_db,
    'file_bytes', v_files,
    'file_objects', v_objects,
    'mau_estimate', v_mau,
    'tables', coalesce(v_tables, '[]'::json),
    'buckets', coalesce(v_buckets, '[]'::json),
    'measured_at', now()
  );
end;
$fn$;

grant execute on function public.usage_stats() to authenticated;
