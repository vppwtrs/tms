-- แยกสิทธิ์เมนูออกจาก dispatch.view / orders.view เป็นของตัวเอง
--   tms.view        ดูงานจาก TMS      <- dispatch.view
--   labels.print    พิมพ์ฉลาก         <- orders.view
--   documents.print พิมพ์ใบส่งสินค้า   <- dispatch.view
--   tracking.view   ติดตามรถ          <- dispatch.view
-- ใครมีสิทธิ์เดิมอยู่ได้สิทธิ์ใหม่ด้วย (ไม่ให้ใครเสียสิทธิ์เข้าหน้า)
-- ครอบคลุมทั้งค่าตั้งต้นของบทบาท (role_permissions) และข้อยกเว้นรายคน (user_permissions)
-- รันซ้ำได้

insert into public.permissions (permission, label)
values
  ('tms.view', 'ดูงานจาก TMS'),
  ('labels.print', 'พิมพ์ฉลาก'),
  ('documents.print', 'พิมพ์ใบส่งสินค้า'),
  ('tracking.view', 'ติดตามรถ')
on conflict (permission) do nothing;

insert into public.role_permissions (role, permission)
select rp.role, m.new_perm
from public.role_permissions rp
join (values
  ('dispatch.view', 'tms.view'),
  ('orders.view', 'labels.print'),
  ('dispatch.view', 'documents.print'),
  ('dispatch.view', 'tracking.view')
) as m(old_perm, new_perm) on m.old_perm = rp.permission
on conflict do nothing;

insert into public.user_permissions (user_id, permission, allowed, mode)
select up.user_id, m.new_perm, up.allowed, up.mode
from public.user_permissions up
join (values
  ('dispatch.view', 'tms.view'),
  ('orders.view', 'labels.print'),
  ('dispatch.view', 'documents.print'),
  ('dispatch.view', 'tracking.view')
) as m(old_perm, new_perm) on m.old_perm = up.permission
on conflict (user_id, permission) do nothing;
