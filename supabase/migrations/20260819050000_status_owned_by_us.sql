-- สถานะงานเป็นของระบบเรา ไม่ใช่กระจกสะท้อน TMS
--
-- ที่เจ้าของระบบสั่ง:
--  1) นำเข้าได้เฉพาะเที่ยวที่ TMS Confirm แล้ว
--  2) กดนำเข้าปุ๊บ เที่ยวเข้าสถานะของเราทันทีและส่งถึงคนขับ
--  3) คนขับออกรถ = กำลังขนส่ง, คนขับปิดงาน = เสร็จสิ้น
--  4) หลังจากนำเข้าแล้ว TMS เปลี่ยนสถานะยังไงก็ไม่ดันสถานะฝั่งเรา
--
-- ของเดิมผิดสองจุด: import_tms_trip แปลง status_id 5 เป็น completed ทันทีที่นำเข้า
-- และ sync_tms_trip_status เดินสถานะตาม TMS ทุกรอบที่ดึงข้อมูล เที่ยวจึงวิ่งเองได้
-- โดยคนขับไม่ต้องแตะ ซึ่งแปลว่าไม่มี POD ไม่มีเส้นทาง และเวลาที่บันทึกไม่ใช่ของจริง
--
-- ไม่แตะการยกเลิก: TMS ยกเลิกเที่ยว (status_id 6) ยังตัดงานฝั่งเราเหมือนเดิม
-- (20260818420000) เพราะปล่อยให้คนขับวิ่งของที่ถูกยกเลิกไปแล้วคือความเสียหายจริง
-- ไม่ใช่แค่สถานะไม่ตรง

create or replace function public.sync_tms_trip_status()
returns json
language plpgsql
security definer
set search_path = public
as $fn$
begin
  /* เก็บฟังก์ชันไว้เป็นตัวเปล่า — ตัวเรียกมีหลายที่ (sync_tms_trips, push_tms_shipments)
     ลบทิ้งแล้วต้องไล่แก้ทุกที่ในจังหวะเดียวกัน ซึ่งเสี่ยงกว่าเก็บไว้แล้วไม่ทำอะไร */
  return json_build_object('trips', 0, 'orders', 0, 'disabled', true);
end;
$fn$;

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

  /* ประตูนำเข้า: TMS ต้อง Confirm แล้วเท่านั้น
     เที่ยวที่ยังไม่ Confirm คือแผนที่ยังเปลี่ยนได้ ทั้งรถ คนขับ และรายการของ
     นำเข้าตอนนั้นเท่ากับสั่งงานคนขับด้วยข้อมูลที่ยังไม่นิ่ง */
  if lower(btrim(coalesce(v_t.status, ''))) <> 'confirm' then
    raise exception 'เที่ยวนี้ยังไม่ Confirm ที่ TMS (สถานะตอนนี้: %)',
      coalesce(nullif(btrim(v_t.status), ''), 'ไม่ระบุ') using errcode = 'P0001';
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

  /* สถานะฝั่งเราเริ่มที่ planned เสมอ ไม่รับค่ามาจาก TMS อีกต่อไป
     ตั้งแต่กดนำเข้าไปจนจบงาน เจ้าของสถานะคือ flow ของเรา:
     planned (เข้าระบบแล้ว ส่งถึงคนขับ) -> in_progress (คนขับกดออกรถ) -> completed (คนขับปิดงาน)
     ของเดิมเที่ยวที่ TMS ปิดไปแล้วจะถูกนำเข้าเป็น completed ทันที ข้ามหัวคนขับทั้งเส้น
     แล้วไม่เหลือทั้ง POD และเส้นทาง */
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
