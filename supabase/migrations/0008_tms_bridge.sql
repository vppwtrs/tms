/* 0008 — สะพานจาก tms_shipments เข้าสู่งานจริง (orders + trips)
 *
 * วัดจากข้อมูลจริงของคลัง KM23-CW-01 ช่วง 1–15 ส.ค. 2569 ก่อนออกแบบ:
 *   209 แถว = 209 PL ไม่ซ้ำ  ->  1 PL = 1 ออเดอร์ ตรงตัว ไม่ต้องรวมหรือแตก
 *   51 เที่ยว PL เฉลี่ย 4.1 ใบต่อเที่ยว สูงสุด 17  ->  tripNo ของ TMS = เที่ยวของเรา
 *   73 ร้านใน 9 วัน  ->  ตารางจับคู่ร้านมีขนาดหลักร้อย ไม่ใช่หลักหมื่น คนนั่งตรวจไหว
 *   มี licensePlate กับ driver มาให้  ->  จับคู่กับ vehicles/drivers ที่มีอยู่แล้วได้
 *
 * ทำไมต้องมีตารางจับคู่ ไม่ jsonb แล้ว match ชื่อเอาตอนแปลง:
 * ชื่อร้านใน TMS กับชื่อลูกค้าในระบบเราไม่เหมือนกันอยู่แล้ว (สาขา ตัวสะกด เว้นวรรค)
 * ถ้าเดาด้วยการ match ชื่อ วันไหนเดาผิดคือออเดอร์ไปโผล่ผิดลูกค้า แล้วไม่มีใครรู้
 * ให้คนยืนยันครั้งเดียวต่อร้าน แล้วจำไว้ ดีกว่าเดาใหม่ทุกคืน
 *
 * ของที่ยังไม่มีและตั้งใจไม่เดา:
 *   fee    — TMS มีแต่ actualCost ซึ่งเป็น "ต้นทุนที่เราจ่าย" ไม่ใช่ "ราคาที่เก็บลูกค้า" ตั้ง 0 ไว้
 *   weight_kg — unit คือจำนวนคัน ไม่ใช่กิโล ตั้ง 0 ไว้ ห้ามเอา unit มาใส่ช่องนี้
 */

/* เก็บฟิลด์ที่ต้องใช้จับคู่ให้เป็นคอลัมน์จริง — อ่านจาก raw ทุกครั้งก็ได้ แต่ index ไม่ลง */
alter table public.tms_shipments
  add column dealer_code     text,
  add column license_plate   text,
  add column driver_name     text,
  add column status_delivery text,
  add column actual_cost     numeric;

create index tms_shipments_dealer_idx on public.tms_shipments (dealer_code);
create index tms_shipments_trip_idx   on public.tms_shipments (trip_no_tms);

/* ===== ตารางจับคู่ร้าน ===== */

create table public.tms_dealer_map (
  dealer_code text primary key,
  dealer_name text not null,
  customer_id bigint references public.customers (id) on delete set null,
  /* null = ยังไม่มีใครตัดสินใจ  ต่างจาก ignored = ตัดสินใจแล้วว่าไม่เอาเข้าระบบ */
  ignored     boolean not null default false,
  mapped_by   bigint references public.users (id),
  mapped_at   timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.tms_dealer_map enable row level security;

create policy dealer_map_select on public.tms_dealer_map
  for select to authenticated using (app.has_perm('orders.view'));

create policy dealer_map_write on public.tms_dealer_map
  for all to authenticated
  using (app.has_perm('orders.write')) with check (app.has_perm('orders.write'));

/* ===== ดูก่อนนำเข้า =====
   คืนว่าวันนั้นมีอะไรพร้อม/ไม่พร้อม โดยไม่แตะข้อมูลจริงสักแถว
   หน้าจอควรเรียกตัวนี้ก่อนเสมอ แล้วโชว์ให้คนกดยืนยัน */
create or replace function public.preview_tms_import(p_date date)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_result json;
begin
  if not app.has_perm('orders.view') then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลนำเข้า' using errcode = '42501';
  end if;

  select json_build_object(
    'date', p_date,
    'picking_lists', count(distinct s.picking_list_no),
    'trips', count(distinct s.trip_no_tms),
    'already_imported', count(distinct s.picking_list_no) filter (where s.order_id is not null),
    'unmapped_dealers', coalesce((
      select json_agg(json_build_object('dealer_code', d.dealer_code, 'dealer_name', d.dealer_name, 'picking_lists', d.n))
        from (
          select s2.dealer_code, max(s2.dealer_name) as dealer_name, count(distinct s2.picking_list_no) as n
            from public.tms_shipments s2
            left join public.tms_dealer_map m on m.dealer_code = s2.dealer_code
           where s2.trip_date = p_date
             and (m.dealer_code is null or (m.customer_id is null and not m.ignored))
           group by s2.dealer_code
        ) d
    ), '[]'::json),
    'unknown_plates', coalesce((
      select json_agg(distinct s3.license_plate)
        from public.tms_shipments s3
        left join public.vehicles v on v.plate_no = s3.license_plate
       where s3.trip_date = p_date and s3.license_plate is not null and v.id is null
    ), '[]'::json)
  ) into v_result
  from public.tms_shipments s
  where s.trip_date = p_date;

  return v_result;
end;
$$;

/* ===== นำเข้าจริง =====
 *
 * ข้ามใบที่ยังไม่จับคู่ร้าน ไม่ใช่ล้มทั้งวัน — วันหนึ่งมีร้านใหม่โผล่มาใบเดียว
 * ไม่ควรทำให้อีก 22 ใบเข้าระบบไม่ได้ ใบที่ข้ามยังอยู่ใน tms_shipments รอจับคู่แล้วสั่งซ้ำได้
 *
 * เรียกซ้ำวันเดิมปลอดภัย: ใบที่มี order_id แล้วถูกข้าม (idempotent)
 * จำเป็น เพราะ cron อาจยิงซ้ำ และคนก็กดปุ่มซ้ำได้
 *
 * ไม่สร้างเที่ยว (trips) ให้อัตโนมัติ — TMS บอกว่า "ใครวิ่งไปแล้ว" ซึ่งเป็นอดีต
 * ส่วน trips ของเราคือแผนที่คนจัดรถกดยืนยัน สองอย่างนี้คนละความหมาย
 * ออเดอร์ที่นำเข้าจึงเป็น pending รอจัดเที่ยวตามปกติ เก็บ tripNo เดิมไว้ใน notes ให้ตามรอยได้
 */
create or replace function public.import_tms_shipments(p_date date)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_created int := 0;
  v_skipped int := 0;
  v_row     record;
  v_order   public.orders;
  v_origin  text;
begin
  if not app.has_perm('orders.write') then
    raise exception 'ไม่มีสิทธิ์นำเข้าออเดอร์' using errcode = '42501';
  end if;

  select coalesce(value, 'คลังบริษัท') into v_origin from public.settings where key = 'org_name';

  for v_row in
    select s.picking_list_no,
           max(s.dealer_name)  as dealer_name,
           max(s.branch)       as branch,
           max(s.trip_no_tms)  as trip_no_tms,
           max(m.customer_id)  as customer_id,
           max(s.trip_date)    as trip_date,
           sum(coalesce(s.item_qty, 0)) as total_qty,
           string_agg(distinct coalesce(s.item_name, s.item_no), ', ') as goods
      from public.tms_shipments s
      join public.tms_dealer_map m on m.dealer_code = s.dealer_code
     where s.trip_date = p_date
       and s.order_id is null
       and m.customer_id is not null
       and not m.ignored
     group by s.picking_list_no
  loop
    insert into public.orders (customer_id, origin, destination, goods_desc,
                               weight_kg, fee, status, scheduled_at, notes)
    values (v_row.customer_id,
            v_origin,
            coalesce(nullif(trim(v_row.branch), ''), v_row.dealer_name),
            left(coalesce(v_row.goods, 'สินค้าตาม PL'), 500),
            0,
            0,
            'pending',
            v_row.trip_date,
            'นำเข้าจาก TMS · PL ' || v_row.picking_list_no
              || coalesce(' · เที่ยว ' || v_row.trip_no_tms, '')
              || ' · ' || v_row.total_qty || ' คัน')
    returning * into v_order;

    update public.tms_shipments
       set order_id = v_order.id
     where picking_list_no = v_row.picking_list_no;

    v_created := v_created + 1;
  end loop;

  select count(distinct s.picking_list_no) into v_skipped
    from public.tms_shipments s
    left join public.tms_dealer_map m on m.dealer_code = s.dealer_code
   where s.trip_date = p_date
     and s.order_id is null
     and (m.customer_id is null or m.ignored);

  return json_build_object('date', p_date, 'created', v_created, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.preview_tms_import, public.import_tms_shipments from public;
grant execute on function public.preview_tms_import, public.import_tms_shipments to authenticated;
