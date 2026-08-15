/* 0001 — schema หลัก แปลงจาก SQLite (server/src/db/schema.ts) มาเป็น Postgres
 *
 * สิ่งที่เปลี่ยนจากของเดิม และเหตุผล:
 *   INTEGER PRIMARY KEY AUTOINCREMENT  ->  bigint generated always as identity
 *   TEXT (วันเวลา)                      ->  timestamptz   ทุกที่เก็บเป็น UTC จริง ไม่ใช่สตริง
 *   INTEGER 0/1                        ->  boolean
 *   CHECK (x IN (...))                 ->  enum ของ Postgres  ผิดค่าแล้ว insert ไม่ผ่านตั้งแต่แรก
 *
 * users ได้คอลัมน์ใหม่ auth_id ผูกกับ auth.users ของ Supabase
 * เพราะตัวตนย้ายไปอยู่ที่ Supabase Auth แล้ว แต่ id เดิมแบบ bigint ยังต้องอยู่
 * เพราะทั้งระบบอ้างถึงมัน (drivers.user_id, pod.collected_by, quotes.created_by)
 * ถ้าเปลี่ยนเป็น uuid ทั้งหมดต้องรื้อ foreign key ทุกตาราง — ไม่คุ้ม
 */

create schema if not exists app;

create type user_role      as enum ('admin', 'dispatcher', 'viewer', 'driver');
create type vehicle_type   as enum ('pickup', 'truck6', 'truck10', 'reefer', 'van');
create type vehicle_status as enum ('available', 'on_trip', 'maintenance', 'inactive');
create type driver_status  as enum ('available', 'on_trip', 'off_duty');
create type trip_status    as enum ('planned', 'in_progress', 'completed', 'cancelled');
create type order_status   as enum ('pending', 'assigned', 'in_transit', 'delivered', 'cancelled');
create type order_priority as enum ('normal', 'urgent');
create type pod_status     as enum ('collected', 'verified');
create type quote_status   as enum ('draft', 'sent', 'accepted', 'rejected', 'expired');
create type interaction_type as enum ('call', 'email', 'meeting', 'line', 'other');
create type task_status    as enum ('pending', 'done');

create table public.users (
  id         bigint generated always as identity primary key,
  /* ผูกกับบัญชี Supabase Auth — null ได้ชั่วคราวตอน migrate ข้อมูลเก่าเข้ามา
     แต่ผู้ใช้ที่ auth_id เป็น null จะล็อกอินไม่ได้เลย เพราะ RLS หาตัวตนไม่เจอ */
  auth_id    uuid unique references auth.users (id) on delete set null,
  username   text        not null unique,
  name       text        not null,
  role       user_role   not null default 'viewer',
  is_active  boolean     not null default true,
  created_at timestamptz not null default now()
);

/* password_hash หายไปจากตารางนี้โดยตั้งใจ — รหัสผ่านอยู่ใน auth.users ของ Supabase
   ซึ่งไม่มี client ตัวไหนอ่านได้ ดีกว่าเก็บ bcrypt hash ไว้ในตารางที่เราต้องกันเอง */

create table public.user_permissions (
  user_id    bigint  not null references public.users (id) on delete cascade,
  permission text    not null,
  allowed    boolean not null,
  primary key (user_id, permission)
);

create table public.settings (
  key   text primary key,
  value text not null
);

create table public.customers (
  id             bigint generated always as identity primary key,
  name           text not null,
  contact_person text,
  phone          text,
  email          text,
  address        text,
  segment        text not null default 'B',
  tax_id         text,
  credit_terms   integer,
  tags           text,
  price_note     text,
  created_at     timestamptz not null default now()
);

create table public.vehicles (
  id           bigint generated always as identity primary key,
  plate_no     text not null unique,
  brand        text,
  model        text,
  vehicle_type vehicle_type   not null default 'pickup',
  capacity_kg  integer        not null default 1000,
  status       vehicle_status not null default 'available',
  created_at   timestamptz    not null default now()
);

create table public.drivers (
  id           bigint generated always as identity primary key,
  name         text not null,
  phone        text,
  license_no   text,
  license_type text,
  status       driver_status not null default 'available',
  joined_at    timestamptz,
  /* บัญชีผู้ใช้ของคนขับคนนี้ — เส้นเดียวที่ตอบได้ว่า "เที่ยวไหนเป็นของฉัน"
     RLS ทั้งฝั่งคนขับแขวนอยู่กับคอลัมน์นี้ ถ้าเป็น null คนขับคนนั้นเข้าแอปไม่ได้ */
  user_id      bigint references public.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create unique index drivers_user_id_key on public.drivers (user_id) where user_id is not null;

create table public.trips (
  id          bigint generated always as identity primary key,
  trip_no     text        not null unique,
  vehicle_id  bigint      not null references public.vehicles (id),
  driver_id   bigint      not null references public.drivers (id),
  status      trip_status not null default 'planned',
  departed_at timestamptz,
  arrived_at  timestamptz,
  fuel_cost   integer     not null default 0,
  toll_cost   integer     not null default 0,
  other_cost  integer     not null default 0,
  notes       text,
  created_at  timestamptz not null default now()
);

create table public.orders (
  id           bigint generated always as identity primary key,
  order_no     text   not null unique,
  customer_id  bigint references public.customers (id),
  origin       text   not null,
  destination  text   not null,
  distance_km  integer        not null default 0,
  goods_desc   text           not null,
  weight_kg    integer        not null default 0,
  fee          integer        not null default 0,
  status       order_status   not null default 'pending',
  priority     order_priority not null default 'normal',
  scheduled_at timestamptz    not null,
  delivered_at timestamptz,
  trip_id      bigint references public.trips (id),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index orders_status_idx    on public.orders (status);
create index orders_trip_idx      on public.orders (trip_id);
create index orders_customer_idx  on public.orders (customer_id);
create index orders_scheduled_idx on public.orders (scheduled_at);
create index trips_status_idx     on public.trips (status);
create index trips_driver_idx     on public.trips (driver_id);

create table public.pod (
  id             bigint generated always as identity primary key,
  order_id       bigint not null unique references public.orders (id),
  recipient_name text   not null,
  /* ลายเซ็นยังเป็น data URL เหมือนเดิม แต่รูปหน้างานย้ายไป Supabase Storage
     photo_path จึงเก็บแค่ path ใน bucket ไม่ใช่ path บนดิสก์ของเครื่อง server */
  signature_data text   not null,
  photo_path     text,
  notes          text,
  status         pod_status not null default 'collected',
  lat            double precision,
  lng            double precision,
  collected_by   bigint      not null references public.users (id),
  collected_at   timestamptz not null,
  updated_at     timestamptz not null default now()
);

create index pod_order_idx  on public.pod (order_id);
create index pod_status_idx on public.pod (status);

create table public.quotes (
  id                 bigint generated always as identity primary key,
  quote_no           text not null unique,
  customer_id        bigint references public.customers (id),
  origin             text not null,
  destination        text not null,
  distance_km        integer not null default 0,
  goods_desc         text    not null,
  weight_kg          integer not null default 0,
  fee                integer not null default 0,
  status             quote_status not null default 'sent',
  valid_until        timestamptz,
  notes              text,
  created_by         bigint references public.users (id),
  converted_order_id bigint references public.orders (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index quotes_customer_idx on public.quotes (customer_id);
create index quotes_status_idx   on public.quotes (status);

create table public.customer_interactions (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id),
  type        interaction_type not null default 'call',
  subject     text not null,
  note        text,
  happened_at timestamptz not null,
  created_by  bigint references public.users (id),
  created_at  timestamptz not null default now()
);

create index interactions_customer_idx on public.customer_interactions (customer_id);

create table public.customer_tasks (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id),
  title       text not null,
  due_at      timestamptz,
  status      task_status not null default 'pending',
  note        text,
  created_by  bigint references public.users (id),
  created_at  timestamptz not null default now()
);

create index tasks_customer_idx on public.customer_tasks (customer_id);
create index tasks_status_idx   on public.customer_tasks (status);

/* ===== ข้อมูลที่ sync มาจาก TMS บริษัท =====
   ตารางนี้ไม่มีในระบบเดิม — เป็นที่พักของ actual shipment ที่ดึงมาตอนตี 1
   แยกจาก orders เพราะยังไม่ได้แปลงเป็นงาน ต้องมีคนตรวจก่อนว่า dealer ตรงกับลูกค้าคนไหน */
create table public.tms_shipments (
  id                bigint generated always as identity primary key,
  picking_list_no   text not null,
  trip_no_tms       text,
  plan_delivery_date date,
  dealer_name       text,
  branch            text,
  unit              integer,
  item_no           text,
  item_name         text,
  item_qty          integer,
  raw               jsonb not null,
  /* ดึงซ้ำวันเดิมต้องไม่เกิดแถวซ้ำ — คู่นี้คือ natural key ที่ upsert ใช้ */
  synced_at         timestamptz not null default now(),
  order_id          bigint references public.orders (id),
  unique (picking_list_no, item_no)
);

create index tms_shipments_date_idx  on public.tms_shipments (plan_delivery_date);
create index tms_shipments_order_idx on public.tms_shipments (order_id);
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
/* 0003 — RLS: ย้ายด่านตรวจสิทธิ์จาก Express มาไว้ในฐานข้อมูล
 *
 * ของเดิม Express เป็นกำแพง client ยิง DB ตรงไม่ได้อยู่แล้ว
 * ของใหม่ SPA ถือ anon key ที่เปิดเผย ใครก็ยิง PostgREST ตรงได้
 * ไฟล์นี้จึงเป็นด่านเดียวที่เหลือ — ตารางไหนลืม enable RLS คือเปิดสาธารณะทันที
 *
 * กติกาที่ยึดทั้งไฟล์:
 *   1. ทุก policy ระบุ `to authenticated` — anon ไม่มีสิทธิ์แตะอะไรเลยแม้แต่ตารางเดียว
 *   2. ไม่มี policy = ปฏิเสธ ไม่ใช่ปล่อยผ่าน  คนขับจึงถูกกันออกจาก orders/trips เอง
 *      โดยไม่ต้องเขียนกฎห้าม เพราะเขาไม่มีสิทธิ์ orders.view ตั้งแต่ต้น
 *   3. delete แทบทุกตารางไม่มี policy โดยตั้งใจ — ของเดิมยกเลิกงานด้วยการเปลี่ยน status
 *      ไม่ใช่ลบแถว การลบจริงให้ทำผ่าน service_role เท่านั้น
 */

/* Supabase เปิด grant ให้ anon/authenticated ไว้ล่วงหน้าทุกตารางใหม่
   ตัด anon ทิ้งให้หมดก่อน แล้วค่อยเปิดทีละอย่างให้ authenticated */
revoke all on all tables in schema public from anon;

alter table public.users                 enable row level security;
alter table public.user_permissions      enable row level security;
alter table public.settings              enable row level security;
alter table public.permissions           enable row level security;
alter table public.role_permissions      enable row level security;
alter table public.customers             enable row level security;
alter table public.vehicles              enable row level security;
alter table public.drivers               enable row level security;
alter table public.trips                 enable row level security;
alter table public.orders                enable row level security;
alter table public.pod                   enable row level security;
alter table public.quotes                enable row level security;
alter table public.customer_interactions enable row level security;
alter table public.customer_tasks        enable row level security;
alter table public.tms_shipments         enable row level security;

/* ===== users ===== */

/* ทุกคนต้องอ่านแถวของตัวเองได้ ไม่งั้นแอปไม่รู้ว่าตัวเองชื่ออะไร บทบาทอะไร
   คนขับจะเห็นเฉพาะแถวตัวเอง ไม่เห็นรายชื่อพนักงานออฟฟิศ */
create policy users_self_select on public.users
  for select to authenticated
  using (id = app.current_user_id());

create policy users_manage_select on public.users
  for select to authenticated
  using (app.has_perm('users.manage'));

create policy users_manage_insert on public.users
  for insert to authenticated
  with check (app.has_perm('users.manage'));

create policy users_manage_update on public.users
  for update to authenticated
  using (app.has_perm('users.manage'))
  with check (app.has_perm('users.manage'));

/* ===== user_permissions / permissions / role_permissions ===== */

/* อ่านสิทธิ์ของตัวเองได้ เพราะหน้าจอใช้ซ่อน/แสดงปุ่ม
   แต่แก้ไม่ได้ — ไม่มี policy insert/update สำหรับตัวเอง มีแต่ของ users.manage */
create policy user_perms_self_select on public.user_permissions
  for select to authenticated
  using (user_id = app.current_user_id());

create policy user_perms_manage_all on public.user_permissions
  for all to authenticated
  using (app.has_perm('users.manage'))
  with check (app.has_perm('users.manage'));

/* รายการสิทธิ์กับ preset เป็นข้อมูลอ้างอิง ใครล็อกอินแล้วอ่านได้หมด
   ไม่ใช่ความลับ — รู้ว่ามีสิทธิ์ชื่ออะไรบ้างไม่ได้ทำให้ได้สิทธิ์นั้น
   แต่เขียนไม่ได้เลยจาก client เปลี่ยน preset ต้องผ่าน migration */
create policy permissions_read on public.permissions
  for select to authenticated using (true);

create policy role_permissions_read on public.role_permissions
  for select to authenticated using (true);

/* ===== settings ===== */

create policy settings_read on public.settings
  for select to authenticated
  using (app.has_perm('dashboard.view') or app.has_perm('settings.manage'));

create policy settings_write on public.settings
  for all to authenticated
  using (app.has_perm('settings.manage'))
  with check (app.has_perm('settings.manage'));

/* ===== customers ===== */

create policy customers_select on public.customers
  for select to authenticated using (app.has_perm('customers.view'));

create policy customers_insert on public.customers
  for insert to authenticated with check (app.has_perm('customers.write'));

create policy customers_update on public.customers
  for update to authenticated
  using (app.has_perm('customers.write')) with check (app.has_perm('customers.write'));

create policy customers_delete on public.customers
  for delete to authenticated using (app.has_perm('customers.delete'));

/* ===== vehicles ===== */

create policy vehicles_select on public.vehicles
  for select to authenticated using (app.has_perm('vehicles.view'));

create policy vehicles_insert on public.vehicles
  for insert to authenticated with check (app.has_perm('vehicles.write'));

create policy vehicles_update on public.vehicles
  for update to authenticated
  using (app.has_perm('vehicles.write')) with check (app.has_perm('vehicles.write'));

create policy vehicles_delete on public.vehicles
  for delete to authenticated using (app.has_perm('vehicles.delete'));

/* ===== drivers ===== */

create policy drivers_select on public.drivers
  for select to authenticated using (app.has_perm('drivers.view'));

/* คนขับอ่านแถวของตัวเองได้ เพื่อให้แอปรู้ว่าตัวเองคือ driver id ไหน
   ไม่เห็นคนขับคนอื่น และไม่เห็นเบอร์โทรกับเลขใบขับขี่ของใคร */
create policy drivers_self_select on public.drivers
  for select to authenticated using (user_id = app.current_user_id());

create policy drivers_insert on public.drivers
  for insert to authenticated with check (app.has_perm('drivers.write'));

create policy drivers_update on public.drivers
  for update to authenticated
  using (app.has_perm('drivers.write')) with check (app.has_perm('drivers.write'));

create policy drivers_delete on public.drivers
  for delete to authenticated using (app.has_perm('drivers.delete'));

/* ===== trips =====
   ไม่มี policy สำหรับคนขับตรงนี้โดยตั้งใจ — ตาราง trips มี fuel_cost / toll_cost / other_cost
   RLS กันได้แค่ระดับแถว กันคอลัมน์ไม่ได้ ปล่อยให้คนขับ select ตารางนี้เมื่อไหร่
   เขาเห็นต้นทุนทุกเที่ยวทันที ฝั่งคนขับจึงอ่านผ่าน view ใน 0004 แทน */

create policy trips_select on public.trips
  for select to authenticated using (app.has_perm('dispatch.view'));

create policy trips_insert on public.trips
  for insert to authenticated with check (app.has_perm('dispatch.write'));

create policy trips_update on public.trips
  for update to authenticated
  using (app.has_perm('dispatch.write')) with check (app.has_perm('dispatch.write'));

/* ===== orders =====
   เหตุผลเดียวกับ trips — คอลัมน์ fee อยู่ในตารางนี้ คนขับห้ามแตะตรง ๆ */

create policy orders_select on public.orders
  for select to authenticated using (app.has_perm('orders.view'));

create policy orders_insert on public.orders
  for insert to authenticated with check (app.has_perm('orders.write'));

create policy orders_update on public.orders
  for update to authenticated
  using (app.has_perm('orders.write')) with check (app.has_perm('orders.write'));

/* ===== pod =====
   ออฟฟิศดูได้ตามสิทธิ์ ส่วนคนขับเห็นเฉพาะใบที่ตัวเองเป็นคนเก็บ */

create policy pod_select on public.pod
  for select to authenticated using (app.has_perm('pod.view'));

create policy pod_self_select on public.pod
  for select to authenticated using (collected_by = app.current_user_id());

create policy pod_insert on public.pod
  for insert to authenticated with check (app.has_perm('pod.write'));

/* ใบที่ verified แล้วล็อกถาวร แก้ได้เฉพาะคนที่มีสิทธิ์ pod.verify
   เงื่อนไขนี้เคยอยู่ใน pod.service.ts — ย้ายมาอยู่ในกฎ ไม่ใช่ในโค้ดที่ลืมเรียกได้ */
create policy pod_update on public.pod
  for update to authenticated
  using (
    app.has_perm('pod.verify')
    or (app.has_perm('pod.write') and status = 'collected')
  )
  with check (app.has_perm('pod.write') or app.has_perm('pod.verify'));

/* ===== quotes / CRM ===== */

create policy quotes_select on public.quotes
  for select to authenticated using (app.has_perm('quotes.view'));

create policy quotes_insert on public.quotes
  for insert to authenticated with check (app.has_perm('quotes.write'));

create policy quotes_update on public.quotes
  for update to authenticated
  using (app.has_perm('quotes.write')) with check (app.has_perm('quotes.write'));

create policy interactions_select on public.customer_interactions
  for select to authenticated using (app.has_perm('customers.view'));

create policy interactions_write on public.customer_interactions
  for insert to authenticated with check (app.has_perm('customers.write'));

create policy tasks_select on public.customer_tasks
  for select to authenticated using (app.has_perm('customers.view'));

create policy tasks_write on public.customer_tasks
  for all to authenticated
  using (app.has_perm('customers.write')) with check (app.has_perm('customers.write'));

/* ===== tms_shipments =====
   ข้อมูลดิบจาก TMS บริษัท — อ่านได้เฉพาะคนที่ดูออเดอร์ได้อยู่แล้ว
   ไม่มี policy insert/update เลยแม้แต่ตัวเดียว เพราะคนเขียนคือ service_role
   ซึ่งข้าม RLS อยู่แล้ว ไม่มี client ตัวไหนยัดข้อมูลปลอมเข้ามาได้ */

create policy tms_shipments_select on public.tms_shipments
  for select to authenticated using (app.has_perm('orders.view'));
/* 0004 — ทางเข้าฝั่งคนขับ
 *
 * ทำไมคนขับไม่ได้ policy บน trips/orders ตรง ๆ:
 * RLS กันได้แค่ "แถวไหน" กัน "คอลัมน์ไหน" ไม่ได้  แต่ trips มี fuel_cost/toll_cost/other_cost
 * และ orders มี fee  ให้ policy select ไปเมื่อไหร่ คนขับยิง PostgREST เลือกคอลัมน์เองได้ทันที
 * — กฎเดิมของโปรเจ็คคือ "ห้ามให้ตัวเลขเงินโผล่ในหน้าคนขับ" ซึ่งของเดิมทำโดยไม่ SELECT มาให้
 * ตั้งแต่ repository  ที่นี่ใช้วิธีเดียวกัน: view ที่ไม่มีคอลัมน์เงินอยู่ในนั้นเลย
 *
 * view พวกนี้ตั้ง security_invoker = off โดยตั้งใจ (ค่า default ของ Postgres อยู่แล้ว
 * แต่เขียนไว้ให้ชัดเพราะมันคือหัวใจ) — view ทำงานด้วยสิทธิ์ของเจ้าของ จึงข้าม RLS
 * ของ trips/orders ได้  ตัวกรองความปลอดภัยคือ where ในตัว view เอง ห้ามลบเด็ดขาด
 */

create view public.my_trips with (security_invoker = off) as
  select t.id,
         t.trip_no,
         t.status,
         t.departed_at,
         t.arrived_at,
         t.notes,
         v.plate_no,
         v.vehicle_type
    from public.trips t
    join public.vehicles v on v.id = t.vehicle_id
   where t.driver_id = app.current_driver_id()
     and app.has_perm('myjobs.view');

comment on view public.my_trips is
  'เที่ยวของคนขับที่ล็อกอินอยู่ — ไม่มีคอลัมน์ต้นทุนใด ๆ โดยตั้งใจ';

create view public.my_orders with (security_invoker = off) as
  select o.id,
         o.order_no,
         o.trip_id,
         o.status,
         o.priority,
         o.origin,
         o.destination,
         o.goods_desc,
         o.weight_kg,
         o.scheduled_at,
         o.delivered_at,
         o.notes,
         c.name  as customer_name,
         c.phone as customer_phone,
         exists (select 1 from public.pod p where p.order_id = o.id) as has_pod
    from public.orders o
    join public.trips t     on t.id = o.trip_id
    left join public.customers c on c.id = o.customer_id
   where t.driver_id = app.current_driver_id()
     and app.has_perm('myjobs.view');

comment on view public.my_orders is
  'จุดส่งของในเที่ยวตัวเอง — ไม่มีคอลัมน์ fee';

/* revoke ใน 0003 รันไปก่อนที่ view สองตัวนี้จะเกิด และ Supabase แจก grant ให้ anon
   กับทุก object ใหม่ใน public อัตโนมัติ — ต้องตัดซ้ำตรงนี้ ไม่งั้น anon ถือสิทธิ์เต็มบน view
   ที่ security_invoker = off ซึ่งเป็น view ที่ข้าม RLS ได้ตามออกแบบ */
revoke all on public.my_trips, public.my_orders from anon;
grant select on public.my_trips, public.my_orders to authenticated;

/* ===== การกระทำของคนขับ =====
 * ทั้งหมดเป็นฟังก์ชัน ไม่ใช่ update ตรง เพราะคนขับไม่มีสิทธิ์เขียน orders/trips
 * และเพราะ logic พวกนี้ต้องอยู่ที่เดียว ไม่ใช่กระจายอยู่ในหน้าจอ
 */

create or replace function public.start_trip(p_trip_id bigint)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  update public.trips
     set status = 'in_progress',
         departed_at = coalesce(departed_at, now())
   where id = p_trip_id
     and driver_id = app.current_driver_id()
     and status = 'planned';

  if not found then
    raise exception 'ไม่พบเที่ยวนี้ หรือไม่ใช่เที่ยวของคุณ' using errcode = 'P0002';
  end if;

  update public.orders set status = 'in_transit', updated_at = now()
   where trip_id = p_trip_id and status = 'assigned';
end;
$$;

/* ปิดการส่งทีละจุด — ตรงกับ POST /api/my-jobs/orders/:id/deliver ของเดิม
   ต้องมีเพราะเที่ยวหนึ่งมีหลายร้าน และ POD รับเฉพาะออเดอร์ที่ delivered แล้ว
   ถ้าไม่มีทางปิดทีละจุด คนขับจะเก็บลายเซ็นร้านแรกไม่ได้จนกว่าจะวิ่งครบทุกร้าน */
create or replace function public.deliver_order(p_order_id bigint)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  update public.orders o
     set status = 'delivered',
         delivered_at = coalesce(o.delivered_at, now()),
         updated_at = now()
    from public.trips t
   where o.id = p_order_id
     and t.id = o.trip_id
     and t.driver_id = app.current_driver_id()
     and o.status not in ('delivered', 'cancelled');

  if not found then
    raise exception 'ไม่พบออเดอร์นี้ในเที่ยวของคุณ หรือปิดไปแล้ว' using errcode = 'P0002';
  end if;
end;
$$;

/* ปิดเที่ยว — เหมาออเดอร์ที่เหลือเป็น delivered ให้หมด เหมือน trips.complete() เดิม
   นี่คือเหตุผลที่มันต้องอยู่ในฟังก์ชัน ไม่ใช่ปล่อยให้หน้าจอยิง update เอง:
   ถ้าคนขับสั่งได้เอง เขาปิดงานที่ยังไม่ได้ส่งได้ทั้งเที่ยว */
create or replace function public.complete_trip(p_trip_id bigint)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_pending integer;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  /* หน้าจอ disable ปุ่มไว้อยู่แล้วจนกว่าจะส่งครบ แต่ปุ่มที่ disable กันคนที่ยิง API ตรงไม่ได้
     กฎจริงต้องอยู่ตรงนี้ */
  select count(*) into v_pending
    from public.orders o
    join public.trips t on t.id = o.trip_id
   where o.trip_id = p_trip_id
     and t.driver_id = app.current_driver_id()
     and o.status not in ('delivered', 'cancelled');

  if v_pending > 0 then
    raise exception 'ยังส่งไม่ครบ เหลืออีก % จุด', v_pending using errcode = 'P0001';
  end if;

  update public.trips
     set status = 'completed',
         arrived_at = coalesce(arrived_at, now())
   where id = p_trip_id
     and driver_id = app.current_driver_id()
     and status = 'in_progress';

  if not found then
    raise exception 'ไม่พบเที่ยวนี้ หรือไม่ใช่เที่ยวของคุณ' using errcode = 'P0002';
  end if;

  update public.drivers set status = 'available' where id = app.current_driver_id();
end;
$$;

create or replace function public.save_pod(
  p_order_id       bigint,
  p_recipient_name text,
  p_signature_data text,
  p_photo_path     text default null,
  p_notes          text default null,
  p_lat            double precision default null,
  p_lng            double precision default null
)
returns bigint
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_id bigint;
begin
  if not app.has_perm('myjobs.pod') and not app.has_perm('pod.write') then
    raise exception 'ไม่มีสิทธิ์เก็บหลักฐานการส่งมอบ' using errcode = '42501';
  end if;

  /* รับเฉพาะออเดอร์ที่ปิดแล้วและเป็นของคนขับคนนี้ — เงื่อนไขเดิมของ pod.create() */
  if not exists (
    select 1 from public.orders o
      join public.trips t on t.id = o.trip_id
     where o.id = p_order_id
       and o.status = 'delivered'
       and (t.driver_id = app.current_driver_id() or app.has_perm('pod.write'))
  ) then
    raise exception 'ออเดอร์นี้ยังไม่ได้ปิด หรือไม่ใช่งานของคุณ' using errcode = 'P0002';
  end if;

  insert into public.pod (order_id, recipient_name, signature_data, photo_path,
                          notes, lat, lng, collected_by, collected_at)
  values (p_order_id, p_recipient_name, p_signature_data, p_photo_path,
          p_notes, p_lat, p_lng, app.current_user_id(), now())
  on conflict (order_id) do update
     set recipient_name = excluded.recipient_name,
         signature_data = excluded.signature_data,
         photo_path     = excluded.photo_path,
         notes          = excluded.notes,
         updated_at     = now()
   /* ใบที่ยืนยันแล้วล็อกถาวร เขียนทับไม่ได้แม้แต่คนที่เก็บเอง */
   where public.pod.status = 'collected'
  returning id into v_id;

  if v_id is null then
    raise exception 'หลักฐานใบนี้ถูกยืนยันแล้ว แก้ไขไม่ได้' using errcode = 'P0001';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.start_trip, public.deliver_order,
                          public.complete_trip, public.save_pod from public;
grant execute on function public.start_trip, public.deliver_order,
                         public.complete_trip, public.save_pod to authenticated;
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
/* 0006 — แก้ tms_shipments ให้ตรงกับข้อมูลที่ TMS ส่งมาจริง
 *
 * 0001 ตั้งคอลัมน์ไว้ตามที่ "คิดว่า" API ส่งมา แต่ไปเทียบกับ extractor แล้วไม่ตรงสามเรื่อง
 * (extractor เจอของจริงมาก่อน — ดู extractor/tms-extractor/public/app.js)
 *
 * 1. รายงาน actualshipment ไม่มีฟิลด์ planDeliveryDate
 *    planDeliveryDate เป็นชื่อ "พารามิเตอร์ตอนค้นหา" เท่านั้น ฟิลด์วันที่ที่ส่งกลับมาคือ
 *    orderDate / planPickupDate / pickupDate / onDeliveryDate / deliveryDate
 *    คอลัมน์เดิมจึงเป็น null ทุกแถวตลอดกาล และ index บนมันก็ไร้ประโยชน์
 *    เปลี่ยนเป็น trip_date รับค่า orderDate ตรงกับที่รายงานเรียกว่า "Trip Date"
 *
 * 2. PL ที่ถูกแบ่งส่งหลายเที่ยว (เลขลงท้าย -C-04) ยอด qty ของทั้งใบไม่เท่ากับ unit ของเที่ยวนี้
 *    splitQty น่าจะเป็นจำนวนที่ยกไปจริง — ต้องเก็บทั้งคู่ถึงจะตอบได้ว่าอันไหนคือตัวจริง
 *    ถ้าไม่เก็บตั้งแต่ตอน sync คำถามนี้ตอบไม่ได้ตลอดไป เพราะข้อมูลไม่เคยลงฐาน
 *
 * 3. qty_source บันทึกผลเทียบตอน sync ว่ายอดไหนตรงกับ unit — 'qty' / 'split' / null (ไม่ตรงทั้งคู่)
 *    สะสมไว้พอครบสักเดือนก็ query ตอบได้เลยว่าส่วนใหญ่ตรงกับตัวไหน แล้วค่อยยุบเหลือคอลัมน์เดียว
 */

alter table public.tms_shipments rename column plan_delivery_date to trip_date;
alter index tms_shipments_date_idx rename to tms_shipments_trip_date_idx;

alter table public.tms_shipments
  add column item_split_qty integer,
  add column qty_source     text,
  add constraint tms_shipments_qty_source_check
    check (qty_source is null or qty_source in ('qty', 'split'));

comment on column public.tms_shipments.trip_date is
  'orderDate จากรายงาน = "Trip Date" — ไม่ใช่วันที่วางแผนส่ง';
comment on column public.tms_shipments.item_split_qty is
  'splitQty ของ PL ที่ถูกแบ่งส่งหลายเที่ยว — null ถ้า TMS ไม่ส่งมา';
comment on column public.tms_shipments.qty_source is
  'ยอดไหนตรงกับ unit ตอน sync: qty / split / null = ไม่ตรงทั้งคู่ ต้องมีคนดู';
/* 0007 — ทางเข้าฝั่งออฟฟิศ
 *
 * เหตุผลเดียวกับ 0004 แต่คนละเหตุผลกับที่คนคิด:
 * ฝั่งคนขับต้องเป็นฟังก์ชันเพราะ "กันไม่ให้ทำเกินสิทธิ์"
 * ฝั่งออฟฟิศต้องเป็นฟังก์ชันเพราะ "หลายแถวต้องเปลี่ยนพร้อมกันหรือไม่เปลี่ยนเลย"
 *
 * ตอนอยู่บน Express ตัว service ห่อด้วย db.transaction() ให้ทั้งก้อน
 * พอย้ายมา PostgREST หน้าจอยิงทีละ request — ยิงสร้างเที่ยวผ่าน แล้ว browser ปิดกลางคัน
 * ออเดอร์ก็ค้างเป็น assigned โดยไม่มีเที่ยว รถค้างเป็น on_trip ตลอดกาล
 * งานที่แตะเกินหนึ่งตารางจึงต้องอยู่ในฟังก์ชันเดียว ไม่ใช่ห้าม request ที่หน้าจอยิงเรียงกัน
 *
 * ส่วน CRUD ธรรมดา (ลูกค้า รถ ใบเสนอราคา) ยังยิงตารางตรงผ่าน PostgREST ได้ตามปกติ
 * RLS ใน 0003 คุมสิทธิ์อยู่แล้ว ไม่ต้องมีฟังก์ชันมาห่อให้เปลือง
 */

/* ===== เลขที่เอกสาร =====
   ของเดิมนับด้วย countByYear() ใน repository แล้ว +1 ต่อท้าย — ย้ายมาไว้ที่เดียวกับข้อมูล
   นับจากของจริงในตาราง ไม่ใช่ sequence เพราะรูปแบบเดิมคือ "ลำดับที่เท่าไหร่ของปีนี้"
   ซึ่ง sequence ตอบไม่ได้เมื่อข้ามปี */
create or replace function app.next_doc_no(p_prefix text, p_table text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_col  text := case p_table
                   when 'orders' then 'order_no'
                   when 'quotes' then 'quote_no'
                   when 'trips'  then 'trip_no'
                 end;
  v_seq  int;
begin
  if v_col is null then
    raise exception 'ไม่รู้จักตาราง %', p_table using errcode = 'P0001';
  end if;

  execute format('select count(*) from public.%I where %I like $1', p_table, v_col)
     into v_seq
    using p_prefix || '-' || v_year || '-%';

  return p_prefix || '-' || v_year || '-' || lpad((v_seq + 1)::text, 4, '0');
end;
$$;

/* เติมเลขเอกสารให้ตอน insert ถ้าไม่ได้ส่งมา — หน้าจอจึง insert ตรงผ่าน PostgREST ได้
   โดยไม่ต้องมีฟังก์ชันแยกแค่เพื่อสร้างเลข
 *
 * IF ต้องซ้อน ห้ามเขียนเป็น `tg_table_name = 'orders' and new.order_no ...` ในบรรทัดเดียว
 * plpgsql ส่งทั้งเงื่อนไขไปให้ SQL ประเมินเป็นนิพจน์เดียว มันจึงต้อง resolve `new.order_no`
 * แม้ตอนที่ trigger ยิงมาจากตาราง quotes ซึ่งไม่มีคอลัมน์นั้น -> 42703 ทันที
 * การลัดวงจรแบบภาษาโปรแกรมทั่วไปไม่มีผลตรงนี้ ส่วน IF ซ้อนคนละ statement จึงคอมไพล์แยกกัน */
create or replace function app.fill_doc_no()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'orders' then
    if coalesce(new.order_no, '') = '' then
      new.order_no := app.next_doc_no('ORD', 'orders');
    end if;
  elsif tg_table_name = 'quotes' then
    if coalesce(new.quote_no, '') = '' then
      new.quote_no := app.next_doc_no('QOT', 'quotes');
    end if;
  elsif tg_table_name = 'trips' then
    if coalesce(new.trip_no, '') = '' then
      new.trip_no := app.next_doc_no('TRP', 'trips');
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_fill_doc_no before insert on public.orders
  for each row execute function app.fill_doc_no();
create trigger quotes_fill_doc_no before insert on public.quotes
  for each row execute function app.fill_doc_no();
create trigger trips_fill_doc_no before insert on public.trips
  for each row execute function app.fill_doc_no();

/* ===== จัดเที่ยว ===== */

/* สร้างเที่ยว + ผูกออเดอร์ + จองรถและคนขับ ในก้อนเดียว
   คืน warning แทนการ raise เมื่อน้ำหนักเกิน — ของเดิมก็เตือนแต่ไม่ห้าม
   เพราะคนจัดรถรู้หน้างานดีกว่าตัวเลขในระบบ (ของบางอย่างเบากว่าที่กรอก) */
create or replace function public.create_trip(
  p_vehicle_id bigint,
  p_driver_id  bigint,
  p_order_ids  bigint[],
  p_notes      text default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_trip     public.trips;
  v_capacity int;
  v_plate    text;
  v_weight   int;
  v_count    int;
  v_warning  text;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then
    raise exception 'เลือกอย่างน้อย 1 ออเดอร์สำหรับเที่ยวนี้' using errcode = 'P0001';
  end if;

  select capacity_kg, plate_no into v_capacity, v_plate
    from public.vehicles where id = p_vehicle_id and status = 'available'
     for update;
  if not found then
    raise exception 'รถคันนี้ไม่ว่าง หรือไม่มีอยู่จริง' using errcode = 'P0001';
  end if;

  perform 1 from public.drivers
   where id = p_driver_id and status = 'available' for update;
  if not found then
    raise exception 'พนักงานขับคนนี้ไม่ว่าง หรือไม่มีอยู่จริง' using errcode = 'P0001';
  end if;

  insert into public.trips (vehicle_id, driver_id, notes)
  values (p_vehicle_id, p_driver_id, p_notes)
  returning * into v_trip;

  /* รับเฉพาะออเดอร์ที่ยัง pending และยังไม่มีเที่ยว — เงื่อนไขเดียวกับ assertOrderAssignable() เดิม
     ถ้าอัปเดตได้ไม่ครบจำนวนที่ส่งมา แปลว่ามีใบที่คนอื่นคว้าไปแล้ว ต้องล้มทั้งก้อน
     ไม่ใช่ผูกเท่าที่ได้แล้วเงียบ — คนจัดรถจะไม่รู้เลยว่าใบไหนหาย */
  with upd as (
    update public.orders
       set status = 'assigned', trip_id = v_trip.id, updated_at = now()
     where id = any(p_order_ids) and status = 'pending' and trip_id is null
    returning weight_kg
  )
  select count(*), coalesce(sum(weight_kg), 0) into v_count, v_weight from upd;

  if v_count <> array_length(p_order_ids, 1) then
    raise exception 'มีออเดอร์บางใบถูกจัดเข้าเที่ยวอื่นไปแล้ว' using errcode = 'P0001';
  end if;

  update public.vehicles set status = 'on_trip' where id = p_vehicle_id;
  update public.drivers  set status = 'on_trip' where id = p_driver_id;

  if v_weight > v_capacity then
    v_warning := 'น้ำหนักรวม ' || v_weight || ' กก. เกินความจุรถ ' || v_plate
              || ' (' || v_capacity || ' กก.) — ยืนยันก่อนออกเดินทาง';
  end if;

  return json_build_object('trip_id', v_trip.id, 'trip_no', v_trip.trip_no, 'warning', v_warning);
end;
$$;

/* เพิ่มออเดอร์เข้าเที่ยวที่ยังไม่ออกวิ่ง */
create or replace function public.add_orders_to_trip(p_trip_id bigint, p_order_ids bigint[])
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_capacity int;
  v_plate    text;
  v_weight   int;
  v_count    int;
  v_warning  text;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  select v.capacity_kg, v.plate_no into v_capacity, v_plate
    from public.trips t join public.vehicles v on v.id = t.vehicle_id
   where t.id = p_trip_id and t.status = 'planned';
  if not found then
    raise exception 'เพิ่มออเดอร์ได้เฉพาะเที่ยวที่ยังไม่ออกวิ่ง' using errcode = 'P0001';
  end if;

  with upd as (
    update public.orders
       set status = 'assigned', trip_id = p_trip_id, updated_at = now()
     where id = any(p_order_ids) and status = 'pending' and trip_id is null
    returning 1
  )
  select count(*) into v_count from upd;

  if v_count <> coalesce(array_length(p_order_ids, 1), 0) then
    raise exception 'มีออเดอร์บางใบถูกจัดเข้าเที่ยวอื่นไปแล้ว' using errcode = 'P0001';
  end if;

  select coalesce(sum(weight_kg), 0) into v_weight
    from public.orders where trip_id = p_trip_id and status <> 'cancelled';

  if v_weight > v_capacity then
    v_warning := 'น้ำหนักรวม ' || v_weight || ' กก. เกินความจุรถ ' || v_plate
              || ' (' || v_capacity || ' กก.)';
  end if;

  return json_build_object('warning', v_warning);
end;
$$;

create or replace function public.remove_order_from_trip(p_trip_id bigint, p_order_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  update public.orders o
     set status = 'pending', trip_id = null, updated_at = now()
    from public.trips t
   where o.id = p_order_id and o.trip_id = p_trip_id
     and t.id = p_trip_id and t.status = 'planned';

  if not found then
    raise exception 'ไม่พบออเดอร์นี้ในเที่ยว หรือเที่ยวออกวิ่งไปแล้ว' using errcode = 'P0002';
  end if;
end;
$$;

/* ออฟฟิศสั่งออกเดินทางแทนคนขับได้ — คนละฟังก์ชันกับ start_trip() ของคนขับ
   เพราะตัวนั้นผูกกับ current_driver_id() ซึ่งพนักงานออฟฟิศไม่มี */
create or replace function public.dispatch_start_trip(p_trip_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  update public.trips set status = 'in_progress', departed_at = coalesce(departed_at, now())
   where id = p_trip_id and status = 'planned';
  if not found then
    raise exception 'เที่ยวนี้ไม่อยู่ในสถานะที่ออกเดินทางได้' using errcode = 'P0001';
  end if;

  update public.orders set status = 'in_transit', updated_at = now()
   where trip_id = p_trip_id and status = 'assigned';
end;
$$;

/* ปิดเที่ยว — เหมาออเดอร์ที่ยังวิ่งอยู่เป็น delivered แล้วปล่อยรถกับคนขับคืน
   ต่างจาก complete_trip() ของคนขับตรงที่ "ไม่บังคับว่าต้องส่งครบก่อน"
   เพราะออฟฟิศมีสิทธิ์ปิดงานที่หน้างานปิดไม่ได้ (คนขับเน็ตหลุด โทรศัพท์แบตหมด) */
create or replace function public.dispatch_complete_trip(p_trip_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_vehicle bigint;
  v_driver  bigint;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  update public.trips set status = 'completed', arrived_at = coalesce(arrived_at, now())
   where id = p_trip_id and status = 'in_progress'
  returning vehicle_id, driver_id into v_vehicle, v_driver;
  if not found then
    raise exception 'ปิดได้เฉพาะเที่ยวที่กำลังวิ่งอยู่' using errcode = 'P0001';
  end if;

  update public.orders set status = 'delivered', delivered_at = coalesce(delivered_at, now()), updated_at = now()
   where trip_id = p_trip_id and status = 'in_transit';

  update public.vehicles set status = 'available' where id = v_vehicle;
  update public.drivers  set status = 'available' where id = v_driver;
end;
$$;

/* ยกเลิกเที่ยว — ออเดอร์กลับไปรอจัดใหม่ ไม่ใช่ถูกยกเลิกตาม
   งานยังต้องส่งอยู่ แค่เที่ยวนี้ไม่ได้ไป */
create or replace function public.dispatch_cancel_trip(p_trip_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_vehicle bigint;
  v_driver  bigint;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  update public.trips set status = 'cancelled'
   where id = p_trip_id and status in ('planned', 'in_progress')
  returning vehicle_id, driver_id into v_vehicle, v_driver;
  if not found then
    raise exception 'ยกเลิกได้เฉพาะเที่ยวที่ยังไม่จบ' using errcode = 'P0001';
  end if;

  update public.orders set status = 'pending', trip_id = null, updated_at = now()
   where trip_id = p_trip_id and status in ('assigned', 'in_transit');

  update public.vehicles set status = 'available' where id = v_vehicle;
  update public.drivers  set status = 'available' where id = v_driver;
end;
$$;

/* ===== ใบเสนอราคา -> ออเดอร์ ===== */

create or replace function public.convert_quote(
  p_quote_id     bigint,
  p_scheduled_at timestamptz,
  p_notes        text default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_quote public.quotes;
  v_order public.orders;
begin
  if not app.has_perm('quotes.convert') then
    raise exception 'ไม่มีสิทธิ์แปลงใบเสนอราคา' using errcode = '42501';
  end if;
  if p_scheduled_at is null then
    raise exception 'ระบุกำหนดส่งก่อนแปลงเป็นออเดอร์' using errcode = 'P0001';
  end if;

  /* for update กันสองคนกดแปลงใบเดียวกันพร้อมกันแล้วได้ออเดอร์สองใบ */
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'ไม่พบใบเสนอราคานี้' using errcode = 'P0002';
  end if;
  if v_quote.converted_order_id is not null then
    raise exception 'ใบเสนอราคานี้แปลงเป็นออเดอร์ไปแล้ว' using errcode = 'P0001';
  end if;
  if v_quote.status not in ('sent', 'accepted') then
    raise exception 'แปลงได้เฉพาะใบที่ส่งแล้วหรือตกลงราคาแล้ว' using errcode = 'P0001';
  end if;

  insert into public.orders (customer_id, origin, destination, distance_km, goods_desc,
                             weight_kg, fee, priority, scheduled_at, notes)
  values (v_quote.customer_id, v_quote.origin, v_quote.destination, v_quote.distance_km,
          v_quote.goods_desc, v_quote.weight_kg, v_quote.fee, 'normal', p_scheduled_at,
          coalesce(nullif(p_notes, ''), 'จากใบเสนอราคา ' || v_quote.quote_no))
  returning * into v_order;

  update public.quotes
     set converted_order_id = v_order.id, status = 'accepted', updated_at = now()
   where id = p_quote_id;

  return json_build_object('order_id', v_order.id, 'order_no', v_order.order_no);
end;
$$;

revoke execute on function
  public.create_trip, public.add_orders_to_trip, public.remove_order_from_trip,
  public.dispatch_start_trip, public.dispatch_complete_trip, public.dispatch_cancel_trip,
  public.convert_quote
from public;

grant execute on function
  public.create_trip, public.add_orders_to_trip, public.remove_order_from_trip,
  public.dispatch_start_trip, public.dispatch_complete_trip, public.dispatch_cancel_trip,
  public.convert_quote
to authenticated;
/* 0008 — สะพานจาก tms_shipments เข้าสู่งานจริง (orders + trips)
 *
 * วัดจากข้อมูลจริงของคลัง KM23-CW-01 ช่วง 1–15 ส.ค. 2569 ก่อนออกแบบ:
 *   209 แถว = 209 PL ไม่ซ้ำ  ->  1 PL = 1 ออเดอร์ ตรงตัว ไม่ต้องรวมหรือแตก
 *   51 เที่ยว PL เฉลี่ย 4.1 ใบต่อเที่ยว สูงสุด 17  ->  tripNo ของ TMS = เที่ยวของเรา
 *   73 ร้านใน 9 วัน  ->  ตารางจับคู่ร้านมีขนาดหลักร้อย ไม่ใช่หลักหมื่น คนนั่งตรวจไหว
 *   มี licensePlate กับ driver มาให้  ->  จับคู่กับ vehicles/drivers ที่มีอยู่แล้วได้
 *
 * ทำไมต้องมีตารางจับคู่ ไม่ jsonb แล้ว match ชื่อเอาตอนแปลง:
 * ชื่อร้านใน TMS กับชื่อลูกค้าในระบบเราไม่เหมือนกันอยู่แล้ว (สาขา ตัวสะกด เว้นวรรค)
 * ถ้าเดาด้วยการ match ชื่อ วันไหนเดาผิดคือออเดอร์ไปโผล่ผิดลูกค้า แล้วไม่มีใครรู้
 * ให้คนยืนยันครั้งเดียวต่อร้าน แล้วจำไว้ ดีกว่าเดาใหม่ทุกคืน
 *
 * ของที่ยังไม่มีและตั้งใจไม่เดา:
 *   fee    — TMS มีแต่ actualCost ซึ่งเป็น "ต้นทุนที่เราจ่าย" ไม่ใช่ "ราคาที่เก็บลูกค้า" ตั้ง 0 ไว้
 *   weight_kg — unit คือจำนวนคัน ไม่ใช่กิโล ตั้ง 0 ไว้ ห้ามเอา unit มาใส่ช่องนี้
 */

/* เก็บฟิลด์ที่ต้องใช้จับคู่ให้เป็นคอลัมน์จริง — อ่านจาก raw ทุกครั้งก็ได้ แต่ index ไม่ลง */
alter table public.tms_shipments
  add column dealer_code     text,
  add column license_plate   text,
  add column driver_name     text,
  add column status_delivery text,
  add column actual_cost     numeric;

create index tms_shipments_dealer_idx on public.tms_shipments (dealer_code);
create index tms_shipments_trip_idx   on public.tms_shipments (trip_no_tms);

/* ===== ตารางจับคู่ร้าน ===== */

create table public.tms_dealer_map (
  dealer_code text primary key,
  dealer_name text not null,
  customer_id bigint references public.customers (id) on delete set null,
  /* null = ยังไม่มีใครตัดสินใจ  ต่างจาก ignored = ตัดสินใจแล้วว่าไม่เอาเข้าระบบ */
  ignored     boolean not null default false,
  mapped_by   bigint references public.users (id),
  mapped_at   timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.tms_dealer_map enable row level security;

create policy dealer_map_select on public.tms_dealer_map
  for select to authenticated using (app.has_perm('orders.view'));

create policy dealer_map_write on public.tms_dealer_map
  for all to authenticated
  using (app.has_perm('orders.write')) with check (app.has_perm('orders.write'));

/* ===== ดูก่อนนำเข้า =====
   คืนว่าวันนั้นมีอะไรพร้อม/ไม่พร้อม โดยไม่แตะข้อมูลจริงสักแถว
   หน้าจอควรเรียกตัวนี้ก่อนเสมอ แล้วโชว์ให้คนกดยืนยัน */
create or replace function public.preview_tms_import(p_date date)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_result json;
begin
  if not app.has_perm('orders.view') then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลนำเข้า' using errcode = '42501';
  end if;

  select json_build_object(
    'date', p_date,
    'picking_lists', count(distinct s.picking_list_no),
    'trips', count(distinct s.trip_no_tms),
    'already_imported', count(distinct s.picking_list_no) filter (where s.order_id is not null),
    'unmapped_dealers', coalesce((
      select json_agg(json_build_object('dealer_code', d.dealer_code, 'dealer_name', d.dealer_name, 'picking_lists', d.n))
        from (
          select s2.dealer_code, max(s2.dealer_name) as dealer_name, count(distinct s2.picking_list_no) as n
            from public.tms_shipments s2
            left join public.tms_dealer_map m on m.dealer_code = s2.dealer_code
           where s2.trip_date = p_date
             and (m.dealer_code is null or (m.customer_id is null and not m.ignored))
           group by s2.dealer_code
        ) d
    ), '[]'::json),
    'unknown_plates', coalesce((
      select json_agg(distinct s3.license_plate)
        from public.tms_shipments s3
        left join public.vehicles v on v.plate_no = s3.license_plate
       where s3.trip_date = p_date and s3.license_plate is not null and v.id is null
    ), '[]'::json)
  ) into v_result
  from public.tms_shipments s
  where s.trip_date = p_date;

  return v_result;
end;
$$;

/* ===== นำเข้าจริง =====
 *
 * ข้ามใบที่ยังไม่จับคู่ร้าน ไม่ใช่ล้มทั้งวัน — วันหนึ่งมีร้านใหม่โผล่มาใบเดียว
 * ไม่ควรทำให้อีก 22 ใบเข้าระบบไม่ได้ ใบที่ข้ามยังอยู่ใน tms_shipments รอจับคู่แล้วสั่งซ้ำได้
 *
 * เรียกซ้ำวันเดิมปลอดภัย: ใบที่มี order_id แล้วถูกข้าม (idempotent)
 * จำเป็น เพราะ cron อาจยิงซ้ำ และคนก็กดปุ่มซ้ำได้
 *
 * ไม่สร้างเที่ยว (trips) ให้อัตโนมัติ — TMS บอกว่า "ใครวิ่งไปแล้ว" ซึ่งเป็นอดีต
 * ส่วน trips ของเราคือแผนที่คนจัดรถกดยืนยัน สองอย่างนี้คนละความหมาย
 * ออเดอร์ที่นำเข้าจึงเป็น pending รอจัดเที่ยวตามปกติ เก็บ tripNo เดิมไว้ใน notes ให้ตามรอยได้
 */
create or replace function public.import_tms_shipments(p_date date)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_created int := 0;
  v_skipped int := 0;
  v_row     record;
  v_order   public.orders;
  v_origin  text;
begin
  if not app.has_perm('orders.write') then
    raise exception 'ไม่มีสิทธิ์นำเข้าออเดอร์' using errcode = '42501';
  end if;

  select coalesce(value, 'คลังบริษัท') into v_origin from public.settings where key = 'org_name';

  for v_row in
    select s.picking_list_no,
           max(s.dealer_name)  as dealer_name,
           max(s.branch)       as branch,
           max(s.trip_no_tms)  as trip_no_tms,
           max(m.customer_id)  as customer_id,
           max(s.trip_date)    as trip_date,
           sum(coalesce(s.item_qty, 0)) as total_qty,
           string_agg(distinct coalesce(s.item_name, s.item_no), ', ') as goods
      from public.tms_shipments s
      join public.tms_dealer_map m on m.dealer_code = s.dealer_code
     where s.trip_date = p_date
       and s.order_id is null
       and m.customer_id is not null
       and not m.ignored
     group by s.picking_list_no
  loop
    insert into public.orders (customer_id, origin, destination, goods_desc,
                               weight_kg, fee, status, scheduled_at, notes)
    values (v_row.customer_id,
            v_origin,
            coalesce(nullif(trim(v_row.branch), ''), v_row.dealer_name),
            left(coalesce(v_row.goods, 'สินค้าตาม PL'), 500),
            0,
            0,
            'pending',
            v_row.trip_date,
            'นำเข้าจาก TMS · PL ' || v_row.picking_list_no
              || coalesce(' · เที่ยว ' || v_row.trip_no_tms, '')
              || ' · ' || v_row.total_qty || ' คัน')
    returning * into v_order;

    update public.tms_shipments
       set order_id = v_order.id
     where picking_list_no = v_row.picking_list_no;

    v_created := v_created + 1;
  end loop;

  select count(distinct s.picking_list_no) into v_skipped
    from public.tms_shipments s
    left join public.tms_dealer_map m on m.dealer_code = s.dealer_code
   where s.trip_date = p_date
     and s.order_id is null
     and (m.customer_id is null or m.ignored);

  return json_build_object('date', p_date, 'created', v_created, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.preview_tms_import, public.import_tms_shipments from public;
grant execute on function public.preview_tms_import, public.import_tms_shipments to authenticated;
/* 0009 — รับข้อมูลที่คนออฟฟิศ "ผลัก" ขึ้นมาเอง แทน Edge Function ตั้งเวลา
 *
 * ทำไมเปลี่ยนจากแผนเดิม (tms-sync ยิงเองตอนตี 1):
 * แผนเดิมต้องเก็บ user/password ของ TMS บริษัทไว้ใน Supabase Secrets
 * = รหัสของบริษัทไปนอนอยู่บนคลาวด์ต่างประเทศ ต้องขออนุญาต IT ก่อน และถ้ารหัสหมดอายุ
 * ก็เงียบไปเฉย ๆ จนกว่าจะมีคนสังเกต
 *
 * แบบใหม่: คนออฟฟิศเปิด TMS Extractor บนเครื่องตัวเอง ล็อกอิน TMS ด้วยรหัสตัวเอง
 * (รหัสอยู่ในหัวคน ไม่มีในไฟล์ ไม่มีบนคลาวด์) ดึงข้อมูล แล้วกดปุ่มส่งขึ้นมา
 * แลกกับข้อเสียเดียว: เช้าไหนไม่มีใครกด ข้อมูลก็ไม่มา -> จึงต้องมี tms_sync_log
 * ให้หน้าจอเตือนได้ว่า "วันนี้ยังไม่มีใครดึง"
 *
 * ยังไม่เปิด insert ตรง ๆ บนตาราง — เขียนผ่านฟังก์ชันตัวเดียวเท่านั้น
 * ตารางจึงมีทางเข้าทางเดียวที่ตรวจสิทธิ์แล้ว ไม่ต้องพึ่ง service_role อีก
 */

/* ===== บันทึกว่าใครดึงวันไหนเมื่อไหร่ ===== */
create table public.tms_sync_log (
  id            bigint generated always as identity primary key,
  trip_date     date not null,
  rows_pushed   integer not null default 0,
  picking_lists integer not null default 0,
  synced_by     bigint references public.users (id),
  synced_at     timestamptz not null default now()
);

create index tms_sync_log_date_idx on public.tms_sync_log (trip_date, synced_at desc);

alter table public.tms_sync_log enable row level security;

/* อ่านได้เท่านั้น เขียนผ่าน push_tms_shipments อย่างเดียว */
create policy tms_sync_log_select on public.tms_sync_log
  for select to authenticated using (app.has_perm('orders.view'));

/* ===== รับข้อมูลเข้า =====
 *
 * p_rows คือ array ของแถวจากรายงาน Actual Shipment ตามชื่อฟิลด์ที่ TMS ส่งมาจริง
 * (ดู extractor/tms-extractor/public/app.js — ตัวนั้นเจอของจริงมาก่อน)
 *
 * upsert ด้วย (picking_list_no, item_no) ตาม unique ที่มีอยู่แล้วใน 0001
 * item_no ว่างถูกแปลงเป็น '' ไม่ใช่ null — เพราะ Postgres ถือว่า null ไม่ชนกับ null
 * แถว "PL ที่ไม่มี item" จะกลายเป็นแถวใหม่ทุกครั้งที่กดส่ง ถ้าปล่อยเป็น null
 *
 * order_id ไม่เคยถูกแตะตอน upsert — ใบที่นำเข้าเป็นออเดอร์ไปแล้ว กดส่งซ้ำก็ไม่หลุด
 */
create or replace function public.push_tms_shipments(p_rows jsonb)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user  bigint := app.current_user_id();
  v_rows  int := 0;
  v_dates date[];
  v_d     date;
begin
  if not app.has_perm('orders.write') then
    raise exception 'ไม่มีสิทธิ์ส่งข้อมูลเข้าระบบ' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;

  /* กันคู่ (PL, item) ซ้ำภายในก้อนเดียวกัน — Postgres จะฟ้อง
     "ON CONFLICT DO UPDATE command cannot affect row a second time"
     ถ้ามีสองแถวในคำสั่งเดียวชนกันเอง ซึ่งเกิดได้จริงเมื่อ PL ถูกแบ่งส่งหลายเที่ยว
     เอาแถวหลังสุดของแต่ละคู่ (ordinality สูงสุด) เพราะรายงานเรียงตามเวลา */
  with src as (
    select distinct on (e.r->>'pickingListNo', coalesce(e.r->>'itemNo', ''))
           e.r
      from jsonb_array_elements(p_rows) with ordinality as e(r, n)
     order by e.r->>'pickingListNo', coalesce(e.r->>'itemNo', ''), e.n desc
  ),
  up as (
    insert into public.tms_shipments (
      picking_list_no, item_no, trip_no_tms, trip_date,
      dealer_code, dealer_name, branch, unit,
      item_name, item_qty, item_split_qty, qty_source,
      license_plate, driver_name, status_delivery, actual_cost,
      raw, synced_at
    )
    select
      nullif(r->>'pickingListNo', ''),
      coalesce(r->>'itemNo', ''),
      nullif(r->>'tripNo', ''),
      nullif(r->>'tripDate', '')::date,
      nullif(r->>'dealerCode', ''),
      nullif(r->>'dealerName', ''),
      nullif(r->>'branch', ''),
      nullif(r->>'unit', '')::numeric::integer,
      nullif(r->>'itemName', ''),
      nullif(r->>'itemQty', '')::numeric::integer,
      nullif(r->>'itemSplitQty', '')::numeric::integer,
      nullif(r->>'qtySource', ''),
      nullif(r->>'licensePlate', ''),
      nullif(r->>'driver', ''),
      nullif(r->>'statusDelivery', ''),
      nullif(r->>'actualCost', '')::numeric,
      r,
      now()
    from src
    where nullif(r->>'pickingListNo', '') is not null
    on conflict (picking_list_no, item_no) do update set
      trip_no_tms     = excluded.trip_no_tms,
      trip_date       = excluded.trip_date,
      dealer_code     = excluded.dealer_code,
      dealer_name     = excluded.dealer_name,
      branch          = excluded.branch,
      unit            = excluded.unit,
      item_name       = excluded.item_name,
      item_qty        = excluded.item_qty,
      item_split_qty  = excluded.item_split_qty,
      qty_source      = excluded.qty_source,
      license_plate   = excluded.license_plate,
      driver_name     = excluded.driver_name,
      status_delivery = excluded.status_delivery,
      actual_cost     = excluded.actual_cost,
      raw             = excluded.raw,
      synced_at       = now()
    returning trip_date
  )
  select count(*)::int, array_agg(distinct trip_date) filter (where trip_date is not null)
    into v_rows, v_dates
    from up;

  /* ลงบันทึกแยกตามวัน — หน้าจอถามว่า "วันนี้ดึงหรือยัง" ทีละวันเสมอ */
  foreach v_d in array coalesce(v_dates, array[]::date[]) loop
    insert into public.tms_sync_log (trip_date, rows_pushed, picking_lists, synced_by)
    select v_d,
           count(*)::int,
           count(distinct picking_list_no)::int,
           v_user
      from public.tms_shipments
     where trip_date = v_d;
  end loop;

  return json_build_object(
    'rows', v_rows,
    'dates', coalesce(to_json(v_dates), '[]'::json)
  );
end;
$$;

/* ===== ข้อมูลวันนี้มาหรือยัง =====
   หน้าออฟฟิศเรียกตัวนี้ตอนเปิดหน้า เพื่อขึ้นแถบเตือนถ้ายังไม่มีใครดึง */
create or replace function public.tms_sync_status(p_date date)
returns json
language sql security definer set search_path = public
as $$
  select json_build_object(
    'date', p_date,
    'synced_at',     (select max(synced_at) from public.tms_sync_log where trip_date = p_date),
    'picking_lists', (select count(distinct picking_list_no)::int
                        from public.tms_shipments where trip_date = p_date),
    'pending_import',(select count(distinct picking_list_no)::int
                        from public.tms_shipments where trip_date = p_date and order_id is null)
  )
  where app.has_perm('orders.view');
$$;

revoke execute on function public.push_tms_shipments, public.tms_sync_status from public;
grant execute on function public.push_tms_shipments, public.tms_sync_status to authenticated;
/* 0010 — ตัวตนของพนักงานออฟฟิศมาจากการล็อกอิน TMS บริษัท
 *
 * แนวคิด: ถ้าล็อกอิน TMS ผ่าน = เป็นพนักงานจริง ไม่ต้องสร้างบัญชีอีกชุดให้คนจำสองรหัส
 * แต่ "เป็นพนักงานจริง" ยังไม่เท่ากับ "ควรเห็นข้อมูลลูกค้าทุกราย"
 * บัญชีที่เกิดจากการล็อกอินครั้งแรกจึงเป็น is_active = false และไม่มีสิทธิ์อะไรเลย
 * จนกว่า admin จะอนุมัติ
 *
 * ที่ใช้ is_active เดิมแทนการเพิ่มคอลัมน์ status ใหม่ เพราะ app.current_user_id()
 * กรอง is_active อยู่แล้ว -> บัญชีรออนุมัติจึงไม่มีตัวตนในสายตา RLS ทุก policy
 * โดยไม่ต้องแก้ policy สักตัว
 *
 * ผลข้างเคียงที่ต้องแก้: คนรออนุมัติอ่านแม้แต่แถวตัวเองไม่ได้ (policy ใช้ current_user_id)
 * หน้าจอเลยไม่มีทางบอกได้ว่า "รออนุมัติอยู่" กับ "ล็อกอินพัง" ต่างกันยังไง
 * -> my_account() อ่านจาก auth.uid() ตรง ๆ ข้าม is_active
 *
 * คนขับไม่เกี่ยวกับ TMS เลย — ยังใช้อีเมล/รหัสผ่านของ Supabase เหมือนเดิม
 */

alter table public.users
  add column auth_source text not null default 'local'
    constraint users_auth_source_check check (auth_source in ('local', 'tms')),
  add column approved_at timestamptz,
  add column approved_by bigint references public.users (id),
  add column last_login_at timestamptz;

comment on column public.users.auth_source is
  'local = อีเมล/รหัสผ่านของ Supabase (คนขับ, admin คนแรก) · tms = ยืนยันตัวผ่าน TMS บริษัท';

/* admin คนแรกที่สร้างด้วยมือไว้แล้ว ถือว่าอนุมัติตัวเองมาตั้งแต่ต้น */
update public.users set approved_at = created_at where is_active;

/* ===== ฉันเป็นใคร =====
   ตัวเดียวในระบบที่ตอบได้แม้บัญชียังไม่ถูกอนุมัติ — หน้า login ใช้แยกสามกรณี:
   ไม่มีบัญชี / มีแต่รออนุมัติ / ใช้งานได้ */
create or replace function public.my_account()
returns json
language sql stable security definer set search_path = public, auth
as $$
  select coalesce(
    (select json_build_object(
       'found',     true,
       'user_id',   u.id,
       'name',      u.name,
       'username',  u.username,
       'role',      u.role,
       'is_active', u.is_active,
       'source',    u.auth_source
     )
     from public.users u where u.auth_id = auth.uid()),
    json_build_object('found', false)
  )
$$;

revoke execute on function public.my_account from public;
grant execute on function public.my_account to authenticated;

/* ===== อนุมัติพนักงาน =====
   แยกเป็นฟังก์ชันแทนที่จะให้ admin update ตรง ๆ เพราะสองอย่างต้องเกิดพร้อมกันเสมอ:
   เปิดใช้งาน + กำหนดบทบาท  ถ้าเปิดใช้งานก่อนแล้วลืมตั้งบทบาท คนนั้นจะได้ 'viewer'
   ตาม default ของคอลัมน์ ซึ่งเป็นการให้สิทธิ์โดยไม่มีใครตั้งใจ */
create or replace function public.approve_user(p_user_id bigint, p_role user_role)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_me bigint := app.current_user_id();
  v_u  public.users;
begin
  if not app.has_perm('users.manage') then
    raise exception 'ไม่มีสิทธิ์อนุมัติผู้ใช้' using errcode = '42501';
  end if;

  /* กันเผลอ: บทบาท driver ต้องมีแถวใน drivers ถึงจะใช้งานได้จริง
     อนุมัติพนักงานออฟฟิศให้เป็น driver = คนนั้นล็อกอินได้แต่เมนูว่างเปล่า */
  if p_role = 'driver' then
    raise exception 'บัญชีคนขับต้องสร้างจากหน้าพนักงานขับรถ ไม่ใช่จากการอนุมัติ'
      using errcode = '22023';
  end if;

  update public.users
     set role = p_role, is_active = true,
         approved_at = now(), approved_by = v_me
   where id = p_user_id
  returning * into v_u;

  if v_u.id is null then
    raise exception 'ไม่พบผู้ใช้' using errcode = 'P0002';
  end if;

  return json_build_object('user_id', v_u.id, 'name', v_u.name, 'role', v_u.role);
end;
$$;

/* ปฏิเสธ/ระงับ — ไม่ลบแถวทิ้ง เพราะ orders.created_by ฯลฯ อ้างถึงอยู่
   และถ้าลบ พอคนเดิมล็อกอิน TMS อีกครั้ง บัญชีก็จะเกิดใหม่วนไปเรื่อย ๆ */
create or replace function public.revoke_user(p_user_id bigint)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_me bigint := app.current_user_id();
begin
  if not app.has_perm('users.manage') then
    raise exception 'ไม่มีสิทธิ์ระงับผู้ใช้' using errcode = '42501';
  end if;
  if p_user_id = v_me then
    raise exception 'ระงับบัญชีตัวเองไม่ได้' using errcode = '22023';
  end if;

  update public.users set is_active = false where id = p_user_id;
  return json_build_object('user_id', p_user_id, 'is_active', false);
end;
$$;

revoke execute on function public.approve_user, public.revoke_user from public;
grant execute on function public.approve_user, public.revoke_user to authenticated;
