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
