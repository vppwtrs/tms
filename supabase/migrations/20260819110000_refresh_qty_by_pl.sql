-- ซ่อมจำนวนสินค้าให้ยึดเลข PL อย่างเดียว
--
-- ตัวเดิมบังคับให้ใบดิบต้องชี้กลับมาที่ออเดอร์ (`s.order_id = o.id`) ด้วย ซึ่งเป็นเงื่อนไข
-- ที่ตั้งไว้ตอนนำเข้า ใบที่นำเข้าไปตั้งแต่ก่อนมีขั้นตอนนั้น หรือใบที่ถูกดึงใหม่ทับ
-- จึงหลุดจากการซ่อมทั้งหมด แล้วฟังก์ชันก็คืน 0 อย่างเงียบ ๆ เหมือนไม่มีอะไรต้องแก้
--
-- เลข PL เป็นตัวระบุใบอยู่แล้วและไม่ซ้ำ ใช้ตัวเดียวพอ

create or replace function public.refresh_order_item_qty()
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fixed int := 0;
  v_added int := 0;
begin
  if not app.has_perm('orders.write') then
    raise exception 'ไม่มีสิทธิ์แก้ไขออเดอร์' using errcode = '42501';
  end if;

  /* จำนวนที่ถูกต้องอยู่ในใบดิบอยู่แล้ว ไม่ต้องดึงจาก TMS ใหม่
     0 ในช่องหนึ่งแปลว่า "ใบนี้ไม่ได้ใช้ช่องนั้น" จึงต้องข้ามไปหาช่องถัดไป */
  with src as (
    select o.id as order_id,
           s.item_no,
           max(s.item_name) as item_name,
           sum(coalesce(nullif(s.item_split_qty, 0), nullif(s.item_qty, 0), 0)) as qty
      from public.orders o
      join public.tms_shipments s
        on s.picking_list_no = o.tms_picking_list_no
     where coalesce(btrim(s.item_no), '') <> ''
       and coalesce(btrim(o.tms_picking_list_no), '') <> ''
     group by o.id, s.item_no
  ), upd as (
    update public.order_items oi
       set qty = src.qty
      from src
     where oi.order_id = src.order_id
       and oi.item_no = src.item_no
       and oi.qty is distinct from src.qty
    returning 1
  )
  select count(*) into v_fixed from upd;

  /* ใบที่นำเข้าตอนที่ยังไม่มีรายการของเลย จะไม่มีแถวให้แก้ ต้องเติมเข้าไปใหม่ */
  with src as (
    select o.id as order_id,
           s.item_no,
           max(s.item_name) as item_name,
           sum(coalesce(nullif(s.item_split_qty, 0), nullif(s.item_qty, 0), 0)) as qty
      from public.orders o
      join public.tms_shipments s
        on s.picking_list_no = o.tms_picking_list_no
     where coalesce(btrim(s.item_no), '') <> ''
       and coalesce(btrim(o.tms_picking_list_no), '') <> ''
     group by o.id, s.item_no
  ), ins as (
    insert into public.order_items (order_id, item_no, item_name, qty)
    select src.order_id, src.item_no, src.item_name, src.qty from src
    on conflict (order_id, item_no) do nothing
    returning 1
  )
  select count(*) into v_added from ins;

  return json_build_object('fixed', v_fixed, 'added', v_added);
end;
$fn$;

grant execute on function public.refresh_order_item_qty() to authenticated;
