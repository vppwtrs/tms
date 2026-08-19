-- จำนวนสินค้าเป็น 0 ทั้งที่ TMS มีจำนวนอยู่
--
-- อาการ: หน้าออเดอร์ขึ้นรายการของครบทุกบรรทัด ชื่อรุ่นถูกหมด แต่จำนวนเป็น ×0 ทุกตัว
-- ขณะที่หน้า View Picking List ของ TMS ใบเดียวกันแสดง Qty = 1
--
-- สาเหตุ: ใบที่ไม่ได้แตกกล่อง TMS ส่ง splitQty = 0 มาพร้อม qty ที่ถูกต้อง
-- ทั้งฝั่งเว็บและฝั่งฐานอ่าน 0 เป็น "ค่าที่ใช้ได้" แล้วฐานหยิบ split ก่อนเสมอ
-- (`coalesce(item_split_qty, item_qty, 0)`) จำนวนจึงกลายเป็น 0 ทั้งใบ
--
-- แก้: 0 ในช่องจำนวนแปลว่า "ใบนี้ไม่ได้ใช้ช่องนี้" ไม่ใช่จำนวนศูนย์
-- ฝั่งเว็บไม่บันทึก 0 ลงคอลัมน์จำนวนแล้ว และฝั่งฐานข้าม 0 ไปหาช่องถัดไป

/* ซ่อมของที่นำเข้าไปแล้ว — คำนวณจำนวนใหม่จากใบดิบด้วยกติกาที่แก้แล้ว
   ใบดิบยังมีจำนวนที่ถูกต้องอยู่ในคอลัมน์ item_qty การดึงใหม่จึงไม่จำเป็น */
create or replace function public.refresh_order_item_qty()
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fixed int := 0;
begin
  if not app.has_perm('orders.write') then
    raise exception 'ไม่มีสิทธิ์แก้ไขออเดอร์' using errcode = '42501';
  end if;

  with src as (
    select o.id as order_id,
           s.item_no,
           sum(coalesce(nullif(s.item_split_qty, 0), nullif(s.item_qty, 0), 0)) as qty
      from public.orders o
      join public.tms_shipments s
        on s.picking_list_no = o.tms_picking_list_no
       and s.order_id = o.id
     where coalesce(btrim(s.item_no), '') <> ''
     group by o.id, s.item_no
  )
  update public.order_items oi
     set qty = src.qty
    from src
   where oi.order_id = src.order_id
     and oi.item_no = src.item_no
     and oi.qty is distinct from src.qty;
  get diagnostics v_fixed = row_count;

  return json_build_object('fixed', v_fixed);
end;
$fn$;

grant execute on function public.refresh_order_item_qty() to authenticated;

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

  /* ประตูนำเข้า: TMS ต้องยืนยันแผนแล้ว = Confirm หรือสถานะที่เดินหน้าไปจากนั้น
     เที่ยวที่ยังไม่ Confirm คือแผนที่ยังเปลี่ยนได้ ทั้งรถ คนขับ และรายการของ
     นำเข้าตอนนั้นเท่ากับสั่งงานคนขับด้วยข้อมูลที่ยังไม่นิ่ง

     ห้ามเทียบเท่ากับ 'confirm' ตรง ๆ: TMS เดินสถานะต่อเป็น OnDelivery แล้ว Completed
     เที่ยวที่ยืนยันแผนไปแล้วและเริ่มวิ่งจึงถูกปฏิเสธตลอดกาล ทั้งที่ผ่านด่านนี้มานานแล้ว
     ผลคือยิ่งมาสั่งงานช้ายิ่งสั่งไม่ได้ ซึ่งตรงข้ามกับที่ตั้งใจ */
  if lower(btrim(coalesce(v_t.status, ''))) not in
       ('confirm', 'confirmed', 'ondelivery', 'on delivery', 'delivering',
        'delivered', 'complete', 'completed')
     and coalesce(v_t.status_id, 0) <> 5 then
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
               /* 0 คือ "ใบนี้ไม่ได้ใช้ช่องนี้" ไม่ใช่ "จำนวนศูนย์" — ใบที่ไม่ได้แตกกล่อง
                TMS ส่ง split เป็น 0 มาพร้อมจำนวนจริงในอีกช่อง หยิบ split ก่อนแบบไม่กรอง 0
                จึงได้ 0 ทั้งใบ ซึ่งคือบั๊กที่หน้าจอขึ้น "×0" ทั้งที่ TMS มีจำนวนอยู่ */
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
             /* 0 คือ "ใบนี้ไม่ได้ใช้ช่องนี้" ไม่ใช่ "จำนวนศูนย์" — ใบที่ไม่ได้แตกกล่อง
                TMS ส่ง split เป็น 0 มาพร้อมจำนวนจริงในอีกช่อง หยิบ split ก่อนแบบไม่กรอง 0
                จึงได้ 0 ทั้งใบ ซึ่งคือบั๊กที่หน้าจอขึ้น "×0" ทั้งที่ TMS มีจำนวนอยู่ */
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
