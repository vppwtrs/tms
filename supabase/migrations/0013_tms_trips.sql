/* 0013 — เที่ยวของ TMS เป็นแหล่งที่สอง: "ใครวิ่ง ถึงไหนแล้ว"
 *
 * วัดของจริงจาก /v1/tripheaders/{warehouseGuid}/search ก่อนออกแบบ:
 *
 *   8b2c7a7a KM23-CW-02   172 เที่ยว   carrier = Fleet Owner ล้วน 172/172
 *   5af1fd5f KM23-CW-01   4,200 เที่ยว carrier ปนกัน ของเรา (Fleet Owner (Scooter)) 66 จาก 200 ที่สแกน
 *   f73c1803 KM12-MQ-01   1,940 เที่ยว ATM/NGCH/KTS/Naphat/VES — **ไม่มีของเราเลยแม้แต่เที่ยวเดียว**
 *
 * ตัวเลขที่เปลี่ยนสโคปทั้งงาน: **กองรถเราวิ่งวันละ 2–6 เที่ยว** ไม่ใช่ 23 ใบจากทุกเจ้า
 *
 * เส้นแบ่งของสองแหล่ง — เสริมกัน ไม่ใช่แทนกัน อย่าตัดอันใดอันหนึ่งทิ้ง:
 *   tms_shipments (PL)  "มีของต้องส่ง"     ใบสถานะ New ยังไม่มีเที่ยว ไม่โผล่ในหน้า Trip เลย
 *   tms_trips     (Trip) "ใครวิ่ง ถึงไหน"  มีทะเบียน คนขับ ต้นทุน และสถานะที่ขยับทั้งวัน
 *
 * สถานะที่ TMS ใช้จริง (statusId ตรงตัว ไม่ใช่ที่เดาไว้):
 *   เที่ยว  2 Confirm -> 3 Handling -> 4 OnDelivery -> 5 Completed   ·  6 Cancelled
 *   ใบในเที่ยวของเรา  2 AssignTrip -> 3 OnTruck -> 4 Completed
 *
 * `cost` / `actual_cost` เป็นตัวเลขเงิน — อยู่ในตารางนี้ซึ่ง view ฝั่งคนขับไม่แตะ
 * ห้ามลากสองคอลัมน์นี้ไปโผล่ใน my_trips / my_orders (กติกาข้อหลักของโปรเจ็ค)
 */

/* ===== carrier ที่นับว่าเป็นกองรถของเรา =====
 * ด่านแรกสุดของทุก query ในไฟล์นี้ เจ้าอื่น (ATM · NGCH · KTS · TOLL · VES · Naphat)
 * คือ outsource ที่บริษัทจ้างวิ่ง ไม่ใช่งานของคนขับเรา **ห้ามหลุดเข้ามาเป็นออเดอร์**
 *
 * เป็นตารางไม่ใช่ค่าคงที่ในโค้ด เพราะวันหนึ่งบริษัทตั้งกองรถชุดที่สาม
 * แล้วต้องแก้ทั้ง client + function พร้อมกัน ซึ่งจะลืมข้างหนึ่งแน่
 * กรองซ้ำสองชั้น (client กรองแล้ว ฐานกรองอีก) เพราะฐานต้องไม่พึ่งว่า client ทำถูก
 */
create table public.tms_carriers (
  carrier_name text primary key,
  is_ours      boolean not null default true,
  note         text
);

insert into public.tms_carriers (carrier_name, is_ours, note) values
  ('Fleet Owner',           true,  'กองรถบริษัท คลัง KM23-CW-02'),
  ('Fleet Owner (Scooter)', true,  'กองรถบริษัท ฝั่งสกู๊ตเตอร์ คลัง KM23-CW-01'),
  ('ATM',   false, 'outsource'),
  ('NGCH',  false, 'outsource'),
  ('KTS',   false, 'outsource'),
  ('TOLL',  false, 'outsource'),
  ('VES',   false, 'outsource'),
  ('Naphat', false, 'outsource');

alter table public.tms_carriers enable row level security;

create policy tms_carriers_select on public.tms_carriers
  for select to authenticated using (app.has_perm('orders.view'));

/* ===== เที่ยวของ TMS ===== */
create table public.tms_trips (
  /* คีย์คือ GUID ของ TMS ไม่ใช่ trip_no — เลขเที่ยวเป็นรูป yyyymmddnnn ซึ่งซ้ำข้ามคลังได้
     ใช้ trip_no เป็นคีย์คือรอวันที่สองคลังออกเลขเดียวกันแล้วทับกันเงียบ ๆ */
  tms_id            uuid primary key,
  trip_no           text not null,
  warehouse_id      uuid,
  warehouse_code    text,
  /* orderDate = วันของเที่ยว ตรงกับคอลัมน์ Trip Date ในหน้า TMS */
  order_date        date,
  license_plate     text,
  /* ชื่อคนขับมาแบบ "เอกชัย บุญอินทร์ (เอก)" วงเล็บคือชื่อเล่น — เก็บทั้งก้อน
     ตัดวงเล็บทิ้งแล้วจับคู่ผิดคนทันทีเมื่อมีคนชื่อซ้ำ ซึ่งกองรถหลักสิบคนเกิดได้ */
  driver_name       text,
  carrier_id        uuid,
  carrier_name      text,
  vehicle_type      text,
  area              text,
  cost              numeric,
  actual_cost       numeric,
  status_id         integer,
  status            text,
  reason            text,
  on_delivery_date  timestamptz,
  total_pl          integer,
  total_unit        numeric,
  raw               jsonb not null,
  row_hash          text,
  first_seen_at     timestamptz not null default now(),
  status_changed_at timestamptz,
  synced_at         timestamptz not null default now(),
  /* เที่ยวฝั่งเราที่เกิดจากเที่ยวนี้ — null = ยังไม่ได้นำเข้า */
  trip_id           bigint references public.trips (id) on delete set null
);

create index tms_trips_date_idx    on public.tms_trips (order_date desc);
create index tms_trips_status_idx  on public.tms_trips (status_id);
create index tms_trips_trip_idx    on public.tms_trips (trip_id);
create index tms_trips_no_idx      on public.tms_trips (trip_no);

alter table public.tms_trips enable row level security;

/* อ่านได้เท่านั้น เขียนผ่านฟังก์ชันอย่างเดียว เหมือน tms_sync_log */
create policy tms_trips_select on public.tms_trips
  for select to authenticated using (app.has_perm('dispatch.view'));

/* ใบไหนอยู่ในเที่ยวไหน — ตอบไม่ได้จาก tms_shipments เดิม เพราะมีแต่ trip_no ที่เป็น text */
alter table public.tms_shipments
  add column tms_trip_id uuid references public.tms_trips (tms_id) on delete set null;

create index tms_shipments_tms_trip_idx on public.tms_shipments (tms_trip_id);

/* ===== ตารางจับคู่คนขับ / รถ =====
 * หลักเดียวกับ tms_dealer_map: คนยืนยันครั้งเดียวต่อคน/ต่อคัน แล้วระบบจำ
 * ไม่ match ชื่อเอง เพราะชื่อคนขับใน TMS มีชื่อเล่นในวงเล็บ ทะเบียนก็มีทั้งแบบมีขีดและไม่มี
 * เดาผิด = งานไปโผล่ในมือคนขับผิดคน ซึ่งแย่กว่าไม่จับคู่ให้เลย
 *
 * driver_id / vehicle_id เป็น null (ยังไม่ตัดสินใจ) ต่างจาก ignored (ตัดสินใจแล้วว่าไม่เอา)
 */
create table public.tms_driver_map (
  driver_key  text primary key,
  driver_id   bigint references public.drivers (id) on delete set null,
  ignored     boolean not null default false,
  mapped_by   bigint references public.users (id),
  mapped_at   timestamptz,
  created_at  timestamptz not null default now()
);

create table public.tms_vehicle_map (
  plate       text primary key,
  vehicle_id  bigint references public.vehicles (id) on delete set null,
  ignored     boolean not null default false,
  mapped_by   bigint references public.users (id),
  mapped_at   timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.tms_driver_map  enable row level security;
alter table public.tms_vehicle_map enable row level security;

create policy driver_map_select on public.tms_driver_map
  for select to authenticated using (app.has_perm('drivers.view'));
create policy driver_map_write on public.tms_driver_map
  for all to authenticated
  using (app.has_perm('drivers.write')) with check (app.has_perm('drivers.write'));

create policy vehicle_map_select on public.tms_vehicle_map
  for select to authenticated using (app.has_perm('vehicles.view'));
create policy vehicle_map_write on public.tms_vehicle_map
  for all to authenticated
  using (app.has_perm('vehicles.write')) with check (app.has_perm('vehicles.write'));

/* ===== รับเที่ยวเข้า =====
 *
 * เขียนแต่ตัวเที่ยว ไม่เขียนเนื้อใบ — เนื้อใบมีทางเข้าทางเดียวคือ push_tms_shipments (0012)
 * สองฟังก์ชันเขียนตารางเดียวกันคือรอวันที่ตรรกะสองที่เพี้ยนจากกันแล้วหาไม่เจอว่าใครเขียน
 * ที่นี่แค่ **ผูก** ใบเข้าเที่ยวด้วยเลข PL ที่ติดมาใน pickingLists[]
 *
 * row_hash / status_changed_at หลักเดียวกับ 0012 — ของเดิมเป๊ะ = ไม่แตะแถว
 * รอบ 5 นาทีของกองรถ 2–6 เที่ยวต่อวัน ส่วนใหญ่ไม่มีอะไรเปลี่ยนเลย
 */
create or replace function public.push_tms_trips(p_rows jsonb)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_inserted int := 0;
  v_updated  int := 0;
  v_seen     int := 0;
  v_skipped  int := 0;
  v_linked   int := 0;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์ส่งข้อมูลเที่ยวเข้าระบบ' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;

  select count(*)::int into v_seen from jsonb_array_elements(p_rows);

  drop table if exists _trip_push;
  create temp table _trip_push (tms_id uuid, inserted boolean) on commit drop;

  with src as (
    select distinct on (r->>'id') r
      from jsonb_array_elements(p_rows) with ordinality as e(r, n)
     where nullif(r->>'id', '') is not null
     order by r->>'id', e.n desc
  ),
  shaped as (
    select
      (r->>'id')::uuid                            as tms_id,
      nullif(r->>'tripNo', '')                    as trip_no,
      nullif(r->>'warehouseId', '')::uuid         as warehouse_id,
      nullif(r->>'warehouse', '')                 as warehouse_code,
      nullif(r->>'orderDate', '')::date           as order_date,
      nullif(r->>'licensePlate', '')              as license_plate,
      nullif(r->>'driver', '')                    as driver_name,
      nullif(r->>'carrierId', '')::uuid           as carrier_id,
      nullif(r->>'carrierName', '')               as carrier_name,
      nullif(r->>'vehicleTypeName', '')           as vehicle_type,
      nullif(r->>'area', '')                      as area,
      nullif(r->>'cost', '')::numeric             as cost,
      nullif(r->>'actualCost', '')::numeric       as actual_cost,
      nullif(r->>'statusId', '')::integer         as status_id,
      nullif(r->>'status', '')                    as status,
      nullif(r->>'reason', '')                    as reason,
      nullif(r->>'onDeliveryDate', '')::timestamptz as on_delivery_date,
      nullif(r->>'totalPL', '')::integer          as total_pl,
      nullif(r->>'totalUnit', '')::numeric        as total_unit,
      r                                           as raw
    from src
  ),
  ours as (
    /* ด่าน carrier — เจ้าที่ไม่รู้จักถือว่า **ไม่ใช่ของเรา** ไม่ใช่เดาว่าใช่
       เจ้าใหม่โผล่มาแล้วไหลเข้าเป็นงานคนขับเราเงียบ ๆ แย่กว่าเที่ยวหายไปหนึ่งเที่ยว
       (เที่ยวหายมีคนทัก งานผิดเจ้าไม่มีใครทัก) */
    select s.* from shaped s
      join public.tms_carriers c on c.carrier_name = s.carrier_name
     where c.is_ours
  ),
  hashed as (
    select o.*, md5(concat_ws('|', o.trip_no, o.order_date, o.license_plate, o.driver_name,
             o.carrier_name, o.vehicle_type, o.area, o.cost, o.actual_cost, o.status_id,
             o.status, o.reason, o.on_delivery_date, o.total_pl, o.total_unit)) as row_hash
      from ours o
  ),
  up as (
    insert into public.tms_trips (
      tms_id, trip_no, warehouse_id, warehouse_code, order_date, license_plate, driver_name,
      carrier_id, carrier_name, vehicle_type, area, cost, actual_cost, status_id, status,
      reason, on_delivery_date, total_pl, total_unit, raw, row_hash, synced_at, status_changed_at
    )
    select h.tms_id, h.trip_no, h.warehouse_id, h.warehouse_code, h.order_date, h.license_plate,
           h.driver_name, h.carrier_id, h.carrier_name, h.vehicle_type, h.area, h.cost,
           h.actual_cost, h.status_id, h.status, h.reason, h.on_delivery_date, h.total_pl,
           h.total_unit, h.raw, h.row_hash, now(), now()
      from hashed h
    on conflict (tms_id) do update set
      trip_no          = excluded.trip_no,
      warehouse_id     = excluded.warehouse_id,
      warehouse_code   = excluded.warehouse_code,
      order_date       = excluded.order_date,
      license_plate    = excluded.license_plate,
      driver_name      = excluded.driver_name,
      carrier_id       = excluded.carrier_id,
      carrier_name     = excluded.carrier_name,
      vehicle_type     = excluded.vehicle_type,
      area             = excluded.area,
      cost             = excluded.cost,
      actual_cost      = excluded.actual_cost,
      status_id        = excluded.status_id,
      status           = excluded.status,
      reason           = excluded.reason,
      on_delivery_date = excluded.on_delivery_date,
      total_pl         = excluded.total_pl,
      total_unit       = excluded.total_unit,
      raw              = excluded.raw,
      row_hash         = excluded.row_hash,
      synced_at        = now(),
      status_changed_at = case when tms_trips.status_id is distinct from excluded.status_id
                          then now() else tms_trips.status_changed_at end
      /* trip_id ไม่อยู่ในรายการ set — เที่ยวที่นำเข้าแล้วส่งซ้ำก็ไม่หลุดจากเที่ยวฝั่งเรา */
      where tms_trips.row_hash is distinct from excluded.row_hash
    returning tms_id, (xmax = 0) as inserted
  )
  insert into _trip_push select tms_id, inserted from up;

  select count(*) filter (where inserted)::int, count(*) filter (where not inserted)::int
    into v_inserted, v_updated from _trip_push;

  /* ผูกใบเข้าเที่ยว — ใบต้องถูก push มาก่อนด้วย push_tms_shipments
     ใบที่ยังไม่มาก็ไม่เป็นไร รอบหน้าที่ push ใบแล้วเรียกซ้ำก็ผูกติด */
  with pl as (
    select (r->>'id')::uuid as tms_id, p->>'pickingListNo' as pl_no
      from jsonb_array_elements(p_rows) as e(r)
      cross join lateral jsonb_array_elements(coalesce(e.r->'pickingLists', '[]'::jsonb)) as d(p)
     where nullif(r->>'id', '') is not null
  ),
  upd as (
    update public.tms_shipments s
       set tms_trip_id = pl.tms_id
      from pl
      join public.tms_trips t on t.tms_id = pl.tms_id
     where s.picking_list_no = pl.pl_no
       and s.tms_trip_id is distinct from pl.tms_id
    returning 1
  )
  select count(*)::int into v_linked from upd;

  select count(*)::int into v_skipped
    from jsonb_array_elements(p_rows) as e(r)
    left join public.tms_carriers c
      on c.carrier_name = nullif(e.r->>'carrierName', '') and c.is_ours
   where c.carrier_name is null;

  return json_build_object(
    'seen',      v_seen,
    'inserted',  coalesce(v_inserted, 0),
    'updated',   coalesce(v_updated, 0),
    'unchanged', greatest(v_seen - v_skipped - coalesce(v_inserted, 0) - coalesce(v_updated, 0), 0),
    'skipped_carrier', v_skipped,
    'linked_pl', coalesce(v_linked, 0)
  );
end;
$$;

/* ===== สร้างคนขับ / รถ จากข้อมูล TMS พร้อมจับคู่ในจังหวะเดียว =====
 * เหตุผลเดียวกับ create_customer_from_dealer (0012): สองคำสั่งแยกกันแล้วเน็ตหลุด
 * = ได้คนขับที่ไม่ผูกกับใครลอยอยู่ แล้วคนกดสร้างใหม่ กลายเป็นคนขับซ้ำสองคน
 *
 * คนขับที่สร้างจากที่นี่ **ยังไม่มี user_id** จึงยังเข้าแอปไม่ได้ ตั้งใจให้เป็นแบบนั้น
 * บัญชีของคนขับต้องมีคนสร้างให้ทีหลัง ไม่ใช่งอกเองจากชื่อในระบบบริษัท
 */
create or replace function public.create_driver_from_tms(p_driver_key text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_id bigint;
begin
  if not app.has_perm('drivers.write') then
    raise exception 'ไม่มีสิทธิ์สร้างพนักงานขับ' using errcode = '42501';
  end if;
  if coalesce(trim(p_driver_key), '') = '' then
    raise exception 'ไม่มีชื่อพนักงานขับให้สร้าง' using errcode = 'P0002';
  end if;

  select driver_id into v_id from public.tms_driver_map
   where driver_key = p_driver_key and driver_id is not null;

  if v_id is null then
    insert into public.drivers (name) values (trim(p_driver_key)) returning id into v_id;
  end if;

  insert into public.tms_driver_map (driver_key, driver_id, mapped_by, mapped_at)
  values (p_driver_key, v_id, app.current_user_id(), now())
  on conflict (driver_key) do update set
    driver_id = excluded.driver_id, ignored = false,
    mapped_by = excluded.mapped_by, mapped_at = now();

  return json_build_object('driver_id', v_id, 'name', trim(p_driver_key));
end;
$$;

create or replace function public.create_vehicle_from_tms(p_plate text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_id   bigint;
  v_type text;
begin
  if not app.has_perm('vehicles.write') then
    raise exception 'ไม่มีสิทธิ์สร้างรถ' using errcode = '42501';
  end if;
  if coalesce(trim(p_plate), '') = '' then
    raise exception 'ไม่มีทะเบียนให้สร้าง' using errcode = 'P0002';
  end if;

  select vehicle_id into v_id from public.tms_vehicle_map
   where plate = p_plate and vehicle_id is not null;

  /* ทะเบียนเดียวกันอาจมีอยู่ในตารางรถแล้วโดยที่ยังไม่มีใครจับคู่ — ใช้ของเดิม ไม่สร้างซ้ำ
     (plate_no เป็น unique อยู่แล้ว insert ซ้ำจะล้มทั้งฟังก์ชัน) */
  if v_id is null then
    select id into v_id from public.vehicles where plate_no = trim(p_plate);
  end if;

  if v_id is null then
    /* ชนิดรถของ TMS (4W / 4WL / 6WM / 6WL) ไม่ตรงกับ enum ของเรา แปลหยาบ ๆ พอ
       ตัวเลขความจุปล่อยเป็นค่า default — เดาน้ำหนักบรรทุกจากชื่อชนิดรถไม่ได้
       และความจุที่ผิดจะไปโผล่เป็นคำเตือน "น้ำหนักเกิน" ตอนจัดเที่ยว */
    select case
             when vehicle_type like '6W%' then 'truck6'
             when vehicle_type like '10W%' then 'truck10'
             else 'pickup'
           end
      into v_type
      from public.tms_trips where license_plate = p_plate
     order by order_date desc nulls last limit 1;

    insert into public.vehicles (plate_no, vehicle_type)
    values (trim(p_plate), coalesce(v_type, 'pickup')::vehicle_type)
    returning id into v_id;
  end if;

  insert into public.tms_vehicle_map (plate, vehicle_id, mapped_by, mapped_at)
  values (p_plate, v_id, app.current_user_id(), now())
  on conflict (plate) do update set
    vehicle_id = excluded.vehicle_id, ignored = false,
    mapped_by = excluded.mapped_by, mapped_at = now();

  return json_build_object('vehicle_id', v_id, 'plate', trim(p_plate));
end;
$$;

/* ===== ดูก่อนนำเข้าเที่ยว =====
   ตอบทีเดียวว่าเที่ยวไหนพร้อม เที่ยวไหนขาดอะไร โดยไม่แตะข้อมูลจริง
   ห้ามมีปุ่มนำเข้าที่กดแล้วเข้าเลย — รถ/คนขับ/ร้าน ผิดคนเดียวคืองานไปผิดมือ */
create or replace function public.preview_tms_trips(p_date date default null)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_date date;
  v_out  json;
begin
  if not app.has_perm('dispatch.view') then
    raise exception 'ไม่มีสิทธิ์ดูแผนงาน' using errcode = '42501';
  end if;

  select coalesce(p_date, max(order_date)) into v_date from public.tms_trips;

  select json_build_object(
    'date', v_date,
    'latest_date', (select max(order_date) from public.tms_trips),
    'trips', coalesce((
      select json_agg(x order by x.trip_no)
        from (
          select t.tms_id, t.trip_no, t.status, t.status_id, t.reason,
                 t.license_plate, t.driver_name, t.area, t.vehicle_type,
                 t.total_pl, t.total_unit, t.warehouse_code,
                 t.trip_id is not null            as imported,
                 vm.vehicle_id                    as vehicle_id,
                 dm.driver_id                     as driver_id,
                 /* นับใบในเที่ยวที่ร้านยังไม่จับคู่ — ใบพวกนี้จะไม่กลายเป็นออเดอร์
                    เที่ยวที่มีใบค้างแบบนี้ยังนำเข้าได้ แต่จะได้ของไม่ครบเที่ยว */
                 (select count(distinct s.picking_list_no)
                    from public.tms_shipments s
                    left join public.tms_dealer_map m on m.dealer_code = s.dealer_code
                   where s.tms_trip_id = t.tms_id
                     and (m.customer_id is null or m.ignored)) as unmapped_pls,
                 (select count(distinct s.picking_list_no)
                    from public.tms_shipments s
                   where s.tms_trip_id = t.tms_id) as pls_in_db
            from public.tms_trips t
            left join public.tms_vehicle_map vm on vm.plate = t.license_plate and not vm.ignored
            left join public.tms_driver_map  dm on dm.driver_key = t.driver_name and not dm.ignored
           where t.order_date = v_date
        ) x
    ), '[]'::json),
    /* ทะเบียน/คนขับที่ยังไม่จับคู่ของทั้งวัน — หน้าจอเอาไปทำปุ่มสร้างทีเดียว */
    'unmapped_plates', coalesce((
      select json_agg(distinct t.license_plate)
        from public.tms_trips t
        left join public.tms_vehicle_map vm on vm.plate = t.license_plate
       where t.order_date = v_date and t.license_plate is not null
         and (vm.plate is null or (vm.vehicle_id is null and not vm.ignored))
    ), '[]'::json),
    'unmapped_drivers', coalesce((
      select json_agg(distinct t.driver_name)
        from public.tms_trips t
        left join public.tms_driver_map dm on dm.driver_key = t.driver_name
       where t.order_date = v_date and t.driver_name is not null
         and (dm.driver_key is null or (dm.driver_id is null and not dm.ignored))
    ), '[]'::json),
    /* เที่ยวที่เรานำเข้าไปแล้วแต่ TMS ยกเลิกทีหลัง — **ไม่ยกเลิกให้เอง**
       รถอาจวิ่งออกไปแล้ว ต้องให้คนตัดสิน พร้อมเหตุผลที่ TMS ให้มา */
    'cancelled_after_import', coalesce((
      select json_agg(json_build_object('trip_no', t.trip_no, 'reason', t.reason,
                                        'our_trip_id', t.trip_id))
        from public.tms_trips t
       where t.status_id = 6 and t.trip_id is not null
    ), '[]'::json)
  ) into v_out;

  return v_out;
end;
$$;

/* ===== นำเข้าเที่ยว =====
 *
 * **กลับหลักการที่ 0008 เขียนไว้** ว่าไม่สร้าง trips อัตโนมัติเพราะ "tripNo ของ TMS คืออดีต"
 * เหตุผลนั้นตกไปเมื่อไปดูของจริง: เที่ยวสถานะ Confirm คือแผนที่ยังไม่ออกรถ
 * Handling คือกำลังโหลดของ ทั้งสองเป็นอนาคตกับปัจจุบัน ไม่ใช่อดีต
 * ให้คนจัดรถพิมพ์เที่ยวเดิมซ้ำในระบบเราคือให้ทำงานสองรอบเพื่อผลลัพธ์เดียวกัน
 *
 * ยังต้องให้คนกดยืนยันทีละเที่ยว ไม่ auto — ร้าน/รถ/คนขับต้องมีคนดูก่อน
 *
 * ทั้งก้อนอยู่ในทรานแซกชันเดียว: สร้างออเดอร์ -> สร้างเที่ยว -> ผูกออเดอร์เข้าเที่ยว
 * -> จองรถ/คนขับ ถ้าล้มกลางทางต้องไม่เหลือเที่ยวที่มีออเดอร์แต่รถยังว่าง
 */
create or replace function public.import_tms_trip(p_tms_id uuid)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_t        public.tms_trips;
  v_vehicle  bigint;
  v_driver   bigint;
  v_trip     public.trips;
  v_status   trip_status;
  v_row      record;
  v_order    public.orders;
  v_created  int := 0;
  v_skipped  int := 0;
  v_origin   text;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  select * into v_t from public.tms_trips where tms_id = p_tms_id for update;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;
  if v_t.trip_id is not null then
    /* เรียกซ้ำไม่สร้างเที่ยวที่สอง — คนกดสองครั้งได้เสมอ และหน้าจอก็ยิงซ้ำได้ */
    return json_build_object('trip_id', v_t.trip_id, 'created_orders', 0, 'already', true);
  end if;
  if v_t.status_id = 6 then
    raise exception 'เที่ยวนี้ถูกยกเลิกที่ TMS แล้ว' using errcode = 'P0001';
  end if;

  select vehicle_id into v_vehicle from public.tms_vehicle_map
   where plate = v_t.license_plate and not ignored;
  select driver_id into v_driver from public.tms_driver_map
   where driver_key = v_t.driver_name and not ignored;

  if v_vehicle is null then
    raise exception 'ทะเบียน % ยังไม่จับคู่กับรถในระบบ', v_t.license_plate using errcode = 'P0001';
  end if;
  if v_driver is null then
    raise exception 'พนักงานขับ % ยังไม่จับคู่กับคนในระบบ', v_t.driver_name using errcode = 'P0001';
  end if;

  select coalesce(value, 'คลังบริษัท') into v_origin from public.settings where key = 'org_name';

  /* สถานะของ TMS -> ของเรา  Handling กับ OnDelivery ยุบเป็น in_progress อันเดียว
     เพราะฝั่งเราไม่มีขั้น "กำลังโหลดของ" แยก และการเพิ่มขั้นใหม่กระทบหน้าคนขับทั้งหน้า */
  v_status := case v_t.status_id
                when 2 then 'planned'
                when 3 then 'in_progress'
                when 4 then 'in_progress'
                when 5 then 'completed'
                else 'planned'
              end::trip_status;

  insert into public.trips (vehicle_id, driver_id, status, notes)
  values (v_vehicle, v_driver, v_status,
          'นำเข้าจาก TMS · เที่ยว ' || v_t.trip_no
            || coalesce(' · ' || v_t.warehouse_code, '')
            || coalesce(' · เขต ' || v_t.area, ''))
  returning * into v_trip;

  /* ออเดอร์ของใบในเที่ยวนี้ — ใบที่ร้านยังไม่จับคู่ถูกข้าม ไม่ล้มทั้งเที่ยว
     ใบที่เคยนำเข้าเป็นออเดอร์แล้ว (order_id ไม่ null) ก็ถูกดึงมาผูกเที่ยวด้วย ไม่สร้างใหม่ */
  for v_row in
    select s.picking_list_no,
           max(s.order_id) as order_id,
           max(m.customer_id) as customer_id,
           max(s.dealer_name) as dealer_name,
           max(coalesce(s.ship_to_name, s.branch)) as ship_to_name,
           max(coalesce(s.ship_to_address, s.customer_address)) as ship_to_address,
           max(coalesce(s.ship_to_province, s.province)) as province,
           max(coalesce(s.plan_delivery_date, s.trip_date)) as plan_date,
           max(coalesce(s.total_qty, s.unit)) as total_qty,
           string_agg(distinct coalesce(s.item_name, s.item_no), ', ') as goods
      from public.tms_shipments s
      left join public.tms_dealer_map m on m.dealer_code = s.dealer_code
     where s.tms_trip_id = p_tms_id
     group by s.picking_list_no
  loop
    if v_row.order_id is not null then
      update public.orders
         set trip_id = v_trip.id,
             status = case when v_status = 'completed' then 'delivered'
                           when v_status = 'in_progress' then 'in_transit'
                           else 'assigned' end
       where id = v_row.order_id;
      continue;
    end if;

    if v_row.customer_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.orders (customer_id, origin, destination, goods_desc,
                               weight_kg, fee, status, scheduled_at, trip_id, notes)
    values (v_row.customer_id,
            v_origin,
            left(coalesce(nullif(trim(coalesce(v_row.ship_to_address, '') ||
                   coalesce(' จ.' || v_row.province, '')), ''),
                 v_row.ship_to_name, v_row.dealer_name), 500),
            left(coalesce(v_row.goods, 'สินค้าตาม PL'), 500),
            0,
            0,
            case when v_status = 'completed' then 'delivered'
                 when v_status = 'in_progress' then 'in_transit'
                 else 'assigned' end,
            coalesce(v_row.plan_date, v_t.order_date, current_date),
            v_trip.id,
            'นำเข้าจาก TMS · PL ' || v_row.picking_list_no
              || ' · เที่ยว ' || v_t.trip_no
              || ' · ' || coalesce(v_row.total_qty, 0) || ' คัน')
    returning * into v_order;

    update public.tms_shipments
       set order_id = v_order.id
     where picking_list_no = v_row.picking_list_no
       and tms_trip_id = p_tms_id;

    v_created := v_created + 1;
  end loop;

  /* จองรถ/คนขับเฉพาะเที่ยวที่ยังไม่จบ — เที่ยวที่นำเข้าย้อนหลังแบบ Completed
     ไม่ควรทำให้รถที่วิ่งงานอื่นอยู่วันนี้กลายเป็นไม่ว่าง */
  if v_status <> 'completed' then
    update public.vehicles set status = 'on_trip' where id = v_vehicle;
    update public.drivers  set status = 'on_trip' where id = v_driver;
  end if;

  update public.tms_trips set trip_id = v_trip.id where tms_id = p_tms_id;

  return json_build_object(
    'trip_id', v_trip.id,
    'trip_no', v_trip.trip_no,
    'status', v_status,
    'created_orders', v_created,
    'skipped_pls', v_skipped,
    'already', false
  );
end;
$$;

/* ===== กระดานสถานะ (แทน 0012) =====
   เพิ่มฝั่งเที่ยวเข้าไป และ **นับเที่ยวเป็นตัวหลัก** ยอดใบกับยอดคันเป็นตัวรอง
   คนจัดรถคิดเป็นเที่ยว ไม่ได้คิดเป็นใบ — กระดานที่นับใบเป็นหลักตอบคำถามที่เขาไม่ได้ถาม */
create or replace function public.tms_board(p_date date default null)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_date date;
  v_out  json;
begin
  if not app.has_perm('orders.view') then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลนำเข้า' using errcode = '42501';
  end if;

  /* วันล่าสุดที่มีของ ดูจากทั้งสองแหล่ง — เที่ยววันนี้อาจมาก่อนใบ หรือกลับกัน */
  select coalesce(p_date, greatest(
           (select max(coalesce(plan_delivery_date, trip_date)) from public.tms_shipments),
           (select max(order_date) from public.tms_trips)))
    into v_date;

  select json_build_object(
    'date', v_date,
    'latest_date', greatest(
      (select max(coalesce(plan_delivery_date, trip_date)) from public.tms_shipments),
      (select max(order_date) from public.tms_trips)),
    'synced_at', greatest(
      (select max(synced_at) from public.tms_shipments),
      (select max(synced_at) from public.tms_trips)),
    'last_change_at', greatest(
      (select max(status_changed_at) from public.tms_shipments),
      (select max(status_changed_at) from public.tms_trips)),
    /* ---- ฝั่งเที่ยว: ตัวหลัก ---- */
    'trips', (select count(*)::int from public.tms_trips where order_date = v_date),
    'trips_pending_import', (
      select count(*)::int from public.tms_trips
       where order_date = v_date and trip_id is null and status_id <> 6),
    'trips_by_status', coalesce((
      select json_agg(json_build_object('status', b.status, 'status_id', b.status_id,
                                        'trips', b.n, 'units', b.u) order by b.status_id)
        from (select status, status_id, count(*) n, coalesce(sum(total_unit), 0)::int u
                from public.tms_trips where order_date = v_date
               group by status, status_id) b
    ), '[]'::json),
    /* ---- ฝั่งใบ: ตัวรอง ---- */
    'picking_lists', (
      select count(distinct picking_list_no)::int from public.tms_shipments
       where coalesce(plan_delivery_date, trip_date) = v_date),
    'total_qty', (
      select coalesce(sum(u.unit), 0)::int from (
        select max(coalesce(total_qty, unit)) as unit from public.tms_shipments
         where coalesce(plan_delivery_date, trip_date) = v_date
         group by picking_list_no) u),
    'pending_import', (
      select count(distinct picking_list_no)::int from public.tms_shipments
       where coalesce(plan_delivery_date, trip_date) = v_date and order_id is null),
    'by_status', coalesce((
      select json_agg(json_build_object('pl_status', b.st, 'trip_status', b.ts, 'picking_lists', b.n)
                      order by b.n desc)
        from (select coalesce(pl_status, '-') st, coalesce(trip_status, '-') ts,
                     count(distinct picking_list_no) n
                from public.tms_shipments
               where coalesce(plan_delivery_date, trip_date) = v_date
               group by 1, 2) b
    ), '[]'::json),
    'recent_days', coalesce((
      select json_agg(json_build_object('date', d.dt, 'trips', d.tr,
                                        'picking_lists', d.n, 'pending', d.p) order by d.dt desc)
        from (
          select dt,
                 (select count(*) from public.tms_trips t where t.order_date = dt) tr,
                 count(distinct picking_list_no) n,
                 count(distinct picking_list_no) filter (where order_id is null) p
            from (select coalesce(plan_delivery_date, trip_date) dt, picking_list_no, order_id
                    from public.tms_shipments
                   where coalesce(plan_delivery_date, trip_date) is not null) z
           group by dt order by dt desc limit 14
        ) d
    ), '[]'::json)
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.push_tms_trips, public.preview_tms_trips,
  public.import_tms_trip, public.create_driver_from_tms, public.create_vehicle_from_tms from public;
grant execute on function public.push_tms_trips, public.preview_tms_trips,
  public.import_tms_trip, public.create_driver_from_tms, public.create_vehicle_from_tms to authenticated;
