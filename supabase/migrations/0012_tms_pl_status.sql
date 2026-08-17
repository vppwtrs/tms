/* 0012 — Picking List เป็นแหล่งเดียว + เฝ้าสถานะงาน
 *
 * ทำไมต้องมีไฟล์นี้: ที่ทำมาก่อนหน้าดึงจาก /v1/reports/actualshipment ซึ่งเป็น
 * "ประวัติของที่ส่งจบแล้ว" แล้วต้องไปยิงหา PL header ทีละใบเพื่อเอาชื่อสินค้า
 * ไปดูของจริงในหน้า TMS แล้วพบว่า /v1/pickinglistheaders/{wh}/search ก้อนเดียว
 * ส่งมาครบกว่าทุกอย่างที่ระบบนี้ต้องใช้ และมีของที่เส้น Actual ไม่มีเลย:
 *
 *   status / statusId      New -> AssignTrip -> OnTruck -> Completed  (สถานะของใบ)
 *   tripStatus             Confirm -> OnDelivery -> Completed          (สถานะของเที่ยว)
 *   planDeliveryDate       วันที่ "วางแผน" ส่ง ซึ่งเป็นวันที่ใช้วางแผนจ่ายงานจริง
 *   shipTo*                ชื่อ/ที่อยู่/จังหวัด/รหัสไปรษณีย์ ของปลายทางจริง
 *   details[]              มาพร้อม header อยู่แล้ว ไม่ต้องยิงหาอีก ~23 request ต่อวัน
 *
 * สองคอลัมน์วันที่ต่างกัน อย่ายุบรวม:
 *   plan_delivery_date  วันที่วางแผนส่ง — ตัวที่ใช้ตัดสินว่าจะนำเข้าเป็นออเดอร์วันไหน
 *   trip_date           orderDate = วันของเที่ยวที่ TMS จับใบนี้เข้าไป ว่างได้ถ้ายังไม่จัดเที่ยว
 * ข้อมูลเก่าที่มาจากเส้น Actual มีแต่ trip_date — จึงไม่เติม plan_delivery_date ย้อนหลัง
 * (เดาไม่ได้ว่าวางแผนไว้วันไหน) ทุก query ที่ตัดสินด้วยวันจึงใช้ coalesce ของสองตัวนี้
 *
 * ที่อยู่ปลายทางไม่ใช่ของประดับ — เป็นปุ่มเปิดแผนที่นำทางของคนขับ กติกาเดียวกับ 0011
 */

alter table public.tms_shipments
  /* วันที่วางแผนส่ง — คนละตัวกับ trip_date ดูหัวไฟล์ */
  add column plan_delivery_date date,
  /* สองสถานะ เก็บตามที่ TMS สะกดมาตรง ๆ ไม่แปลงเป็นสถานะของเรา
     ระบบเราแปลงตอนนำเข้าเป็นออเดอร์ ที่นี่คือกระจกสะท้อน TMS */
  add column pl_status        text,
  add column trip_status      text,
  add column pl_type          text,
  add column area             text,
  add column province         text,
  add column customer_address text,
  add column ship_to_name     text,
  add column ship_to_address  text,
  add column ship_to_province text,
  add column ship_to_postcode text,
  add column total_qty        numeric,
  add column pickup_date      date,
  add column delivery_date    date,
  /* ลายนิ้วมือของแถว — ใช้ตัดสินว่า "ของเดิมเป๊ะ" แล้วไม่ต้องเขียนทับ
     คิดฝั่ง SQL ไม่ใช่ให้ client ส่งมา ไม่งั้นใครส่ง hash มั่วก็สั่งข้ามการอัปเดตได้ */
  add column row_hash         text,
  add column first_seen_at    timestamptz not null default now(),
  /* เวลาที่สถานะเปลี่ยนล่าสุด — คำถามที่ต้องตอบทุกวันคือ "ใบนี้ค้างมากี่วันแล้ว"
     synced_at ตอบไม่ได้ เพราะมันขยับทุกครั้งที่มีคนกดดึง แม้ไม่มีอะไรเปลี่ยน */
  add column status_changed_at timestamptz;

create index tms_shipments_plan_date_idx on public.tms_shipments (plan_delivery_date desc);
create index tms_shipments_status_idx    on public.tms_shipments (pl_status);

comment on column public.tms_shipments.plan_delivery_date is
  'planDeliveryDate จาก PL header = วันที่วางแผนส่ง (คนละตัวกับ trip_date)';
comment on column public.tms_shipments.pl_status is
  'สถานะใบตามที่ TMS สะกด: New / AssignTrip / OnTruck / Completed';
comment on column public.tms_shipments.trip_status is
  'สถานะเที่ยวตามที่ TMS สะกด: Confirm / OnDelivery / Completed — null ถ้ายังไม่จัดเที่ยว';
comment on column public.tms_shipments.row_hash is
  'md5 ของค่าที่มีความหมาย — เท่าเดิม = ไม่เขียนทับ ไม่ลง sync log';

/* บันทึกการดึงเก็บผลละเอียดขึ้น — ของเดิมนับแต่ "แถวทั้งหมดของวันนั้น"
   ทำให้ทุกรอบ 5 นาทีลง log ใบใหม่ทั้งที่ไม่มีอะไรเปลี่ยน แล้ว log ก็เฟ้อจนไม่มีใครอ่าน */
alter table public.tms_sync_log
  add column rows_inserted integer not null default 0,
  add column rows_updated  integer not null default 0,
  add column source        text    not null default 'pl';

/* ===== รับข้อมูลเข้า (แทน 0009) =====
 *
 * ต่างจาก 0009 สามข้อ:
 *   1. รับฟิลด์ของ PL header ครบ (สถานะ ที่อยู่ปลายทาง วันวางแผน) ของเดิมทิ้ง province/area
 *      ที่ฝั่งเว็บส่งมาให้แล้วไปนอนใน raw เฉย ๆ
 *   2. แถวที่ค่าเท่าเดิมทุกช่อง **ไม่ถูกเขียนทับ** — รอบเฝ้าสถานะทุก 5 นาที
 *      ส่วนใหญ่ไม่มีอะไรเปลี่ยน ถ้าเขียนทับหมดทุกรอบคือเขียนฐานเปล่า ๆ วันละ ~280 ครั้ง
 *   3. คืน inserted / updated / unchanged แยกกัน หน้าจอจึงเงียบได้เมื่อไม่มีของใหม่
 *      แจ้ง "สำเร็จ" ทุก 5 นาทีคือฝึกให้คนเลิกอ่านข้อความของระบบ
 */
create or replace function public.push_tms_shipments(p_rows jsonb)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user      bigint := app.current_user_id();
  v_seen      int := 0;
  v_inserted  int := 0;
  v_updated   int := 0;
  v_dates     date[];
  v_d         date;
  v_ins       int;
  v_upd       int;
begin
  if not app.has_perm('orders.write') then
    raise exception 'ไม่มีสิทธิ์ส่งข้อมูลเข้าระบบ' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;

  /* drop ก่อนเสมอ — เรียกฟังก์ชันสองครั้งใน transaction เดียว (หน้าจอส่งทีละ 400 แถว)
     จะเจอ "relation _push already exists" ถ้าพึ่ง on commit drop อย่างเดียว */
  drop table if exists _push;
  create temp table _push (
    picking_list_no text, item_no text, hash text, inserted boolean,
    plan_delivery_date date, trip_date date
  ) on commit drop;

  with src as (
    /* กันคู่ (PL, item) ซ้ำภายในก้อนเดียวกัน — Postgres ฟ้อง
       "ON CONFLICT DO UPDATE command cannot affect row a second time"
       ถ้าคำสั่งเดียวมีสองแถวชนกันเอง ซึ่งเกิดจริงกับ PL ที่ถูกแบ่งส่งหลายเที่ยว */
    select distinct on (e.r->>'pickingListNo', coalesce(e.r->>'itemNo', ''))
           e.r
      from jsonb_array_elements(p_rows) with ordinality as e(r, n)
     order by e.r->>'pickingListNo', coalesce(e.r->>'itemNo', ''), e.n desc
  ),
  shaped as (
    select
      nullif(r->>'pickingListNo', '')                as picking_list_no,
      coalesce(r->>'itemNo', '')                     as item_no,
      nullif(r->>'tripNo', '')                       as trip_no_tms,
      nullif(r->>'tripDate', '')::date               as trip_date,
      nullif(r->>'planDeliveryDate', '')::date       as plan_delivery_date,
      nullif(r->>'plStatus', '')                     as pl_status,
      nullif(r->>'tripStatus', '')                   as trip_status,
      nullif(r->>'plType', '')                       as pl_type,
      nullif(r->>'area', '')                         as area,
      nullif(r->>'dealerCode', '')                   as dealer_code,
      nullif(r->>'dealerName', '')                   as dealer_name,
      nullif(r->>'branch', '')                       as branch,
      nullif(r->>'province', '')                     as province,
      nullif(r->>'customerAddress', '')              as customer_address,
      nullif(r->>'shipToName', '')                   as ship_to_name,
      nullif(r->>'shipToAddress', '')                as ship_to_address,
      nullif(r->>'shipToProvince', '')               as ship_to_province,
      nullif(r->>'shipToPostCode', '')               as ship_to_postcode,
      nullif(r->>'unit', '')::numeric::integer       as unit,
      nullif(r->>'totalQty', '')::numeric            as total_qty,
      nullif(r->>'itemName', '')                     as item_name,
      nullif(r->>'itemQty', '')::numeric::integer    as item_qty,
      nullif(r->>'itemSplitQty', '')::numeric::integer as item_split_qty,
      nullif(r->>'qtySource', '')                    as qty_source,
      nullif(r->>'licensePlate', '')                 as license_plate,
      nullif(r->>'driver', '')                       as driver_name,
      nullif(r->>'statusDelivery', '')               as status_delivery,
      nullif(r->>'actualCost', '')::numeric          as actual_cost,
      nullif(r->>'pickupDate', '')::date             as pickup_date,
      nullif(r->>'deliveryDate', '')::date           as delivery_date,
      r                                              as raw
    from src
    where nullif(r->>'pickingListNo', '') is not null
  ),
  hashed as (
    /* raw ไม่อยู่ในสูตร — TMS ใส่ฟิลด์ที่ไม่เกี่ยวมาเยอะ (GUID, textDisplay)
       เอา raw มาคิดด้วยแล้วทุกแถวจะ "เปลี่ยน" ตลอด hash ก็ไร้ประโยชน์ */
    select s.*, md5(concat_ws('|',
             s.trip_no_tms, s.trip_date, s.plan_delivery_date, s.pl_status, s.trip_status,
             s.pl_type, s.area, s.dealer_code, s.dealer_name, s.branch, s.province,
             s.customer_address, s.ship_to_name, s.ship_to_address, s.ship_to_province,
             s.ship_to_postcode, s.unit, s.total_qty, s.item_name, s.item_qty,
             s.item_split_qty, s.qty_source, s.license_plate, s.driver_name,
             s.status_delivery, s.actual_cost, s.pickup_date, s.delivery_date)) as row_hash
      from shaped s
  ),
  up as (
    insert into public.tms_shipments (
      picking_list_no, item_no, trip_no_tms, trip_date, plan_delivery_date,
      pl_status, trip_status, pl_type, area,
      dealer_code, dealer_name, branch, province, customer_address,
      ship_to_name, ship_to_address, ship_to_province, ship_to_postcode,
      unit, total_qty, item_name, item_qty, item_split_qty, qty_source,
      license_plate, driver_name, status_delivery, actual_cost,
      pickup_date, delivery_date, raw, row_hash, synced_at, status_changed_at
    )
    select h.picking_list_no, h.item_no, h.trip_no_tms, h.trip_date, h.plan_delivery_date,
           h.pl_status, h.trip_status, h.pl_type, h.area,
           h.dealer_code, h.dealer_name, h.branch, h.province, h.customer_address,
           h.ship_to_name, h.ship_to_address, h.ship_to_province, h.ship_to_postcode,
           h.unit, h.total_qty, h.item_name, h.item_qty, h.item_split_qty, h.qty_source,
           h.license_plate, h.driver_name, h.status_delivery, h.actual_cost,
           h.pickup_date, h.delivery_date, h.raw, h.row_hash, now(), now()
      from hashed h
    on conflict (picking_list_no, item_no) do update set
      trip_no_tms      = excluded.trip_no_tms,
      trip_date        = excluded.trip_date,
      /* coalesce กันของเดิมหาย: PL ที่ยังไม่จัดเที่ยวส่ง orderDate มาเป็น null
         ถ้าเขียนทับตรง ๆ ใบที่เคยมีวันเที่ยวแล้วถูกถอนออกจะกลายเป็นว่างเงียบ ๆ */
      plan_delivery_date = coalesce(excluded.plan_delivery_date, tms_shipments.plan_delivery_date),
      pl_status        = excluded.pl_status,
      trip_status      = excluded.trip_status,
      pl_type          = excluded.pl_type,
      area             = excluded.area,
      dealer_code      = excluded.dealer_code,
      dealer_name      = excluded.dealer_name,
      branch           = excluded.branch,
      province         = excluded.province,
      customer_address = excluded.customer_address,
      ship_to_name     = excluded.ship_to_name,
      ship_to_address  = excluded.ship_to_address,
      ship_to_province = excluded.ship_to_province,
      ship_to_postcode = excluded.ship_to_postcode,
      unit             = excluded.unit,
      total_qty        = excluded.total_qty,
      item_name        = excluded.item_name,
      item_qty         = excluded.item_qty,
      item_split_qty   = excluded.item_split_qty,
      qty_source       = excluded.qty_source,
      license_plate    = excluded.license_plate,
      driver_name      = excluded.driver_name,
      status_delivery  = excluded.status_delivery,
      actual_cost      = excluded.actual_cost,
      pickup_date      = excluded.pickup_date,
      delivery_date    = excluded.delivery_date,
      raw              = excluded.raw,
      row_hash         = excluded.row_hash,
      synced_at        = now(),
      status_changed_at = case
        when tms_shipments.pl_status is distinct from excluded.pl_status
          or tms_shipments.trip_status is distinct from excluded.trip_status
        then now() else tms_shipments.status_changed_at end
      /* หัวใจของรอบ 5 นาที: ของเดิมเป๊ะ = ไม่แตะแถวเลย
         order_id ไม่อยู่ในรายการ set — ใบที่นำเข้าเป็นออเดอร์แล้วส่งซ้ำก็ไม่หลุด */
      where tms_shipments.row_hash is distinct from excluded.row_hash
    returning picking_list_no, item_no, row_hash, (xmax = 0) as inserted,
              plan_delivery_date, trip_date
  )
  insert into _push select picking_list_no, item_no, row_hash, inserted, plan_delivery_date, trip_date from up;

  select count(*)::int into v_seen from jsonb_array_elements(p_rows);
  select count(*) filter (where inserted)::int,
         count(*) filter (where not inserted)::int,
         array_agg(distinct coalesce(plan_delivery_date, trip_date))
           filter (where coalesce(plan_delivery_date, trip_date) is not null)
    into v_inserted, v_updated, v_dates
    from _push;

  /* ลง log เฉพาะรอบที่มีของเปลี่ยนจริง — รอบที่เงียบไม่ต้องมีบรรทัด
     ตัวเลขที่ลงคือ "รอบนี้เปลี่ยนอะไร" ไม่ใช่ยอดรวมของวันนั้น (ของเดิมนับแบบหลัง
     ทำให้อ่าน log ย้อนหลังแล้วแยกไม่ออกว่ารอบไหนมีของใหม่) */
  if coalesce(v_inserted, 0) + coalesce(v_updated, 0) > 0 then
    foreach v_d in array coalesce(v_dates, array[]::date[]) loop
      insert into public.tms_sync_log (trip_date, rows_pushed, picking_lists,
                                       rows_inserted, rows_updated, source, synced_by)
      select v_d,
             count(*)::int,
             count(distinct p.picking_list_no)::int,
             count(*) filter (where p.inserted)::int,
             count(*) filter (where not p.inserted)::int,
             'pl',
             v_user
        from _push p
       where coalesce(p.plan_delivery_date, p.trip_date) = v_d;
    end loop;
  end if;

  return json_build_object(
    'rows',      coalesce(v_inserted, 0) + coalesce(v_updated, 0),
    'inserted',  coalesce(v_inserted, 0),
    'updated',   coalesce(v_updated, 0),
    'unchanged', greatest(v_seen - coalesce(v_inserted, 0) - coalesce(v_updated, 0), 0),
    'dates',     coalesce(to_json(v_dates), '[]'::json)
  );
end;
$$;

/* ===== กระดานสถานะ =====
 * คำถามที่หน้าออฟฟิศต้องตอบทุกครั้งที่เปิด: วันล่าสุดที่มีงานคือวันไหน
 * วันนั้นมีกี่ใบ อยู่สถานะอะไรกันบ้าง และมีอะไรรอนำเข้า
 * รวมเป็น RPC เดียวเพราะหน้าจอถามทั้งชุดพร้อมกันเสมอ ยิงทีละคำถามคือ 4 request ต่อ 5 นาที
 */
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

  /* ไม่ระบุวัน = วันล่าสุดที่มีงานจริง ไม่ใช่ "วันนี้"
     ตั้งเป็นวันนี้แล้วเช้าวันหยุดจะขึ้นว่างเปล่าทั้งที่มีงานค้างของเมื่อวาน */
  select coalesce(p_date, max(coalesce(plan_delivery_date, trip_date)))
    into v_date from public.tms_shipments;

  select json_build_object(
    'date', v_date,
    'latest_date', (select max(coalesce(plan_delivery_date, trip_date)) from public.tms_shipments),
    'synced_at', (select max(synced_at) from public.tms_shipments),
    'last_change_at', (select max(status_changed_at) from public.tms_shipments),
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
    /* นับเป็น "ใบ" ไม่ใช่ "แถว" — ใบหนึ่งมีหลาย item คนอ่านนับใบ ไม่เคยนับแถว */
    'by_status', coalesce((
      select json_agg(json_build_object('pl_status', b.st, 'trip_status', b.ts, 'picking_lists', b.n)
                      order by b.n desc)
        from (select coalesce(pl_status, '-') st, coalesce(trip_status, '-') ts,
                     count(distinct picking_list_no) n
                from public.tms_shipments
               where coalesce(plan_delivery_date, trip_date) = v_date
               group by 1, 2) b
    ), '[]'::json),
    /* ปฏิทินย้อนหลังสั้น ๆ ให้เห็นว่าวันไหนมีงานและดึงครบหรือยัง */
    'recent_days', coalesce((
      select json_agg(json_build_object('date', d.dt, 'picking_lists', d.n, 'pending', d.p) order by d.dt desc)
        from (select coalesce(plan_delivery_date, trip_date) dt,
                     count(distinct picking_list_no) n,
                     count(distinct picking_list_no) filter (where order_id is null) p
                from public.tms_shipments
               where coalesce(plan_delivery_date, trip_date) is not null
               group by 1 order by 1 desc limit 14) d
    ), '[]'::json)
  ) into v_out;

  return v_out;
end;
$$;

/* ===== preview / import: ตัดสินด้วยวันวางแผน ไม่ใช่วันเที่ยว =====
 *
 * ของเดิมกรองด้วย trip_date ซึ่งเป็นวันของเที่ยวที่ TMS จับใบเข้าไปแล้ว
 * ใบสถานะ New ยังไม่มีเที่ยว จึงไม่มี trip_date และหลุดจาก preview ทั้งหมด
 * ทั้งที่มันคือใบที่ "ต้องวางแผน" มากที่สุด — วันที่ที่ถูกคือ plan_delivery_date
 *
 * นำเข้าเฉพาะใบที่ยังทำอะไรได้ (New / AssignTrip / OnTruck)
 * Completed คือส่งจบแล้ว นำเข้ามาก็ได้ออเดอร์ pending ที่ไม่มีอะไรให้ทำ
 * แต่ยัง **เก็บ** Completed ไว้ในตาราง เพราะต้องรู้ว่าใบที่เคยเฝ้าอยู่จบแล้ว
 * ถ้ากรองตอนดึง ใบที่ส่งจบจะหายจากตารางเงียบ ๆ แล้วไม่มีใครรู้ว่ามันไปไหน
 */
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
    'not_plannable', count(distinct s.picking_list_no) filter (where s.pl_status = 'Completed'),
    'unmapped_dealers', coalesce((
      select json_agg(json_build_object(
               'dealer_code', d.dealer_code, 'dealer_name', d.dealer_name,
               'picking_lists', d.n,
               /* ที่อยู่ปลายทางมาพร้อม PL header — ใช้สร้างลูกค้าใหม่ได้ทันที
                  ไม่ต้องให้คนพิมพ์ที่อยู่ซ้ำจากหน้า TMS ซึ่งคือที่มาของที่อยู่ผิด */
               'ship_to_name', d.ship_to_name,
               'address', d.address,
               'province', d.province))
        from (
          select s2.dealer_code,
                 max(s2.dealer_name) as dealer_name,
                 max(coalesce(s2.ship_to_name, s2.branch)) as ship_to_name,
                 max(coalesce(s2.ship_to_address, s2.customer_address)) as address,
                 max(coalesce(s2.ship_to_province, s2.province)) as province,
                 count(distinct s2.picking_list_no) as n
            from public.tms_shipments s2
            left join public.tms_dealer_map m on m.dealer_code = s2.dealer_code
           where coalesce(s2.plan_delivery_date, s2.trip_date) = p_date
             and (m.dealer_code is null or (m.customer_id is null and not m.ignored))
           group by s2.dealer_code
        ) d
    ), '[]'::json),
    'unknown_plates', coalesce((
      select json_agg(distinct s3.license_plate)
        from public.tms_shipments s3
        left join public.vehicles v on v.plate_no = s3.license_plate
       where coalesce(s3.plan_delivery_date, s3.trip_date) = p_date
         and s3.license_plate is not null and v.id is null
    ), '[]'::json)
  ) into v_result
  from public.tms_shipments s
  where coalesce(s.plan_delivery_date, s.trip_date) = p_date;

  return v_result;
end;
$$;

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
           max(coalesce(s.ship_to_name, s.branch)) as ship_to_name,
           max(coalesce(s.ship_to_address, s.customer_address)) as ship_to_address,
           max(coalesce(s.ship_to_province, s.province)) as province,
           max(s.trip_no_tms)  as trip_no_tms,
           max(m.customer_id)  as customer_id,
           max(coalesce(s.plan_delivery_date, s.trip_date)) as plan_date,
           max(coalesce(s.total_qty, s.unit)) as total_qty,
           string_agg(distinct coalesce(s.item_name, s.item_no), ', ') as goods
      from public.tms_shipments s
      join public.tms_dealer_map m on m.dealer_code = s.dealer_code
     where coalesce(s.plan_delivery_date, s.trip_date) = p_date
       and s.order_id is null
       and coalesce(s.pl_status, 'New') <> 'Completed'
       and m.customer_id is not null
       and not m.ignored
     group by s.picking_list_no
  loop
    insert into public.orders (customer_id, origin, destination, goods_desc,
                               weight_kg, fee, status, scheduled_at, notes)
    values (v_row.customer_id,
            v_origin,
            /* ปลายทาง = ที่อยู่จริงที่คนขับต้องไป ไม่ใช่ชื่อร้าน
               ชื่อร้านอยู่ที่ลูกค้าแล้ว ช่องนี้ต้องเปิดแผนที่นำทางได้ */
            left(coalesce(nullif(trim(coalesce(v_row.ship_to_address, '') ||
                   coalesce(' จ.' || v_row.province, '')), ''),
                 v_row.ship_to_name, v_row.dealer_name), 500),
            left(coalesce(v_row.goods, 'สินค้าตาม PL'), 500),
            0,
            0,
            'pending',
            v_row.plan_date,
            'นำเข้าจาก TMS · PL ' || v_row.picking_list_no
              || coalesce(' · เที่ยว ' || v_row.trip_no_tms, '')
              || ' · ' || coalesce(v_row.total_qty, 0) || ' คัน')
    returning * into v_order;

    /* กรองวันด้วย — PL เลขเดิมโผล่ได้หลายวันถ้า TMS เลื่อนวันส่ง
       ของเดิมอัปเดตทุกแถวที่เลขตรง ทำให้ใบของวันอื่นถูกตีว่านำเข้าแล้วโดยไม่มีออเดอร์จริง */
    update public.tms_shipments
       set order_id = v_order.id
     where picking_list_no = v_row.picking_list_no
       and coalesce(plan_delivery_date, trip_date) = p_date;

    v_created := v_created + 1;
  end loop;

  select count(distinct s.picking_list_no) into v_skipped
    from public.tms_shipments s
    left join public.tms_dealer_map m on m.dealer_code = s.dealer_code
   where coalesce(s.plan_delivery_date, s.trip_date) = p_date
     and s.order_id is null
     and coalesce(s.pl_status, 'New') <> 'Completed'
     and (m.customer_id is null or m.ignored);

  return json_build_object('date', p_date, 'created', v_created, 'skipped', v_skipped);
end;
$$;

/* ===== สร้างลูกค้าจากร้านของ TMS พร้อมจับคู่ในจังหวะเดียว =====
 *
 * ทำไมต้องเป็นฟังก์ชัน ไม่ใช่ให้หน้าจอ insert customers แล้ว upsert map ต่อ:
 * สองคำสั่งแยกกันแปลว่าเน็ตหลุดกลางทางแล้วได้ลูกค้าที่ไม่ผูกกับร้านไหน
 * ลอยอยู่ในระบบ แล้วคนก็กดสร้างใหม่อีกใบ กลายเป็นลูกค้าซ้ำสองรายชื่อเดียวกัน
 *
 * ระบบยัง **ไม่เดา** ว่าร้านไหนคือลูกค้าไหน — คนต้องกดปุ่มนี้ต่อร้าน
 * ต่างจากการ match ชื่ออัตโนมัติที่ผิดแล้วไม่มีอะไรฟ้อง
 */
create or replace function public.create_customer_from_dealer(p_dealer_code text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_d   record;
  v_id  bigint;
begin
  if not app.has_perm('customers.write') then
    raise exception 'ไม่มีสิทธิ์สร้างลูกค้า' using errcode = '42501';
  end if;

  select max(dealer_name) as dealer_name,
         max(coalesce(ship_to_name, branch)) as ship_to_name,
         max(coalesce(ship_to_address, customer_address)) as address,
         max(coalesce(ship_to_province, province)) as province,
         max(ship_to_postcode) as postcode
    into v_d
    from public.tms_shipments
   where dealer_code = p_dealer_code;

  if v_d.dealer_name is null then
    raise exception 'ไม่พบร้านรหัส %', p_dealer_code using errcode = 'P0002';
  end if;

  /* ร้านนี้จับคู่ไปแล้วก็คืนลูกค้าเดิม ไม่สร้างใบที่สอง — คนกดสองครั้งได้เสมอ */
  select customer_id into v_id from public.tms_dealer_map
   where dealer_code = p_dealer_code and customer_id is not null;

  if v_id is null then
    insert into public.customers (name, address, tags)
    values (v_d.dealer_name,
            nullif(concat_ws(' ', v_d.address, nullif('จ.' || v_d.province, 'จ.'), v_d.postcode), ''),
            'TMS ' || p_dealer_code)
    returning id into v_id;
  end if;

  insert into public.tms_dealer_map (dealer_code, dealer_name, customer_id, mapped_by, mapped_at)
  values (p_dealer_code, v_d.dealer_name, v_id, app.current_user_id(), now())
  on conflict (dealer_code) do update set
    customer_id = excluded.customer_id,
    ignored     = false,
    mapped_by   = excluded.mapped_by,
    mapped_at   = now();

  return json_build_object('customer_id', v_id, 'name', v_d.dealer_name);
end;
$$;

revoke execute on function public.tms_board, public.create_customer_from_dealer from public;
grant execute on function public.tms_board, public.create_customer_from_dealer to authenticated;
