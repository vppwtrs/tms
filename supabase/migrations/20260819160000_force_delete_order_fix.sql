-- ลบถาวรติด foreign key ของ tms_shipments
--
-- รอบก่อน (20260819140000) เปลี่ยนจาก "ปลดลิงก์ใบดิบ" เป็น "ลบใบดิบ" แต่วางคำสั่งลบไว้
-- หลังลบ orders ซึ่งผิดลำดับ: tms_shipments.order_id ชี้มาที่ orders อยู่ การลบ orders
-- จึงถูกฐานปฏิเสธด้วย 23503 และปุ่มลบถาวรใช้ไม่ได้เลยตั้งแต่นั้น
--
--   ข้อมูลที่อ้างถึงไม่มีอยู่จริง (Key (id)=(1273) is still referenced from table "tms_shipments")
--
-- ของเดิมไม่เจอปัญหานี้เพราะมันเซ็ต order_id = null ก่อน ซึ่งตัดสายอ้างอิงไปในตัว
--
-- ลำดับที่ถูก: ใบดิบไปก่อน แล้วเที่ยวดิบ จากนั้นค่อยถึงฝั่งงาน
-- และเงื่อนไขต้องครอบสองทาง — ใบที่อยู่ในเที่ยวดิบเดียวกัน กับใบที่ชี้มาที่ออเดอร์ของเที่ยวนี้
-- สองชุดนี้มักเป็นชุดเดียวกัน แต่ใบที่ถูกย้ายข้ามเที่ยวมาจะอยู่ในชุดหลังเท่านั้น
-- ถ้าดูแค่ชุดแรกก็จะเหลือใบที่ยังชี้ค้างไว้ แล้วติด foreign key เหมือนเดิม

create or replace function public.admin_force_delete_trip(p_trip_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_trip      public.trips;
  v_pods      int := 0;
  v_orders    int := 0;
  v_bills     int := 0;
  v_tms_trips int := 0;
  v_tms_ids   uuid[];
begin
  if not app.has_perm('users.manage') then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ลบเที่ยวถาวรได้' using errcode = '42501';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  select count(*) into v_pods
    from public.pod p join public.orders o on o.id = p.order_id
   where o.trip_id = p_trip_id;

  select array_agg(distinct t.tms_id) into v_tms_ids
    from public.tms_trips t
   where t.trip_id = p_trip_id;

  /* ใบดิบก่อนเสมอ — ทุกใบที่ชี้มาที่ออเดอร์ของเที่ยวนี้ บวกทุกใบของเที่ยวดิบเดียวกัน */
  delete from public.tms_shipments s
   where s.order_id in (select o.id from public.orders o where o.trip_id = p_trip_id)
      or (v_tms_ids is not null and s.tms_trip_id = any(v_tms_ids));
  get diagnostics v_bills = row_count;

  if v_tms_ids is not null then
    delete from public.tms_trips where tms_id = any(v_tms_ids);
    get diagnostics v_tms_trips = row_count;
  end if;

  /* pod_photos หายเองตาม pod (cascade) เช่นเดียวกับ order_items / trip_drivers /
     trip_locations ที่ผูกกับ orders / trips แบบ cascade อยู่แล้ว */
  delete from public.pod p using public.orders o
   where o.id = p.order_id and o.trip_id = p_trip_id;

  delete from public.orders where trip_id = p_trip_id;
  get diagnostics v_orders = row_count;

  delete from public.trips where id = p_trip_id;

  return json_build_object(
    'trip_no', v_trip.trip_no,
    'deleted_orders', v_orders,
    'deleted_pods', v_pods,
    'deleted_tms_trips', v_tms_trips,
    'deleted_tms_bills', v_bills
  );
end;
$fn$;

grant execute on function public.admin_force_delete_trip(bigint) to authenticated;
