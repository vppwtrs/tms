-- ชื่อพนักงานขับจาก TMS มาเป็นข้อความก้อนเดียว เที่ยวที่ไปสองคนได้
-- 'เอกชัย บุญอินทร์ (เอก) , อณัฐ อาดัม (นัท)' และบางแถวมีคอมมาห้อยท้าย
-- การจับคู่เดิมใช้ข้อความทั้งก้อนเป็นกุญแจ กดจับคู่แล้วจึงได้พนักงานขับหนึ่งคน
-- ที่ชื่อเป็นรายชื่อสองคนติดกัน แทนที่จะเป็นคนจริงสองคน

create or replace function app.tms_driver_names(p_raw text)
returns text[]
language sql
immutable
as $fn$
  select coalesce(array_agg(n order by ord), '{}')
    from unnest(string_to_array(coalesce(p_raw, ''), ',')) with ordinality as t(part, ord)
    cross join lateral (select btrim(t.part)) as c(n)
   where c.n <> '';
$fn$;

comment on function app.tms_driver_names(text) is
  'แยกชื่อคนขับที่ TMS ส่งมาเป็นก้อนเดียวออกเป็นรายชื่อ ตัดช่องว่างและรายการว่างทิ้ง';

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

  select coalesce(value, 'คลังบริษัท')
    into v_origin
    from public.settings
   where key = 'org_name';

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
    (vehicle_id, driver_id, status, departed_at, notes)
  values
    (
      v_vehicle,
      v_driver,
      v_status,
      case
        when v_status <> 'planned'
        then v_t.on_delivery_date
      end,
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

    v_created := v_created + 1;

    if v_row.customer_id is null then
      v_nocust := v_nocust + 1;
    end if;
  end loop;

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

create or replace function public.preview_tms_trips(p_date date default null)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_date date;
  v_out  json;
begin
  if not app.has_perm('dispatch.view') then
    raise exception 'ไม่มีสิทธิ์ดูแผนงาน' using errcode = '42501';
  end if;

  /* วันเริ่มต้นของหน้า = วันล่าสุดที่ยังมีเที่ยว "พร้อมนำเข้า" ไม่ใช่วันล่าสุดที่มีข้อมูล
     เที่ยวที่ TMS เพิ่งเปิด (สถานะ Confirm) ยังไม่จ่ายคนขับ กดนำเข้าไม่ได้อยู่ดี
     ถ้าเปิดหน้ามาเจอแต่ของแบบนั้น คนวางแผนจะเห็นแต่ปุ่มเทาแล้วนึกว่าระบบพัง
     ทั้งที่ของที่ทำได้จริงอยู่ในวันก่อนหน้า */
  if p_date is not null then
    v_date := p_date;
  else
    select max(t.order_date) into v_date
      from public.tms_trips t
     where t.trip_id is null
       and t.status_id is distinct from 6
       /* มีชื่อคนขับมาแล้วคือเงื่อนไขเดียวที่ต้องดู ไม่ใช่ต้องจับคู่เสร็จก่อน —
          เที่ยวที่ชื่อยังไม่รู้จักก็กดจับคู่ได้ในหน้านั้นเลย ถือว่าเป็นงานที่ทำได้
          ส่วนเที่ยวที่ TMS ยังไม่จ่ายคนขับ ไม่มีอะไรให้ทำ ไม่ควรเป็นวันเริ่มต้น */
       and app.tms_driver_names(t.driver_name) <> '{}';

    /* ไม่มีเที่ยวที่พร้อมเลย ก็กลับไปใช้วันล่าสุดที่มีข้อมูลตามเดิม
       หน้าเปล่ากับหน้าที่ยังไม่มีใครดึงข้อมูล ต้องแยกออกจากกันให้ได้ */
    if v_date is null then
      select max(order_date) into v_date from public.tms_trips;
    end if;
  end if;

  select json_build_object(
    'date', v_date,
    'latest_date', (select max(order_date) from public.tms_trips),
    'trips', coalesce((
      select json_agg(x order by x.trip_no)
        from (
          select t.tms_id, t.trip_no, t.status, t.status_id, t.reason,
                 t.license_plate, t.driver_name, t.area, t.vehicle_type,
                 t.total_pl, t.total_unit, t.warehouse_code,
                 t.trip_id is not null as imported,
                 t.trip_id,
                 dm.driver_id,
                 /* ชื่อที่ยังไม่รู้จักของ **เที่ยวนี้** เพื่อให้ปุ่มจับคู่อยู่ในแถวที่มันเกี่ยวข้อง
                    ไม่ใช่กองรวมอยู่ด้านบนแล้วให้คนเดาเองว่าชื่อไหนของเที่ยวไหน */
                 coalesce((
                   select array_agg(u.n order by u.ord)
                     from unnest(app.tms_driver_names(t.driver_name)) with ordinality as u(n, ord)
                     left join public.tms_driver_map m
                       on m.driver_key = u.n and not m.ignored and m.driver_id is not null
                    where m.driver_key is null
                 ), '{}') as unmapped_driver_names,
                 /* ใบที่ยังไม่รู้ว่าเป็นลูกค้ารายไหน — **ไม่กันการนำเข้า**
                    เที่ยวไปทั้งก้อน ใบพวกนี้เข้าเป็นออเดอร์ที่ยังไม่ผูกลูกค้า */
                 (select count(distinct s.picking_list_no)
                    from public.tms_shipments s
                    left join public.tms_dealer_map m on m.dealer_code = s.dealer_code
                   where s.tms_trip_id = t.tms_id
                     and (m.customer_id is null or m.ignored)) as unmapped_pls,
                 (select count(distinct s.picking_list_no)
                    from public.tms_shipments s
                   where s.tms_trip_id = t.tms_id) as pls_in_db
            from public.tms_trips t
            /* จับคู่ทีละชื่อ ไม่ใช่ทั้งก้อน — คนขับหลักคือชื่อแรกที่จับคู่แล้ว */
            left join lateral (
              select dm.driver_id
                from unnest(app.tms_driver_names(t.driver_name)) with ordinality as u(n, ord)
                join public.tms_driver_map dm
                  on dm.driver_key = u.n and not dm.ignored and dm.driver_id is not null
               order by u.ord
               limit 1
            ) dm on true
           where t.order_date = v_date
        ) x
    ), '[]'::json),
    /* เหลือค้างอย่างเดียวที่คนต้องทำก่อนนำเข้าได้ */
    'unmapped_drivers', coalesce((
      select json_agg(distinct u.n)
        from public.tms_trips t
        cross join unnest(app.tms_driver_names(t.driver_name)) as u(n)
        left join public.tms_driver_map dm on dm.driver_key = u.n
       where t.order_date = v_date
         and (dm.driver_key is null or (dm.driver_id is null and not dm.ignored))
    ), '[]'::json),
    /* ออเดอร์ที่นำเข้าแล้วแต่ยังไม่ผูกลูกค้า — เติมได้ด้วยการจับคู่ร้านแล้วกดเติมย้อนหลัง */
    'orders_without_customer', (
      select count(*)::int from public.orders o
       join public.trips tr on tr.id = o.trip_id
       join public.tms_trips t on t.trip_id = tr.id
      where o.customer_id is null),
    'cancelled_after_import', coalesce((
      select json_agg(json_build_object('trip_no', t.trip_no, 'reason', t.reason,
                                        'our_trip_id', t.trip_id))
        from public.tms_trips t
       where t.status_id = 6 and t.trip_id is not null
    ), '[]'::json)
  ) into v_out;

  return v_out;
end;
$fn$;
