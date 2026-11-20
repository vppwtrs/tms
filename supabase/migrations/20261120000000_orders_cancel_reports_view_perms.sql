-- เพิ่มสิทธิ์ orders.cancel (ยกเลิกออเดอร์) และ reports.view (ดูรายงาน) เข้า catalog
--
-- ค่าตั้งต้น: ใครมี dispatch.view อยู่ได้ reports.view ด้วย (ไม่ให้ใครเสียสิทธิ์เข้าหน้ารายงาน)
--             ใครมี orders.write อยู่ได้ orders.cancel ด้วย
-- ครอบคลุมทั้งค่าตั้งต้นของบทบาท (role_permissions) และข้อยกเว้นรายคน (user_permissions)
-- รันซ้ำได้

insert into public.permissions (permission, label)
values
  ('orders.cancel', 'ยกเลิกออเดอร์'),
  ('reports.view', 'ดูรายงาน')
on conflict (permission) do nothing;

insert into public.role_permissions (role, permission)
select role, 'reports.view' from public.role_permissions where permission = 'dispatch.view'
on conflict do nothing;

insert into public.role_permissions (role, permission)
select role, 'orders.cancel' from public.role_permissions where permission = 'orders.write'
on conflict do nothing;

-- ข้อยกเว้นรายคน (allow/deny) ตามสิทธิ์เดิม
insert into public.user_permissions (user_id, permission, allowed, mode)
select user_id, 'reports.view', allowed, mode from public.user_permissions where permission = 'dispatch.view'
on conflict (user_id, permission) do nothing;

insert into public.user_permissions (user_id, permission, allowed, mode)
select user_id, 'orders.cancel', allowed, mode from public.user_permissions where permission = 'orders.write'
on conflict (user_id, permission) do nothing;
