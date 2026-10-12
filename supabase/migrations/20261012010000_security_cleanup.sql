-- เก็บเรื่องเล็กจาก Security Advisor (ตรวจ 12 ต.ค. 2569)

-- 1) pod_orphan_paths — คนไม่ล็อกอินเรียกได้ ใช้เดาว่ามีไฟล์รูป POD ชื่อนั้นอยู่จริงไหม
--    ผู้เรียกจริงมีตัวเดียวคือ Edge Function pod-photo-delete ซึ่งเรียกด้วย token ของคนกด (authenticated)
revoke execute on function public.pod_orphan_paths(text[]) from public, anon;
grant execute on function public.pod_orphan_paths(text[]) to authenticated, service_role;

-- 2) sync_tms_trip_status — เป็นตัวเปล่าแล้ว แต่คนไม่ล็อกอินยังเรียกได้ ปิดไว้
revoke execute on function public.sync_tms_trip_status() from public, anon;
grant execute on function public.sync_tms_trip_status() to authenticated, service_role;

-- 3) effective_permissions — เดิมผู้ใช้ทุกคนดูสิทธิ์ของคนอื่นได้
--    เหลือแค่ดูของตัวเอง หรือคนที่ถือ users.manage (หน้าจัดการผู้ใช้)
create or replace function public.effective_permissions(p_user_id bigint)
 returns table(permission text, allowed boolean, source text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.permission,
         coalesce(o.mode = 'allow', rp.permission is not null) as allowed,
         case when o.mode is not null then 'user' else 'group' end as source
  from public.permissions p
  left join public.users u on u.id = p_user_id
  left join public.role_permissions rp on rp.role = u.role and rp.permission = p.permission
  left join public.user_permissions o on o.user_id = p_user_id and o.permission = p.permission
  where p_user_id = app.current_user_id() or app.has_perm('users.manage');
$function$;

-- 4) view my_orders — กรองด้วยคนขับปัจจุบันอยู่แล้ว คนไม่ล็อกอินได้ผลว่าง แต่ไม่มีเหตุให้เปิดสิทธิ์ไว้
revoke select on public.my_orders from anon;

-- 5) ล็อก search_path ของฟังก์ชันช่วยใน schema app — กันการเอา object ชื่อซ้ำมาวางแทรก
alter function app.driver_key(text) set search_path = public, app;
alter function app.driver_label(text) set search_path = public, app;
alter function app.driver_nick(text) set search_path = public, app;
alter function app.order_rank(order_status) set search_path = public, app;
alter function app.plate_key(text) set search_path = public, app;
alter function app.tms_driver_names(text) set search_path = public, app;
alter function app.trip_drivers_cap() set search_path = public, app;
alter function app.trip_rank(trip_status) set search_path = public, app;
