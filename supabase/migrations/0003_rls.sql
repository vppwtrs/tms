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
