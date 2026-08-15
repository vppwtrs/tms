/* 0002 — ย้ายโมเดลสิทธิ์จาก server/src/core/permissions.ts มาไว้ในฐานข้อมูล
 *
 * ของเดิม preset ของบทบาทเป็น "โค้ด" (ROLE_PRESET) แล้ว requirePerm() ตรวจตอน request
 * ของใหม่ preset เป็น "ข้อมูล" (role_permissions) เพราะ RLS ทำงานอยู่ใน DB
 * จะเรียกฟังก์ชัน TypeScript ไม่ได้
 *
 * สูตรคิดสิทธิ์ยังเหมือนเดิมเป๊ะ:
 *   สิทธิ์ที่ใช้จริง = preset ของบทบาท ∪ ที่เปิดเพิ่ม − ที่ปิดไว้
 *   user_permissions เก็บเฉพาะส่วนที่ต่างจาก preset เหมือนเดิม
 */

create table public.permissions (
  permission text primary key,
  label      text not null
);

insert into public.permissions (permission, label) values
  ('dashboard.view',   'ดูหน้าภาพรวม (มีตัวเลขรายได้)'),
  ('orders.view',      'ดูออเดอร์ทั้งหมด (เห็นค่าขนส่ง)'),
  ('orders.write',     'สร้าง/แก้ไขออเดอร์'),
  ('orders.cancel',    'ยกเลิกออเดอร์'),
  ('dispatch.view',    'ดูแผนงานขนส่ง'),
  ('dispatch.write',   'สร้าง/จัดการเที่ยววิ่ง'),
  ('quotes.view',      'ดูใบเสนอราคา'),
  ('quotes.write',     'สร้าง/แก้ไขใบเสนอราคา'),
  ('quotes.convert',   'แปลงใบเสนอราคาเป็นออเดอร์'),
  ('customers.view',   'ดูข้อมูลลูกค้า'),
  ('customers.write',  'สร้าง/แก้ไขลูกค้า · บันทึกการติดต่อ'),
  ('customers.delete', 'ลบลูกค้า'),
  ('vehicles.view',    'ดูข้อมูลรถ'),
  ('vehicles.write',   'สร้าง/แก้ไขรถ · เปลี่ยนสถานะ'),
  ('vehicles.delete',  'ลบรถ'),
  ('drivers.view',     'ดูข้อมูลพนักงานขับ'),
  ('drivers.write',    'สร้าง/แก้ไขพนักงานขับ · เปลี่ยนสถานะ'),
  ('drivers.delete',   'ลบพนักงานขับ'),
  ('pod.view',         'ดูหลักฐานการส่งมอบ'),
  ('pod.write',        'เก็บ/แก้ไขหลักฐานการส่งมอบ'),
  ('pod.verify',       'ยืนยันหลักฐาน (ล็อกถาวร)'),
  ('reports.view',     'ดูรายงาน'),
  ('reports.export',   'ส่งออกรายงาน Excel'),
  ('csv.view',         'ดูหน้าข้อมูล CSV'),
  ('csv.export',       'สั่งเขียนไฟล์ CSV ใหม่'),
  ('users.manage',     'จัดการผู้ใช้และสิทธิ์'),
  ('settings.manage',  'ตั้งค่าระบบ'),
  ('myjobs.view',      'ดูงานของตัวเอง'),
  ('myjobs.progress',  'อัปเดตความคืบหน้างานของตัวเอง'),
  ('myjobs.pod',       'เก็บหลักฐานการส่งมอบงานของตัวเอง');

create table public.role_permissions (
  role       user_role not null,
  permission text      not null references public.permissions (permission) on delete cascade,
  primary key (role, permission)
);

/* คนขับ — สามสิทธิ์นี้เท่านั้น และห้ามหลุดไปอยู่บทบาทอื่น
   เขียนตรง ๆ ไม่ผ่าน generate เพราะเป็นชุดที่ต้องอ่านแล้วเห็นทันทีว่ามีอะไรบ้าง */
insert into public.role_permissions (role, permission)
values ('driver', 'myjobs.view'), ('driver', 'myjobs.progress'), ('driver', 'myjobs.pod');

/* admin — ทุกอย่างยกเว้นสิทธิ์คนขับ
   ที่ไม่ให้สิทธิ์คนขับเพราะ admin ไม่ได้ผูกกับ drivers record ให้ไปก็ใช้ไม่ได้
   จะได้เมนูที่กดแล้วว่างเปล่า เหมือนเหตุผลเดิมใน ROLE_PRESET */
insert into public.role_permissions (role, permission)
select 'admin', permission from public.permissions
 where permission not like 'myjobs.%';

/* dispatcher — งานประจำวันครบ แต่ลบข้อมูลหลักไม่ได้ และแตะผู้ใช้/ตั้งค่าไม่ได้ */
insert into public.role_permissions (role, permission)
select 'dispatcher', permission from public.permissions
 where permission not like 'myjobs.%'
   and permission not like '%.delete'
   and permission not in ('users.manage', 'settings.manage');

/* viewer — ดูอย่างเดียว บวก export รายงาน */
insert into public.role_permissions (role, permission)
select 'viewer', permission from public.permissions
 where permission not like 'myjobs.%'
   and (permission like '%.view' or permission = 'reports.export');

/* ===== ฟังก์ชันที่ policy ทุกตัวเรียกใช้ =====
 *
 * ทั้งหมดเป็น security definer เพราะต้องอ่านตาราง users / role_permissions
 * ซึ่งตัวผู้ใช้เองไม่มีสิทธิ์อ่านตรง ๆ  ถ้าเป็น invoker จะเกิดวงวน:
 * policy เรียกฟังก์ชัน -> ฟังก์ชันอ่าน users -> policy ของ users เรียกฟังก์ชัน -> วน
 *
 * set search_path บังคับไว้ทุกตัว — security definer ที่ไม่ล็อก search_path
 * คือช่องให้คนสร้างตารางชื่อซ้ำใน schema ตัวเองแล้วหลอกให้ฟังก์ชันอ่านของปลอม
 */

create or replace function app.current_user_id()
returns bigint
language sql stable security definer set search_path = public, auth
as $$
  select u.id from public.users u
   where u.auth_id = auth.uid()
     and u.is_active
$$;

comment on function app.current_user_id is
  'id ในตาราง users ของคนที่ล็อกอินอยู่ — คืน null ถ้าไม่ได้ล็อกอินหรือถูกปิดบัญชี';

create or replace function app.current_driver_id()
returns bigint
language sql stable security definer set search_path = public, auth
as $$
  select d.id from public.drivers d
   where d.user_id = app.current_user_id()
$$;

create or replace function app.has_perm(p text)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select coalesce(
    /* ที่ admin ตั้งทับรายคนมาก่อนเสมอ ทั้งเปิดเพิ่มและปิดทิ้ง */
    (select up.allowed
       from public.user_permissions up
      where up.user_id = app.current_user_id()
        and up.permission = p),
    /* ไม่มี override ก็ตกมาที่ preset ของบทบาท */
    exists (
      select 1
        from public.users u
        join public.role_permissions rp on rp.role = u.role
       where u.id = app.current_user_id()
         and rp.permission = p
    )
  )
$$;

comment on function app.has_perm is
  'แทนที่ requirePerm() ของ Express — สูตรเดียวกับ effectivePermissions()';

revoke execute on function app.current_user_id, app.current_driver_id, app.has_perm from public;
grant execute on function app.current_user_id, app.current_driver_id, app.has_perm to authenticated;
