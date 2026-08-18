-- นำเข้าเที่ยวแล้วบันทึกคนขับทุกคนลง trip_drivers
--
-- เดิมคนที่ไปด้วยถูกเขียนไว้ในข้อความหมายเหตุอย่างเดียว ซึ่งเอาไปใช้ต่อไม่ได้
-- ทั้งตอนปิดเที่ยว ตอนคนขับเปิดแอปดูงาน และตอนทำรายงานต่อคน

create or replace function public.import_tms_trip(p_tms_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
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
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง'
      using errcode = '42501';
  end if;

  select *
    into v_t
    from public.tms_trips
   where tms_id = p_tms_id
   for update;

  if not found then
    raise exception 'ไม่พบเที่ยวนี้'
      using errcode = 'P0002';
  end if;

  if v_t.trip_id is not null then
    return json_build_object(
      'trip_id', v_t.trip_id,
      'created_orders', 0,
      'already', true
    );
  end if;

  if v_t.status_id = 6 then
    raise exception 'เที่ยวนี้ถูกยกเลิกที่ TMS แล้ว'
      using errcode = 'P0001';
  end if;

  /* TMS ส่งชื่อคนขับมาเป็นข้อความก้อนเดียว เที่ยวที่ไปสองคนจะได้
     'เอกชัย บุญอินทร์ (เอก) , อณัฐ อาดัม (นัท)' และบางแถวมีคอมมาห้อยท้ายเฉย ๆ
     ถ้าเอาก้อนนี้ไปจับคู่ตรง ๆ จะได้พนักงานขับชื่อประหลาดหนึ่งคนแทนที่จะเป็นคนจริงสองคน
     แยกก่อนเสมอ แล้วบังคับให้จับคู่ครบทุกชื่อ — ตกไปคนหนึ่งคือมีคนวิ่งงานโดยระบบไม่รู้จัก */
  v_names := app.tms_driver_names(v_t.driver_name);

  if array_length(v_names, 1) is null then
    raise exception 'เที่ยวนี้ยังไม่มีชื่อพนักงานขับจาก TMS'
      using errcode = 'P0001';
  end if;

  select array_agg(n order by ord)
    into v_unmapped
    from unnest(v_names) with ordinality as u(n, ord)
    left join public.tms_driver_map dm
      on dm.driver_key = u.n and not dm.ignored and dm.driver_id is not null
   where dm.driver_key is null;

  if v_unmapped is not null then
    raise exception 'พนักงานขับ % ยังไม่จับคู่กับคนในระบบ',
      array_to_string(v_unmapped, ', ')
      using errcode = 'P0001';
  end if;

  select array_agg(dm.driver_id order by u.ord)
    into v_driver_ids
    from unnest(v_names) with ordinality as u(n, ord)
    join public.tms_driver_map dm
      on dm.driver_key = u.n and not dm.ignored and dm.driver_id is not null;

  /* คนแรกในรายการคือคนขับหลักของเที่ยว trips เก็บคนขับได้คนเดียว
     คนที่เหลือไปอยู่ในหมายเหตุ จะได้ไม่หายไปจากหลักฐานว่าใครไปด้วย */
  v_driver := v_driver_ids[1];

  select vehicle_id
    into v_vehicle
    from public.tms_vehicle_map
   where plate = v_t.license_plate
     and not ignored;

  if v_vehicle is null
     and coalesce(trim(v_t.license_plate), '') <> '' then

    select id
      into v_vehicle
      from public.vehicles
     where plate_no = trim(v_t.license_plate);

    if v_vehicle is null then
      v_vtype := case
        when v_t.vehicle_type like '6W%' then 'truck6'
        when v_t.vehicle_type like '10W%' then 'truck10'
        else 'pickup'
      end;

      insert into public.vehicles (plate_no, vehicle_type)
      values (trim(v_t.license_plate), v_vtype::vehicle_type)
      returning id into v_vehicle;
    end if;

    insert into public.tms_vehicle_map
      (plate, vehicle_id, mapped_by, mapped_at)
    values
      (v_t.license_plate, v_vehicle, app.current_user_id(), now())
    on conflict (plate) do update
      set vehicle_id = coalesce(
            tms_vehicle_map.vehicle_id,
            excluded.vehicle_id
          ),
          mapped_at = now();
  end if;

  if v_vehicle is null then
    raise exception 'เที่ยวนี้ไม่มีทะเบียนรถจาก TMS'
      using errcode = 'P0001';
  end if;

  /* ไม่มีแถว org_name ใน settings = select ไม่คืนแถวเลย v_origin จึงค้างเป็น null
     แล้วไปตายที่ not-null ของ orders.origin ตอนสร้างออเดอร์ใบแรก
     coalesce ตัวเดิมกันได้แค่กรณี "มีแถวแต่ค่าว่าง" ซึ่งไม่ใช่กรณีที่เกิดจริง */
  v_origin := coalesce(
    (select nullif(btrim(value), '') from public.settings where key = 'org_name'),
    'คลังบริษัท'
  );

  v_status := case v_t.status_id
    when 2 then 'planned'
    when 3 then 'in_progress'
    when 4 then 'in_progress'
    when 5 then 'completed'
    else 'planned'
  end::trip_status;

  v_ostatus := case v_status
    when 'completed' then 'delivered'
    when 'in_progress' then 'in_transit'
    else 'assigned'
  end::order_status;

  insert into public.trips
    (vehicle_id, driver_id, status, departed_at,
     freight_cost, freight_actual_cost, notes)
  values
    (
      v_vehicle,
      v_driver,
      v_status,
      case
        when v_status <> 'planned'
        then v_t.on_delivery_date
      end,
      /* 0 ของ TMS แปลว่า "ยังไม่ลงตัวเลข" ไม่ใช่ "ฟรี" — เก็บเป็น null
         เพื่อให้ยอดรวมในรายงานไม่ถูกดึงลงด้วยเที่ยวที่ยังไม่ปิดยอด */
      nullif(v_t.cost, 0),
      nullif(v_t.actual_cost, 0),
      'นำเข้าจาก TMS · เที่ยว ' || v_t.trip_no
      || coalesce(' · ' || v_t.warehouse_code, '')
      || coalesce(' · เขต ' || v_t.area, '')
      || case
           when array_length(v_names, 1) > 1
           then ' · ไปด้วยกัน ' || array_to_string(v_names[2:], ', ')
           else ''
         end
    )
  returning * into v_trip;

  for v_row in
    select
      s.picking_list_no,
      max(s.order_id) as order_id,
      max(m.customer_id)
        filter (where not coalesce(m.ignored, false))
        as customer_id,
      max(s.dealer_name) as dealer_name,
      max(s.dealer_code) as dealer_code,
      max(coalesce(s.ship_to_name, s.branch)) as ship_to_name,
      max(coalesce(s.ship_to_address, s.customer_address))
        as ship_to_address,
      max(coalesce(s.ship_to_province, s.province)) as province,
      max(coalesce(s.plan_delivery_date, s.trip_date))
        as plan_date,
      max(coalesce(s.total_qty, s.unit)) as total_qty,
      max(s.trip_no_tms) as source_trip_no,
      string_agg(
        distinct coalesce(s.item_name, s.item_no),
        ', '
      ) as goods
    from public.tms_shipments s
    left join public.tms_dealer_map m
      on m.dealer_code = s.dealer_code
   where s.tms_trip_id = p_tms_id
   group by s.picking_list_no
  loop

    if v_row.order_id is not null then
      update public.orders
         set trip_id = v_trip.id,
             tms_trip_no = coalesce(
               v_row.source_trip_no,
               v_t.trip_no
             ),
             tms_picking_list_no = v_row.picking_list_no,
             work_kind = case
               when coalesce(v_row.goods, '') ~* '^BOX(\s|$)'
               then 'box'
               else 'vehicle'
             end,
             tms_unit_count = coalesce(v_row.total_qty, 0),
             status = case
               when status in ('delivered', 'cancelled')
               then status
               else v_ostatus
             end,
             updated_at = now()
       where id = v_row.order_id;

    /* รายการของในใบ — เก็บเป็นแถวจริง ไม่ใช่ข้อความรวมใน goods_desc
       รหัสสินค้าคือตัวที่คลังกับร้านใช้อ้างอิง และเป็นฐานของการเช็คว่าส่งครบ
       ใบเดียวกันมีรหัสซ้ำได้เมื่อของถูกแยกล็อต จึงรวมยอดก่อนแล้วค่อยลง */
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
      (
        customer_id,
        origin,
        destination,
        goods_desc,
        weight_kg,
        fee,
        status,
        scheduled_at,
        trip_id,
        notes,
        tms_trip_no,
        tms_picking_list_no,
        work_kind,
        tms_unit_count
      )
    values
      (
        v_row.customer_id,
        v_origin,
        left(
          concat_ws(
            ' · ',
            nullif(
              trim(coalesce(
                v_row.ship_to_name,
                v_row.dealer_name
              )),
              ''
            ),
            nullif(
              trim(
                coalesce(v_row.ship_to_address, '')
                || coalesce(' จ.' || v_row.province, '')
              ),
              ''
            )
          ),
          500
        ),
        left(
          coalesce(v_row.goods, 'สินค้าตาม PL'),
          500
        ),
        0,
        0,
        v_ostatus,
        coalesce(
          v_row.plan_date,
          v_t.order_date,
          current_date
        ),
        v_trip.id,
        'นำเข้าจาก TMS · PL '
        || v_row.picking_list_no
        || ' · เที่ยว '
        || v_t.trip_no
        || ' · '
        || coalesce(v_row.total_qty, 0)
        || ' หน่วย',
        coalesce(v_row.source_trip_no, v_t.trip_no),
        v_row.picking_list_no,
        case
          when coalesce(v_row.goods, '') ~* '^BOX(\s|$)'
          then 'box'
          else 'vehicle'
        end,
        coalesce(v_row.total_qty, 0)
      )
    returning * into v_order;

    update public.tms_shipments
       set order_id = v_order.id
     where picking_list_no = v_row.picking_list_no
       and tms_trip_id = p_tms_id;

    /* รายการของในใบ — เก็บเป็นแถวจริง ไม่ใช่ข้อความรวมใน goods_desc
       รหัสสินค้าคือตัวที่คลังกับร้านใช้อ้างอิง และเป็นฐานของการเช็คว่าส่งครบ
       ใบเดียวกันมีรหัสซ้ำได้เมื่อของถูกแยกล็อต จึงรวมยอดก่อนแล้วค่อยลง */
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

  /* คนขับทุกคนของเที่ยว ไม่ใช่แค่คนแรก — trips.driver_id เก็บได้คนเดียว
     คนที่เหลือเคยอยู่แค่ในข้อความหมายเหตุ ซึ่งไม่มีใครเอาไปใช้ต่อได้ */
  insert into public.trip_drivers (trip_id, driver_id, seq)
  select v_trip.id, d.id, d.ord::smallint
    from unnest(v_driver_ids) with ordinality as d(id, ord)
  on conflict do nothing;

  if v_status <> 'completed' then
    update public.vehicles
       set status = 'on_trip'
     where id = v_vehicle;

    update public.drivers
       set status = 'on_trip'
     where id = any(v_driver_ids);
  end if;

  update public.tms_trips
     set trip_id = v_trip.id
   where tms_id = p_tms_id;

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
$fn$;

-- เที่ยวที่สร้างจากหน้าแผนงาน (create_trip) ไม่ได้ผ่าน import_tms_trip
-- ผูกด้วย trigger แทนการไล่แก้ทุกฟังก์ชันที่ insert ลง trips
-- คนขับหลักจะมีแถวใน trip_drivers เสมอ ไม่ว่าเที่ยวจะเกิดจากทางไหน
create or replace function app.sync_primary_trip_driver()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.driver_id is not null then
    insert into public.trip_drivers (trip_id, driver_id, seq)
    values (new.id, new.driver_id, 1)
    on conflict (trip_id, driver_id) do nothing;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trips_sync_primary_driver on public.trips;
create trigger trips_sync_primary_driver
  after insert or update of driver_id on public.trips
  for each row execute function app.sync_primary_trip_driver();
