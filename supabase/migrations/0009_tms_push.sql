/* 0009 — รับข้อมูลที่คนออฟฟิศ "ผลัก" ขึ้นมาเอง แทน Edge Function ตั้งเวลา
 *
 * ทำไมเปลี่ยนจากแผนเดิม (tms-sync ยิงเองตอนตี 1):
 * แผนเดิมต้องเก็บ user/password ของ TMS บริษัทไว้ใน Supabase Secrets
 * = รหัสของบริษัทไปนอนอยู่บนคลาวด์ต่างประเทศ ต้องขออนุญาต IT ก่อน และถ้ารหัสหมดอายุ
 * ก็เงียบไปเฉย ๆ จนกว่าจะมีคนสังเกต
 *
 * แบบใหม่: คนออฟฟิศเปิด TMS Extractor บนเครื่องตัวเอง ล็อกอิน TMS ด้วยรหัสตัวเอง
 * (รหัสอยู่ในหัวคน ไม่มีในไฟล์ ไม่มีบนคลาวด์) ดึงข้อมูล แล้วกดปุ่มส่งขึ้นมา
 * แลกกับข้อเสียเดียว: เช้าไหนไม่มีใครกด ข้อมูลก็ไม่มา -> จึงต้องมี tms_sync_log
 * ให้หน้าจอเตือนได้ว่า "วันนี้ยังไม่มีใครดึง"
 *
 * ยังไม่เปิด insert ตรง ๆ บนตาราง — เขียนผ่านฟังก์ชันตัวเดียวเท่านั้น
 * ตารางจึงมีทางเข้าทางเดียวที่ตรวจสิทธิ์แล้ว ไม่ต้องพึ่ง service_role อีก
 */

/* ===== บันทึกว่าใครดึงวันไหนเมื่อไหร่ ===== */
create table public.tms_sync_log (
  id            bigint generated always as identity primary key,
  trip_date     date not null,
  rows_pushed   integer not null default 0,
  picking_lists integer not null default 0,
  synced_by     bigint references public.users (id),
  synced_at     timestamptz not null default now()
);

create index tms_sync_log_date_idx on public.tms_sync_log (trip_date, synced_at desc);

alter table public.tms_sync_log enable row level security;

/* อ่านได้เท่านั้น เขียนผ่าน push_tms_shipments อย่างเดียว */
create policy tms_sync_log_select on public.tms_sync_log
  for select to authenticated using (app.has_perm('orders.view'));

/* ===== รับข้อมูลเข้า =====
 *
 * p_rows คือ array ของแถวจากรายงาน Actual Shipment ตามชื่อฟิลด์ที่ TMS ส่งมาจริง
 * (ดู extractor/tms-extractor/public/app.js — ตัวนั้นเจอของจริงมาก่อน)
 *
 * upsert ด้วย (picking_list_no, item_no) ตาม unique ที่มีอยู่แล้วใน 0001
 * item_no ว่างถูกแปลงเป็น '' ไม่ใช่ null — เพราะ Postgres ถือว่า null ไม่ชนกับ null
 * แถว "PL ที่ไม่มี item" จะกลายเป็นแถวใหม่ทุกครั้งที่กดส่ง ถ้าปล่อยเป็น null
 *
 * order_id ไม่เคยถูกแตะตอน upsert — ใบที่นำเข้าเป็นออเดอร์ไปแล้ว กดส่งซ้ำก็ไม่หลุด
 */
create or replace function public.push_tms_shipments(p_rows jsonb)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user  bigint := app.current_user_id();
  v_rows  int := 0;
  v_dates date[];
  v_d     date;
begin
  if not app.has_perm('orders.write') then
    raise exception 'ไม่มีสิทธิ์ส่งข้อมูลเข้าระบบ' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;

  /* กันคู่ (PL, item) ซ้ำภายในก้อนเดียวกัน — Postgres จะฟ้อง
     "ON CONFLICT DO UPDATE command cannot affect row a second time"
     ถ้ามีสองแถวในคำสั่งเดียวชนกันเอง ซึ่งเกิดได้จริงเมื่อ PL ถูกแบ่งส่งหลายเที่ยว
     เอาแถวหลังสุดของแต่ละคู่ (ordinality สูงสุด) เพราะรายงานเรียงตามเวลา */
  with src as (
    select distinct on (e.r->>'pickingListNo', coalesce(e.r->>'itemNo', ''))
           e.r
      from jsonb_array_elements(p_rows) with ordinality as e(r, n)
     order by e.r->>'pickingListNo', coalesce(e.r->>'itemNo', ''), e.n desc
  ),
  up as (
    insert into public.tms_shipments (
      picking_list_no, item_no, trip_no_tms, trip_date,
      dealer_code, dealer_name, branch, unit,
      item_name, item_qty, item_split_qty, qty_source,
      license_plate, driver_name, status_delivery, actual_cost,
      raw, synced_at
    )
    select
      nullif(r->>'pickingListNo', ''),
      coalesce(r->>'itemNo', ''),
      nullif(r->>'tripNo', ''),
      nullif(r->>'tripDate', '')::date,
      nullif(r->>'dealerCode', ''),
      nullif(r->>'dealerName', ''),
      nullif(r->>'branch', ''),
      nullif(r->>'unit', '')::numeric::integer,
      nullif(r->>'itemName', ''),
      nullif(r->>'itemQty', '')::numeric::integer,
      nullif(r->>'itemSplitQty', '')::numeric::integer,
      nullif(r->>'qtySource', ''),
      nullif(r->>'licensePlate', ''),
      nullif(r->>'driver', ''),
      nullif(r->>'statusDelivery', ''),
      nullif(r->>'actualCost', '')::numeric,
      r,
      now()
    from src
    where nullif(r->>'pickingListNo', '') is not null
    on conflict (picking_list_no, item_no) do update set
      trip_no_tms     = excluded.trip_no_tms,
      trip_date       = excluded.trip_date,
      dealer_code     = excluded.dealer_code,
      dealer_name     = excluded.dealer_name,
      branch          = excluded.branch,
      unit            = excluded.unit,
      item_name       = excluded.item_name,
      item_qty        = excluded.item_qty,
      item_split_qty  = excluded.item_split_qty,
      qty_source      = excluded.qty_source,
      license_plate   = excluded.license_plate,
      driver_name     = excluded.driver_name,
      status_delivery = excluded.status_delivery,
      actual_cost     = excluded.actual_cost,
      raw             = excluded.raw,
      synced_at       = now()
    returning trip_date
  )
  select count(*)::int, array_agg(distinct trip_date) filter (where trip_date is not null)
    into v_rows, v_dates
    from up;

  /* ลงบันทึกแยกตามวัน — หน้าจอถามว่า "วันนี้ดึงหรือยัง" ทีละวันเสมอ */
  foreach v_d in array coalesce(v_dates, array[]::date[]) loop
    insert into public.tms_sync_log (trip_date, rows_pushed, picking_lists, synced_by)
    select v_d,
           count(*)::int,
           count(distinct picking_list_no)::int,
           v_user
      from public.tms_shipments
     where trip_date = v_d;
  end loop;

  return json_build_object(
    'rows', v_rows,
    'dates', coalesce(to_json(v_dates), '[]'::json)
  );
end;
$$;

/* ===== ข้อมูลวันนี้มาหรือยัง =====
   หน้าออฟฟิศเรียกตัวนี้ตอนเปิดหน้า เพื่อขึ้นแถบเตือนถ้ายังไม่มีใครดึง */
create or replace function public.tms_sync_status(p_date date)
returns json
language sql security definer set search_path = public
as $$
  select json_build_object(
    'date', p_date,
    'synced_at',     (select max(synced_at) from public.tms_sync_log where trip_date = p_date),
    'picking_lists', (select count(distinct picking_list_no)::int
                        from public.tms_shipments where trip_date = p_date),
    'pending_import',(select count(distinct picking_list_no)::int
                        from public.tms_shipments where trip_date = p_date and order_id is null)
  )
  where app.has_perm('orders.view');
$$;

revoke execute on function public.push_tms_shipments, public.tms_sync_status from public;
grant execute on function public.push_tms_shipments, public.tms_sync_status to authenticated;
