-- คนวางแผนเป็นคนชี้ว่าเที่ยวนี้ใครขับ และคนขับคนที่สองต้องเห็นงานด้วย
--
-- สามเรื่องในไฟล์เดียว เพราะทั้งสามอยู่บนเส้นเดียวกัน: ใครเป็นเจ้าของเที่ยว
--
-- 1) import_tms_trip รับรายชื่อคนขับจากคนกดได้ ไม่ต้องพึ่งการเดาจากชื่อใน TMS อย่างเดียว
--    ชื่อใน TMS พิมพ์อิสระ การจับคู่อัตโนมัติจึงผิดคนได้เสมอ ตอนนี้คนวางแผนเลือกเอง
--    แล้วคำตอบถูกจำไว้ใน tms_driver_map ให้รอบต่อไปไม่ต้องเลือกซ้ำ
--
-- 2) คนขับคนที่สองมองไม่เห็นใบส่งของ — my_orders กรองด้วย t.driver_id เท่านั้น
--    ทั้งที่ my_trips นับ trip_drivers ด้วย ผลคือคนที่ไปด้วยเปิดแอปแล้วเห็นเที่ยวเปล่า ๆ
--    ไม่มีจุดส่งสักจุด ปิดงานก็ไม่ได้ เก็บ POD ก็ไม่ได้
--
-- 3) ลำดับการแวะเป็นของคนขับ เขารู้สภาพถนนจริง ระบบไม่ควรบังคับลำดับ

/* ---------- 1) นำเข้าเที่ยวโดยระบุคนขับเองได้ ---------- */

-- ต้อง drop ก่อน เพราะเพิ่มพารามิเตอร์ที่มีค่า default ให้ฟังก์ชันเดิม
-- จะทำให้เรียกด้วยอาร์กิวเมนต์เดียวแล้วกำกวมระหว่างสองตัว
drop function if exists public.import_tms_trip(uuid);

create or replace function public.import_tms_trip(
  p_tms_id uuid,
  p_driver_ids bigint[] default null
)
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

  v_names := app.tms_driver_names(v_t.driver_name);

  if coalesce(array_length(p_driver_ids, 1), 0) > 0 then
    /* คนวางแผนชี้มาเอง ใช้ตามนั้น ไม่ต้องผ่านด่านจับคู่ชื่อ
       เที่ยวที่ TMS ยังไม่ใส่ชื่อคนขับก็สั่งงานได้ ซึ่งเดิมทำไม่ได้เลย */
    v_driver_ids := p_driver_ids;

    if not exists (select 1 from public.drivers where id = any(v_driver_ids)) then
      raise exception 'ไม่พบพนักงานขับที่เลือก' using errcode = 'P0002';
    end if;

    /* จำคำตอบไว้ ถ้าจำนวนชื่อกับจำนวนคนตรงกัน — รอบหน้าชื่อเดิมจะรู้จักเอง
       ไม่ตรงกันก็ไม่จำ ดีกว่าจำผิดคนแล้วผิดต่อไปทุกรอบ */
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

  v_status := case v_t.status_id when 5 then 'completed' else 'planned' end::trip_status;

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
      max(coalesce(s.plan_delivery_date, s.trip_date)) as plan_date,
      max(coalesce(s.total_qty, s.unit)) as total_qty,
      max(s.trip_no_tms) as source_trip_no,
      string_agg(distinct coalesce(s.item_name, s.item_no), ', ') as goods
    from public.tms_shipments s
    left join public.tms_dealer_map m on m.dealer_code = s.dealer_code
   where s.tms_trip_id = p_tms_id
   group by s.picking_list_no
  loop
    if v_row.order_id is not null then
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
               sum(coalesce(s.item_split_qty, s.item_qty, 0)) as qty
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
       coalesce(v_row.plan_date, v_t.order_date, current_date),
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
             sum(coalesce(s.item_split_qty, s.item_qty, 0)) as qty
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

/* ---------- 2) คนขับคนที่สองต้องเห็นใบส่งของด้วย ---------- */

-- ต้อง drop ก่อน: create or replace view เพิ่มคอลัมน์กลางลำดับไม่ได้
-- ("cannot change name of view column") และคอลัมน์ใหม่ต้องอยู่ติดกับของเดิมให้อ่านง่าย
drop view if exists public.my_orders;

create or replace view public.my_orders as
  select o.id,
         o.order_no,
         o.trip_id,
         o.status,
         o.priority,
         o.origin,
         o.destination,
         o.distance_km,
         o.goods_desc,
         o.weight_kg,
         o.scheduled_at,
         o.delivered_at,
         o.notes,
         /* เลขเที่ยวกับเลข PL คือสิ่งที่คนขับใช้คุยกับคลังและร้าน ต้องอยู่บนหน้าจอเขา */
         o.tms_trip_no,
         o.tms_picking_list_no,
         o.tms_unit_count,
         o.work_kind,
         o.seq,
         c.name as customer_name,
         c.phone as customer_phone,
         c.address as customer_address,
         (exists (select 1 from public.pod p where p.order_id = o.id)) as has_pod
    from public.orders o
    join public.trips t on t.id = o.trip_id
    left join public.customers c on c.id = o.customer_id
   where app.has_perm('myjobs.view'::text)
     and (t.driver_id = app.current_driver_id()
          or exists (select 1 from public.trip_drivers td
                      where td.trip_id = t.id
                        and td.driver_id = app.current_driver_id()));

/* ปิดงานทีละจุด เก็บ POD และออกรถ ต้องทำได้ทั้งคนขับหลักและคนที่ไปด้วย
   เดิมกรอง t.driver_id ตัวเดียว คนที่สองจึงกดอะไรไม่ได้เลยทั้งที่ไปด้วยจริง */
create or replace function public.deliver_order(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
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
     and (t.driver_id = app.current_driver_id()
          or exists (select 1 from public.trip_drivers td
                      where td.trip_id = t.id
                        and td.driver_id = app.current_driver_id()))
     and o.status not in ('delivered', 'cancelled');

  if not found then
    raise exception 'ไม่พบออเดอร์นี้ในเที่ยวของคุณ หรือปิดไปแล้ว' using errcode = 'P0002';
  end if;
end;
$function$;

create or replace function public.start_trip(p_trip_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  update public.trips t
     set status = 'in_progress',
         departed_at = coalesce(t.departed_at, now())
   where t.id = p_trip_id
     and t.status = 'planned'
     and (t.driver_id = app.current_driver_id()
          or exists (select 1 from public.trip_drivers td
                      where td.trip_id = t.id
                        and td.driver_id = app.current_driver_id()));

  if not found then
    raise exception 'ไม่พบเที่ยวนี้ หรือไม่ใช่เที่ยวของคุณ' using errcode = 'P0002';
  end if;

  update public.orders set status = 'in_transit', updated_at = now()
   where trip_id = p_trip_id and status = 'assigned';
end;
$function$;

create or replace function public.save_pod(
  p_order_id bigint,
  p_recipient_name text,
  p_signature_data text,
  p_photo_path text default null::text,
  p_notes text default null::text,
  p_lat double precision default null::double precision,
  p_lng double precision default null::double precision
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_id bigint;
begin
  if not app.has_perm('myjobs.pod') and not app.has_perm('pod.write') then
    raise exception 'ไม่มีสิทธิ์เก็บหลักฐานการส่งมอบ' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.orders o
      join public.trips t on t.id = o.trip_id
     where o.id = p_order_id
       and o.status = 'delivered'
       and (t.driver_id = app.current_driver_id()
            or exists (select 1 from public.trip_drivers td
                        where td.trip_id = t.id
                          and td.driver_id = app.current_driver_id())
            or app.has_perm('pod.write'))
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
   where public.pod.status = 'collected'
  returning id into v_id;

  if v_id is null then
    raise exception 'หลักฐานใบนี้ถูกยืนยันแล้ว แก้ไขไม่ได้' using errcode = 'P0001';
  end if;

  return v_id;
end;
$function$;

create or replace function app.owns_order_photo(object_name text)
returns boolean
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  select exists (
    select 1
      from public.orders o
      join public.trips t on t.id = o.trip_id
     where o.id = nullif(split_part(object_name, '/', 1), '')::bigint
       and (t.driver_id = app.current_driver_id()
            or exists (select 1 from public.trip_drivers td
                        where td.trip_id = t.id
                          and td.driver_id = app.current_driver_id()))
  )
$function$;

/* ---------- 3) ลำดับการแวะเป็นของคนขับ ---------- */

create or replace function public.set_stop_order(p_trip_id bigint, p_order_ids bigint[])
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_mine boolean;
begin
  if not app.has_perm('myjobs.progress') and not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดลำดับงาน' using errcode = '42501';
  end if;

  select (t.driver_id = app.current_driver_id()
          or exists (select 1 from public.trip_drivers td
                      where td.trip_id = t.id
                        and td.driver_id = app.current_driver_id())
          or app.has_perm('dispatch.write'))
    into v_mine
    from public.trips t
   where t.id = p_trip_id;

  if not coalesce(v_mine, false) then
    raise exception 'เที่ยวนี้ไม่ใช่งานของคุณ' using errcode = '42501';
  end if;

  update public.orders o
     set seq = u.ord::smallint, updated_at = now()
    from unnest(p_order_ids) with ordinality as u(id, ord)
   where o.id = u.id and o.trip_id = p_trip_id;
end;
$function$;

grant execute on function public.set_stop_order(bigint, bigint[]) to authenticated;
