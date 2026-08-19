-- ลบถาวรต้องลบข้อมูลดิบจาก TMS ด้วย
--
-- ของเดิมลบเฉพาะฝั่งงาน (trips/orders/pod) แล้ว "ปลดล็อก" แถวดิบกลับไปเป็นยังไม่ถูกสั่งงาน
-- ด้วยการเซ็ต tms_trips.trip_id = null และ tms_shipments.order_id = null
--
-- เจตนาตอนนั้นคือให้นำเข้าใหม่ได้ทันที แต่ผลจริงคือเที่ยวเดิมยังนั่งอยู่ในหน้างานจาก TMS
-- พร้อมข้อมูลชุดเดิมทุกอย่าง ซึ่งไม่ใช่สิ่งที่คนกดปุ่มนี้ต้องการ ปุ่มนี้มีไว้สำหรับ
-- กรณีทดสอบและกรณีที่ข้อมูลเสีย — ทั้งสองกรณีต้องการ "ให้มันหายไปจริง ๆ" แล้วดึงใหม่
-- จากต้นทางให้สะอาด ไม่ใช่เก็บซากไว้ให้กดนำเข้าซ้ำจากข้อมูลชุดที่มีปัญหาอยู่แล้ว
--
-- ลบแล้วดึงกลับมาได้ตามปกติ: ต้นทางคือ TMS ไม่ใช่เรา รอบดึงถัดไปที่ครอบคลุมวันนั้น
-- จะพาเที่ยวกลับมาเองถ้าต้นทางยังมีอยู่ ถ้าต้นทางไม่มีแล้วก็ควรหายไปอยู่ดี
--
-- ยังเป็นสิทธิ์ผู้ดูแลระบบเท่านั้น (users.manage) และยังทำในทรานแซกชันเดียวเหมือนเดิม
-- ไฟล์รูป POD ใน Storage ยังไม่ถูกแตะด้วยเหตุผลเดิม — ไฟล์กำพร้าไม่ทำใครเดือดร้อน
-- ส่วนการไล่ลบไฟล์ผิดใบทำให้หลักฐานของงานจริงหายแบบกู้ไม่ได้

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

  /* เก็บรหัสเที่ยวฝั่ง TMS ไว้ก่อน — ต้องรู้ตั้งแต่ตอนนี้ว่าจะตามลบแถวดิบชุดไหน
     หลังลบ orders ไปแล้วเส้นทางที่โยงกลับไปหาใบดิบจะขาด */
  select array_agg(distinct t.tms_id) into v_tms_ids
    from public.tms_trips t
   where t.trip_id = p_trip_id;

  /* pod_photos หายเองตาม pod (cascade) เช่นเดียวกับ order_items / trip_drivers /
     trip_locations ที่ผูกกับ orders / trips แบบ cascade อยู่แล้ว */
  delete from public.pod p using public.orders o
   where o.id = p.order_id and o.trip_id = p_trip_id;

  delete from public.orders where trip_id = p_trip_id;
  get diagnostics v_orders = row_count;

  delete from public.trips where id = p_trip_id;

  /* ข้อมูลดิบของเที่ยวนี้ไปด้วยทั้งชุด ใบก่อนเที่ยว เพราะใบอ้างถึงเที่ยว */
  if v_tms_ids is not null then
    delete from public.tms_shipments where tms_trip_id = any(v_tms_ids);
    get diagnostics v_bills = row_count;

    delete from public.tms_trips where tms_id = any(v_tms_ids);
    get diagnostics v_tms_trips = row_count;
  end if;

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
