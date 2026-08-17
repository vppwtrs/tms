/* 0014 — เที่ยวไปทั้งก้อน · รถไม่ล็อกกับคน · สถานะไหลตาม TMS
 *
 * แก้ความเข้าใจผิดสามข้อที่ 0013 ทำไว้ผิด เจ้าของงานชี้มาเอง:
 *
 * 1. **หน่วยที่ส่งให้คนขับคือ "เที่ยว" ทั้งก้อน** ไม่ใช่ออเดอร์ที่เลือกมาบางใบ
 *    ของเดิมข้ามใบที่ร้านยังไม่จับคู่ ผลคือคนขับได้เที่ยวที่ขาดจุดส่งไปเงียบ ๆ
 *    ซึ่งแย่กว่าไม่มีข้อมูลลูกค้า — เขาขับไปถึงหน้าร้านแล้วในระบบไม่มีงานนั้น
 *    ตอนนี้สร้างออเดอร์ **ทุกใบในเที่ยว** ใบที่ร้านยังไม่จับคู่ก็ยังเป็นออเดอร์
 *    แค่ `customer_id` เป็น null (คอลัมน์นี้ยอม null มาตั้งแต่ 0001)
 *    ชื่อร้านกับที่อยู่ยังอยู่ในช่อง destination คนขับจึงไปถูกที่ตั้งแต่วันแรก
 *
 * 2. **รถล็อกกับคนไม่ได้** กองรถมีแต่ 4W 5 คัน คนขับคนเดิมไม่ได้ใช้คันเดิมทุกวัน
 *    การจับคู่ที่ถูกคือ ทะเบียน -> คัน (ข้อเท็จจริง) และ ชื่อคนขับ -> คน (ต้องมีคนยืนยัน)
 *    ห้ามมีที่ไหนในระบบผูก "คนขับคนนี้คู่กับรถคันนี้"
 *    และทะเบียนไม่ใช่เรื่องต้องให้คนตัดสิน — TMS บอกมาแล้วว่าเที่ยวนี้ใช้คันไหน
 *    จึงสร้างรถให้เองถ้ายังไม่มี ไม่บล็อกการนำเข้าเพราะเรื่องทะเบียนอีก
 *    (ชื่อคนขับยังบล็อก เพราะต้องผูกกับบัญชีผู้ใช้จริงถึงจะเห็นงานตัวเอง — RLS แขวนอยู่กับ drivers.user_id)
 *
 * 3. **สถานะที่เปลี่ยนต้องไหลถึงคนขับ** เที่ยวที่นำเข้าแล้วต้องขยับตาม TMS เอง
 *    ไม่ใช่ค้างที่ planned ตลอดกาลจนกว่าจะมีคนกดในระบบเราซ้ำอีกรอบ
 *    แต่ **ไหลไปข้างหน้าทางเดียว** — คนขับกดปิดงานแล้ว TMS ยังขึ้น OnDelivery
 *    ห้ามถอยสถานะกลับ ไม่งั้นงานที่ปิดพร้อม POD แล้วจะเด้งกลับมาเป็นงานค้าง
 */

/* ===== เติมลูกค้าย้อนหลังหลังจับคู่ร้าน =====
   ออเดอร์ที่เกิดตอนร้านยังไม่จับคู่มี customer_id เป็น null
   พอมีคนจับคู่ร้านทีหลัง ต้องมีทางเติมย้อนหลังให้ ไม่ใช่ต้องลบออเดอร์แล้วนำเข้าใหม่ */
create or replace function public.link_tms_orders_to_customers()
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  if not app.has_perm('orders.write') then
    raise exception 'ไม่มีสิทธิ์แก้ออเดอร์' using errcode = '42501';
  end if;

  with pairs as (
    select distinct s.order_id, m.customer_id
      from public.tms_shipments s
      join public.tms_dealer_map m on m.dealer_code = s.dealer_code
      join public.orders o on o.id = s.order_id
     where s.order_id is not null
       and o.customer_id is null
       and m.customer_id is not null
       and not m.ignored
  ),
  upd as (
    update public.orders o set customer_id = p.customer_id, updated_at = now()
      from pairs p where o.id = p.order_id
    returning 1
  )
  select count(*)::int into v_n from upd;

  return json_build_object('linked', coalesce(v_n, 0));
end;
$$;

/* ===== สถานะไหลจาก TMS เข้าเที่ยวที่นำเข้าแล้ว =====
 *
 * เรียกท้าย push_tms_trips ทุกครั้ง ไม่ต้องให้หน้าจอสั่ง — ถ้าให้หน้าจอสั่ง
 * วันไหนมีคนเขียนหน้าใหม่แล้วลืมเรียก สถานะจะค้างโดยไม่มีอะไรฟ้อง
 *
 * ไหลไปข้างหน้าทางเดียวเสมอ (rank) เพราะฝั่งเรามีการกระทำที่ TMS ไม่รู้:
 * คนขับกดปิดงาน + เก็บ POD แล้ว แต่คนออฟฟิศที่ TMS ยังไม่ได้กดปิดเที่ยว
 * ถอยสถานะกลับ = งานที่เสร็จแล้วเด้งกลับมาเป็นงานค้างในมือคนขับ
 */
create or replace function app.trip_rank(s trip_status)
returns int language sql immutable as $$
  select case s when 'planned' then 1 when 'in_progress' then 2
                when 'completed' then 3 when 'cancelled' then 3 end
$$;

create or replace function app.order_rank(s order_status)
returns int language sql immutable as $$
  select case s when 'pending' then 1 when 'assigned' then 2 when 'in_transit' then 3
                when 'delivered' then 4 when 'cancelled' then 4 end
$$;

create or replace function public.sync_tms_trip_status()
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_trips  int;
  v_orders int;
begin
  with want as (
    select t.trip_id,
           case t.status_id when 2 then 'planned'
                            when 3 then 'in_progress'
                            when 4 then 'in_progress'
                            when 5 then 'completed'
                            else null end::trip_status as st
      from public.tms_trips t
     where t.trip_id is not null and t.status_id in (2, 3, 4, 5)
  ),
  upd as (
    update public.trips tr
       set status = w.st,
           /* เวลาออกรถของจริงมาจาก TMS (onDeliveryDate) ถ้าฝั่งเรายังไม่มี
              ไม่เขียนทับของเดิม เพราะคนขับกดออกรถเองก็บันทึกเวลาไว้แล้ว */
           departed_at = coalesce(tr.departed_at,
             case when w.st = 'in_progress'
                  then (select on_delivery_date from public.tms_trips z where z.trip_id = tr.id)
             end),
           arrived_at = coalesce(tr.arrived_at, case when w.st = 'completed' then now() end)
      from want w
     where tr.id = w.trip_id
       and w.st is not null
       /* ไปข้างหน้าเท่านั้น และไม่แตะเที่ยวที่ถูกยกเลิกฝั่งเรา */
       and tr.status <> 'cancelled'
       and app.trip_rank(w.st) > app.trip_rank(tr.status)
    returning tr.id
  )
  select count(*)::int into v_trips from upd;

  /* ออเดอร์ในเที่ยวตามสถานะเที่ยว — ไม่แตะใบที่ delivered หรือ cancelled แล้ว
     ใบที่ delivered มี POD ผูกอยู่ การถอยสถานะคือทำหลักฐานให้ขัดกับสถานะงาน */
  with want as (
    select o.id,
           case tr.status when 'planned' then 'assigned'
                          when 'in_progress' then 'in_transit'
                          when 'completed' then 'delivered'
                          else null end::order_status as st
      from public.orders o
      join public.trips tr on tr.id = o.trip_id
      join public.tms_trips t on t.trip_id = tr.id
  ),
  upd as (
    update public.orders o
       set status = w.st,
           delivered_at = coalesce(o.delivered_at, case when w.st = 'delivered' then now() end),
           updated_at = now()
      from want w
     where o.id = w.id and w.st is not null
       and o.status not in ('delivered', 'cancelled')
       and app.order_rank(w.st) > app.order_rank(o.status)
    returning o.id
  )
  select count(*)::int into v_orders from upd;

  return json_build_object('trips', coalesce(v_trips, 0), 'orders', coalesce(v_orders, 0));
end;
$$;

/* ===== นำเข้าเที่ยว (แทน 0013) =====
 * เที่ยวไปทั้งก้อน: ทุกใบในเที่ยวกลายเป็นออเดอร์ ไม่มีใบไหนถูกข้าม
 * รถสร้างให้เองจากทะเบียน คนขับต้องจับคู่ก่อน
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
  v_ostatus  order_status;
  v_row      record;
  v_order    public.orders;
  v_created  int := 0;
  v_nocust   int := 0;
  v_linked   int := 0;
  v_origin   text;
  v_vtype    text;
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

  /* คนขับ — ต้องมีคนจับคู่ก่อนเสมอ ชื่อในระบบบริษัทกับคนในระบบเราไม่ได้สะกดเหมือนกัน
     และคนขับต้องผูกกับบัญชีผู้ใช้ถึงจะเห็นงานตัวเอง (RLS แขวนอยู่กับ drivers.user_id)
     เดาผิด = งานไปโผล่ในมือคนที่ไม่ได้วิ่ง แล้วคนที่วิ่งจริงมองไม่เห็นงานตัวเอง */
  select driver_id into v_driver from public.tms_driver_map
   where driver_key = v_t.driver_name and not ignored;
  if v_driver is null then
    raise exception 'พนักงานขับ % ยังไม่จับคู่กับคนในระบบ', coalesce(v_t.driver_name, '(ไม่มีชื่อ)')
      using errcode = 'P0001';
  end if;

  /* รถ — ทะเบียนคือข้อเท็จจริงจาก TMS ไม่ใช่เรื่องที่ต้องให้คนตัดสิน สร้างให้เองถ้ายังไม่มี
     **ห้ามผูกรถกับคนขับที่ไหนในระบบ** กองรถมี 4W 5 คัน คนเดิมไม่ได้ใช้คันเดิมทุกวัน
     รถถูกผูกที่ระดับ "เที่ยว" เท่านั้น ซึ่งเป็นความจริงเฉพาะวันนั้น */
  select vehicle_id into v_vehicle from public.tms_vehicle_map
   where plate = v_t.license_plate and not ignored;

  if v_vehicle is null and coalesce(trim(v_t.license_plate), '') <> '' then
    select id into v_vehicle from public.vehicles where plate_no = trim(v_t.license_plate);

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

    insert into public.tms_vehicle_map (plate, vehicle_id, mapped_by, mapped_at)
    values (v_t.license_plate, v_vehicle, app.current_user_id(), now())
    on conflict (plate) do update set
      vehicle_id = coalesce(tms_vehicle_map.vehicle_id, excluded.vehicle_id),
      mapped_at = now();
  end if;

  if v_vehicle is null then
    raise exception 'เที่ยวนี้ไม่มีทะเบียนรถจาก TMS' using errcode = 'P0001';
  end if;

  select coalesce(value, 'คลังบริษัท') into v_origin from public.settings where key = 'org_name';

  v_status := case v_t.status_id
                when 2 then 'planned' when 3 then 'in_progress'
                when 4 then 'in_progress' when 5 then 'completed'
                else 'planned' end::trip_status;

  v_ostatus := case v_status when 'completed' then 'delivered'
                             when 'in_progress' then 'in_transit'
                             else 'assigned' end::order_status;

  insert into public.trips (vehicle_id, driver_id, status, departed_at, notes)
  values (v_vehicle, v_driver, v_status,
          case when v_status <> 'planned' then v_t.on_delivery_date end,
          'นำเข้าจาก TMS · เที่ยว ' || v_t.trip_no
            || coalesce(' · ' || v_t.warehouse_code, '')
            || coalesce(' · เขต ' || v_t.area, ''))
  returning * into v_trip;

  /* **ทุกใบในเที่ยว** ไม่มีการข้าม — เที่ยวที่ขาดจุดส่งคือคนขับไปถึงหน้าร้าน
     แล้วในระบบไม่มีงานนั้น ซึ่งแย่กว่าออเดอร์ที่ยังไม่รู้ว่าเป็นของลูกค้ารายไหน */
  for v_row in
    select s.picking_list_no,
           max(s.order_id) as order_id,
           max(m.customer_id) filter (where not coalesce(m.ignored, false)) as customer_id,
           max(s.dealer_name) as dealer_name,
           max(s.dealer_code) as dealer_code,
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
      /* ใบที่เคยนำเข้าเป็นออเดอร์ไว้แล้ว (จากหน้านำเข้ารายวัน) — ดึงมาผูกเที่ยว ไม่สร้างซ้ำ */
      update public.orders
         set trip_id = v_trip.id,
             status = case when status in ('delivered', 'cancelled') then status else v_ostatus end,
             updated_at = now()
       where id = v_row.order_id;
      v_linked := v_linked + 1;
      continue;
    end if;

    insert into public.orders (customer_id, origin, destination, goods_desc,
                               weight_kg, fee, status, scheduled_at, trip_id, notes)
    values (v_row.customer_id,   /* null ได้ = ร้านยังไม่จับคู่ เติมย้อนหลังด้วย link_tms_orders_to_customers() */
            v_origin,
            /* ชื่อร้านนำหน้าที่อยู่ — ออเดอร์ที่ยังไม่มีลูกค้าจะไม่มีชื่อร้านที่ไหนเลย
               ถ้าไม่ใส่ไว้ตรงนี้ คนขับเห็นแต่ที่อยู่เปล่า ๆ ไม่รู้ว่าไปส่งใคร */
            left(concat_ws(' · ',
                   nullif(trim(coalesce(v_row.ship_to_name, v_row.dealer_name)), ''),
                   nullif(trim(coalesce(v_row.ship_to_address, '') ||
                          coalesce(' จ.' || v_row.province, '')), '')), 500),
            left(coalesce(v_row.goods, 'สินค้าตาม PL'), 500),
            0,
            0,
            v_ostatus,
            coalesce(v_row.plan_date, v_t.order_date, current_date),
            v_trip.id,
            'นำเข้าจาก TMS · PL ' || v_row.picking_list_no
              || ' · เที่ยว ' || v_t.trip_no
              || ' · ' || coalesce(v_row.total_qty, 0) || ' คัน'
              || case when v_row.customer_id is null
                      then ' · ยังไม่ผูกลูกค้า (ร้าน ' || coalesce(v_row.dealer_code, '-') || ')'
                      else '' end)
    returning * into v_order;

    update public.tms_shipments
       set order_id = v_order.id
     where picking_list_no = v_row.picking_list_no
       and tms_trip_id = p_tms_id;

    v_created := v_created + 1;
    if v_row.customer_id is null then v_nocust := v_nocust + 1; end if;
  end loop;

  /* จองรถ/คนขับเฉพาะเที่ยวที่ยังไม่จบ — เที่ยวย้อนหลังแบบ Completed ไม่ควรทำให้
     รถที่วิ่งงานวันนี้กลายเป็นไม่ว่าง */
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
    'linked_orders', v_linked,
    'orders_without_customer', v_nocust,
    'already', false
  );
end;
$$;

/* ===== push แล้วให้สถานะไหลต่อทันที =====
   ห่อ push_tms_trips เดิมด้วยการเรียก sync_tms_trip_status() ต่อท้าย
   เขียนใหม่ทั้งฟังก์ชันไม่ได้ (ยาวและซ้ำ) จึงทำเป็นตัวห่อชื่อเดิมไม่ได้ด้วย —
   ให้ฝั่งเว็บเรียกสองตัวต่อกันแทน แต่ **ฐานเป็นคนตัดสินว่าอัปเดตอะไรได้**
   ไม่ใช่หน้าจอส่งสถานะมาบอก */
create or replace function public.push_tms_trips_and_sync(p_rows jsonb)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_push json;
  v_sync json;
begin
  v_push := public.push_tms_trips(p_rows);
  v_sync := public.sync_tms_trip_status();
  return json_build_object(
    'push', v_push,
    'synced_trips', (v_sync->>'trips')::int,
    'synced_orders', (v_sync->>'orders')::int
  );
end;
$$;

/* ===== preview: เลิกบล็อกเรื่องทะเบียน =====
   ทะเบียนที่ยังไม่มีในระบบไม่ใช่ปัญหาให้คนแก้ ระบบสร้างให้ตอนนำเข้า
   เหลือค้างจริง ๆ อย่างเดียวคือชื่อคนขับ ซึ่งต้องมีคนบอกว่าเป็นใครในระบบเรา */
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
                 t.trip_id is not null as imported,
                 t.trip_id,
                 dm.driver_id,
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
            left join public.tms_driver_map dm on dm.driver_key = t.driver_name and not dm.ignored
           where t.order_date = v_date
        ) x
    ), '[]'::json),
    /* เหลือค้างอย่างเดียวที่คนต้องทำก่อนนำเข้าได้ */
    'unmapped_drivers', coalesce((
      select json_agg(distinct t.driver_name)
        from public.tms_trips t
        left join public.tms_driver_map dm on dm.driver_key = t.driver_name
       where t.order_date = v_date and t.driver_name is not null
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
$$;

revoke execute on function public.push_tms_trips_and_sync, public.sync_tms_trip_status,
  public.link_tms_orders_to_customers from public;
grant execute on function public.push_tms_trips_and_sync, public.sync_tms_trip_status,
  public.link_tms_orders_to_customers to authenticated;
