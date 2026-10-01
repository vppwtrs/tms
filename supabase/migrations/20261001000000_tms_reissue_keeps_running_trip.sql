-- เที่ยวที่ TMS ออกเลขใหม่ระหว่างวิ่ง ต้องไม่ทำให้งานกับ GPS ของคนขับหาย
--
-- เหตุจริง 1 ต.ค. 2569 (รถ 3ฒน5038): TMS ยกเลิกเที่ยว 20261001001 แล้วแตกเป็น 002 + 003
-- auto_import_trips → import_tms_trip สร้างเที่ยวใหม่สถานะ planned แล้วย้ายใบ (ที่ส่งไปแล้ว 3 ใบ)
-- ออกจากเที่ยวเดิมที่คนขับรับงานและวิ่งอยู่ — ไม่มีใครรับเที่ยวใหม่ แอปจึงหยุดส่ง GPS
-- และเมื่อเที่ยวเดิมว่างแล้วถูก remove_order เก็บกวาด จุด GPS ทั้งเช้าหายตาม cascade
--
-- 1) trip_redirects — จำว่าเที่ยวเดิมย้ายไปเป็นเที่ยวไหน (ไม่มี FK ฝั่งเที่ยวเดิม เพราะเที่ยวเดิมจะถูกลบ)
-- 2) import_tms_trip — เที่ยวใหม่รับสถานะ/การรับงาน/จุด GPS จากเที่ยวเดิมที่คนขับชุดเดียวกันรับไว้
-- 3) log_trip_location — แอปที่ยังถือเลขเที่ยวเดิม ส่งจุดเข้าเที่ยวใหม่ให้เอง ไม่ต้องรีเฟรช

create table if not exists public.trip_redirects (
  old_trip_id bigint not null,
  new_trip_id bigint not null references public.trips(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (old_trip_id, new_trip_id)
);
alter table public.trip_redirects enable row level security;
-- ไม่มี policy: อ่าน/เขียนผ่านฟังก์ชัน security definer เท่านั้น

create or replace function public.import_tms_trip(p_tms_id uuid, p_driver_ids bigint[] default null::bigint[])
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_t public.tms_trips;
  v_vehicle bigint;
  v_driver bigint;
  v_trip public.trips;
  v_status trip_status;
  v_ostatus order_status;
  v_row record;
  v_order public.orders;
  v_created int := 0;
  v_nocust int := 0;
  v_linked int := 0;
  v_origin text;
  v_vtype text;
  v_names text[];
  v_unmapped text[];
  v_driver_ids bigint[];
  v_item record;
  v_prev_trips bigint[] := '{}';
  v_old public.trips;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  select * into v_t from public.tms_trips where tms_id = p_tms_id for update;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  if v_t.trip_id is not null then
    return json_build_object('trip_id', v_t.trip_id, 'created_orders', 0, 'already', true);
  end if;

  if v_t.status_id = 6 then
    raise exception 'เที่ยวนี้ถูกยกเลิกที่ TMS แล้ว' using errcode = 'P0001';
  end if;

  if lower(btrim(coalesce(v_t.status, ''))) not in
       ('ondelivery', 'on delivery', 'delivering',
        'delivered', 'complete', 'completed')
     and coalesce(v_t.status_id, 0) not between 4 and 5 then
    raise exception 'เที่ยวนี้ยังไม่ออกวิ่ง (On Delivery) ที่ TMS (สถานะตอนนี้: %)',
      coalesce(nullif(btrim(v_t.status), ''), 'ไม่ระบุ') using errcode = 'P0001';
  end if;

  v_names := app.tms_driver_names(v_t.driver_name);

  if coalesce(array_length(p_driver_ids, 1), 0) > 0 then
    v_driver_ids := p_driver_ids;

    if not exists (select 1 from public.drivers where id = any(v_driver_ids)) then
      raise exception 'ไม่พบพนักงานขับที่เลือก' using errcode = 'P0002';
    end if;

    if array_length(v_names, 1) = array_length(v_driver_ids, 1) then
      insert into public.tms_driver_map (driver_key, driver_id, mapped_by, mapped_at)
      select u.n, v_driver_ids[u.ord], app.current_user_id(), now()
        from unnest(v_names) with ordinality as u(n, ord)
      on conflict (driver_key) do update set
        driver_id = excluded.driver_id, ignored = false,
        mapped_by = excluded.mapped_by, mapped_at = now();
    end if;
  else
    if array_length(v_names, 1) is null then
      raise exception 'เที่ยวนี้ยังไม่มีชื่อพนักงานขับจาก TMS — เลือกคนขับเองก่อนสั่งงาน'
        using errcode = 'P0001';
    end if;

    select array_agg(n order by ord) into v_unmapped
      from unnest(v_names) with ordinality as u(n, ord)
      left join public.tms_driver_map dm
        on dm.driver_key = u.n and not dm.ignored and dm.driver_id is not null
     where dm.driver_key is null;

    if v_unmapped is not null then
      raise exception 'พนักงานขับ % ยังไม่จับคู่กับคนในระบบ',
        array_to_string(v_unmapped, ', ') using errcode = 'P0001';
    end if;

    select array_agg(dm.driver_id order by u.ord) into v_driver_ids
      from unnest(v_names) with ordinality as u(n, ord)
      join public.tms_driver_map dm
        on dm.driver_key = u.n and not dm.ignored and dm.driver_id is not null;
  end if;

  v_driver := v_driver_ids[1];

  select vehicle_id into v_vehicle
    from public.tms_vehicle_map
   where plate = v_t.license_plate and not ignored;

  if v_vehicle is null and coalesce(trim(v_t.license_plate), '') <> '' then
    select min(id) into v_vehicle
      from public.vehicles
     where app.plate_key(plate_no) = app.plate_key(v_t.license_plate);

    if v_vehicle is null then
      v_vtype := case
        when v_t.vehicle_type like '6W%' then 'truck6'
        when v_t.vehicle_type like '10W%' then 'truck10'
        else 'pickup'
      end;

      insert into public.vehicles (plate_no, vehicle_type)
      values (app.plate_key(v_t.license_plate), v_vtype::vehicle_type)
      returning id into v_vehicle;
    end if;

    insert into public.tms_vehicle_map (plate, vehicle_id, mapped_by, mapped_at)
    values (v_t.license_plate, v_vehicle, app.current_user_id(), now())
    on conflict (plate) do update
      set vehicle_id = coalesce(tms_vehicle_map.vehicle_id, excluded.vehicle_id),
          mapped_at = now();
  end if;

  if v_vehicle is null then
    raise exception 'เที่ยวนี้ไม่มีทะเบียนรถจาก TMS' using errcode = 'P0001';
  end if;

  v_origin := coalesce(
    (select nullif(btrim(value), '') from public.settings where key = 'org_name'),
    'คลังบริษัท'
  );

  v_status := 'planned'::trip_status;

  v_ostatus := case v_status
    when 'completed' then 'delivered'
    when 'in_progress' then 'in_transit'
    else 'assigned'
  end::order_status;

  insert into public.trips
    (vehicle_id, driver_id, status, departed_at, accepted_at, accepted_by,
     freight_cost, freight_actual_cost, notes)
  values
    (v_vehicle, v_driver, v_status,
     case when v_status <> 'planned' then v_t.on_delivery_date end,
     case when v_status = 'completed' then now() end,
     case when v_status = 'completed' then v_driver end,
     nullif(v_t.cost, 0),
     nullif(v_t.actual_cost, 0),
     'นำเข้าจาก TMS · เที่ยว ' || v_t.trip_no
     || coalesce(' · ' || v_t.warehouse_code, '')
     || coalesce(' · เขต ' || v_t.area, ''))
  returning * into v_trip;

  for v_row in
    select
      s.picking_list_no,
      max(s.order_id) as order_id,
      max(m.customer_id) filter (where not coalesce(m.ignored, false)) as customer_id,
      max(s.dealer_name) as dealer_name,
      max(coalesce(s.ship_to_name, s.branch)) as ship_to_name,
      max(coalesce(s.ship_to_address, s.customer_address)) as ship_to_address,
      max(coalesce(s.ship_to_province, s.province)) as province,
      max(coalesce(s.trip_date, s.plan_delivery_date)) as plan_date,
      max(coalesce(s.total_qty, s.unit)) as total_qty,
      max(s.trip_no_tms) as source_trip_no,
      string_agg(distinct coalesce(s.item_name, s.item_no), ', ') as goods
    from public.tms_shipments s
    left join public.tms_dealer_map m on m.dealer_code = s.dealer_code
   where s.tms_trip_id = p_tms_id
   group by s.picking_list_no
  loop
    if v_row.order_id is not null then
      /* จำเที่ยวเดิมของใบไว้ก่อนย้าย — ถ้าคนขับกำลังวิ่งเที่ยวนั้นอยู่ เที่ยวใหม่ต้องรับสถานะต่อ */
      v_prev_trips := v_prev_trips || array(
        select o.trip_id from public.orders o
         where o.id = v_row.order_id and o.trip_id is not null and o.trip_id <> v_trip.id
           and not (o.trip_id = any(v_prev_trips)));

      update public.orders
         set trip_id = v_trip.id,
             tms_trip_no = coalesce(v_row.source_trip_no, v_t.trip_no),
             tms_picking_list_no = v_row.picking_list_no,
             work_kind = case when coalesce(v_row.goods, '') ~* '^BOX(\s|$)' then 'box' else 'vehicle' end,
             tms_unit_count = coalesce(v_row.total_qty, 0),
             status = case when status in ('delivered', 'cancelled') then status else v_ostatus end,
             updated_at = now()
       where id = v_row.order_id;

      for v_item in
        select s.item_no,
               max(s.item_name) as item_name,
               sum(coalesce(nullif(s.item_split_qty, 0), nullif(s.item_qty, 0), 0)) as qty
          from public.tms_shipments s
         where s.tms_trip_id = p_tms_id
           and s.picking_list_no = v_row.picking_list_no
           and coalesce(btrim(s.item_no), '') <> ''
         group by s.item_no
      loop
        insert into public.order_items (order_id, item_no, item_name, qty)
        values (v_row.order_id, v_item.item_no, v_item.item_name, v_item.qty)
        on conflict (order_id, item_no) do update
          set qty = excluded.qty, item_name = excluded.item_name;
      end loop;

      v_linked := v_linked + 1;
      continue;
    end if;

    insert into public.orders
      (customer_id, origin, destination, goods_desc, weight_kg, fee, status,
       scheduled_at, trip_id, notes, tms_trip_no, tms_picking_list_no,
       work_kind, tms_unit_count)
    values
      (v_row.customer_id,
       v_origin,
       left(concat_ws(' · ',
         nullif(trim(coalesce(v_row.ship_to_name, v_row.dealer_name)), ''),
         nullif(trim(coalesce(v_row.ship_to_address, '') || coalesce(' จ.' || v_row.province, '')), '')
       ), 500),
       left(coalesce(v_row.goods, 'สินค้าตาม PL'), 500),
       0, 0, v_ostatus,
       coalesce(v_t.order_date, v_row.plan_date, current_date),
       v_trip.id,
       'นำเข้าจาก TMS · PL ' || v_row.picking_list_no
         || ' · เที่ยว ' || v_t.trip_no
         || ' · ' || coalesce(v_row.total_qty, 0) || ' หน่วย',
       coalesce(v_row.source_trip_no, v_t.trip_no),
       v_row.picking_list_no,
       case when coalesce(v_row.goods, '') ~* '^BOX(\s|$)' then 'box' else 'vehicle' end,
       coalesce(v_row.total_qty, 0))
    returning * into v_order;

    update public.tms_shipments
       set order_id = v_order.id
     where picking_list_no = v_row.picking_list_no and tms_trip_id = p_tms_id;

    for v_item in
      select s.item_no,
             max(s.item_name) as item_name,
             sum(coalesce(nullif(s.item_split_qty, 0), nullif(s.item_qty, 0), 0)) as qty
        from public.tms_shipments s
       where s.tms_trip_id = p_tms_id
         and s.picking_list_no = v_row.picking_list_no
         and coalesce(btrim(s.item_no), '') <> ''
       group by s.item_no
    loop
      insert into public.order_items (order_id, item_no, item_name, qty)
      values (v_order.id, v_item.item_no, v_item.item_name, v_item.qty)
      on conflict (order_id, item_no) do update
        set qty = excluded.qty, item_name = excluded.item_name;
    end loop;

    v_created := v_created + 1;
    if v_row.customer_id is null then
      v_nocust := v_nocust + 1;
    end if;
  end loop;

  insert into public.trip_drivers (trip_id, driver_id, seq)
  select v_trip.id, d.id, d.ord::smallint
    from unnest(v_driver_ids) with ordinality as d(id, ord)
  on conflict do nothing;

  /* TMS ยกเลิก/แตกเที่ยวแล้วออกเลขใหม่ ระหว่างที่คนขับวิ่งเที่ยวเดิมอยู่ (1 ต.ค. 2569:
     20261001001 → 002 + 003) — ใบถูกย้ายเข้าเที่ยวใหม่ที่ยัง "วางแผน" ไม่มีใครรับ
     แอปเลยหยุดส่ง GPS และเมื่อเที่ยวเดิมว่างแล้วถูกเก็บกวาด จุด GPS หายตาม (cascade)
     ให้เที่ยวใหม่รับต่อ: สถานะ/เวลารับงาน/คนที่รับ + ก๊อปจุด GPS + จำทางย้ายไว้ให้
     log_trip_location ส่งต่อ — เฉพาะเมื่อคนขับชุดเดิมอยู่ในเที่ยวใหม่ด้วย */
  if cardinality(v_prev_trips) > 0 then
    select t.* into v_old
      from public.trips t
     where t.id = any(v_prev_trips)
       and t.accepted_at is not null
       and t.status in ('planned', 'in_progress')
       and exists (select 1
                     from public.trip_drivers o
                     join public.trip_drivers n on n.driver_id = o.driver_id and n.trip_id = v_trip.id
                    where o.trip_id = t.id)
     order by t.accepted_at
     limit 1;

    if found then
      update public.trips
         set status = v_old.status,
             departed_at = v_old.departed_at,
             accepted_at = v_old.accepted_at,
             accepted_by = v_old.accepted_by
       where id = v_trip.id;
      v_status := v_old.status;

      update public.trip_drivers n
         set accepted_at = o.accepted_at
        from public.trip_drivers o
       where n.trip_id = v_trip.id and o.trip_id = v_old.id
         and o.driver_id = n.driver_id and n.accepted_at is null;

      /* เที่ยวเดิมแตกเป็นหลายเที่ยว = ทุกเที่ยวได้สำเนาเส้นทางครบ (เลือกแบบนี้กับเจ้าของงาน) */
      insert into public.trip_locations (trip_id, driver_id, lat, lng, accuracy_m, recorded_at)
      select v_trip.id, l.driver_id, l.lat, l.lng, l.accuracy_m, l.recorded_at
        from public.trip_locations l
       where l.trip_id = v_old.id;

      insert into public.trip_redirects (old_trip_id, new_trip_id)
      values (v_old.id, v_trip.id)
      on conflict do nothing;

      if v_old.status = 'in_progress' then
        update public.orders set status = 'in_transit', updated_at = now()
         where trip_id = v_trip.id and status = 'assigned';
      end if;
    end if;
  end if;

  if v_status <> 'completed' then
    update public.vehicles set status = 'on_trip' where id = v_vehicle;
    update public.drivers  set status = 'on_trip' where id = any(v_driver_ids);
  end if;

  update public.tms_trips set trip_id = v_trip.id where tms_id = p_tms_id;

  return json_build_object(
    'trip_id', v_trip.id,
    'trip_no', v_trip.trip_no,
    'status', v_status,
    'created_orders', v_created,
    'linked_orders', v_linked,
    'orders_without_customer', v_nocust,
    'already', false
  );
end;
$function$;

create or replace function public.log_trip_location(
  p_trip_id bigint, p_lat double precision, p_lng double precision,
  p_accuracy_m double precision default null::double precision)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_me    bigint := app.current_driver_id();
  v_trip  public.trips;
  v_found boolean;
  v_new   bigint;
  v_hit   int := 0;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  select * into v_trip from public.trips where id = p_trip_id;
  v_found := found;

  if v_found then
    if v_trip.driver_id is distinct from v_me
       and not exists (select 1 from public.trip_drivers td
                        where td.trip_id = p_trip_id and td.driver_id = v_me) then
      raise exception 'เที่ยวนี้ไม่ใช่งานของคุณ' using errcode = '42501';
    end if;

    /* บันทึกเฉพาะช่วงที่งานเดินอยู่จริง: รับงานแล้ว และยังไม่ปิด */
    if v_trip.accepted_at is not null and v_trip.status not in ('completed', 'cancelled') then
      insert into public.trip_locations (trip_id, driver_id, lat, lng, accuracy_m)
      values (p_trip_id, v_me, p_lat, p_lng, p_accuracy_m);
    end if;
  end if;

  /* เที่ยวที่ถูก TMS ออกเลขใหม่ — แอปยังถือเลขเดิมจนกว่าจะรีเฟรช ส่งต่อให้เที่ยวใหม่
     ด่านเดียวกับข้างบน: ต้องเป็นคนในเที่ยว รับงานแล้ว และยังไม่ปิด */
  for v_new in
    select r.new_trip_id from public.trip_redirects r where r.old_trip_id = p_trip_id
  loop
    insert into public.trip_locations (trip_id, driver_id, lat, lng, accuracy_m)
    select t.id, v_me, p_lat, p_lng, p_accuracy_m
      from public.trips t
     where t.id = v_new
       and t.accepted_at is not null
       and t.status not in ('completed', 'cancelled')
       and (t.driver_id = v_me
            or exists (select 1 from public.trip_drivers td
                        where td.trip_id = t.id and td.driver_id = v_me));
    v_hit := v_hit + 1;
  end loop;

  if not v_found and v_hit = 0 then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  if random() < 0.01 then
    perform app.purge_old_trip_locations();
  end if;
end;
$function$;
