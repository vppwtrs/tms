-- ลบเที่ยวถาวร สำหรับข้อมูลทดสอบ
--
-- `dispatch_cancel_trip` ปฏิเสธเที่ยวที่มี POD แล้วโดยตั้งใจ — POD คือหลักฐานว่าของถึงมือ
-- คนรับจริง ลบทิ้งเงียบ ๆ ไม่ได้ กติกานั้นยังอยู่เหมือนเดิม ไม่ได้ถูกผ่อน
--
-- แต่ระหว่างทดสอบระบบ คนกดเล่นจนเกิดเที่ยวที่มี POD ทดสอบค้างอยู่ ซึ่งลบผ่านหน้าจอไม่ได้เลย
-- และการให้คนไปไล่ลบเองใน SQL Editor ทีละตารางคือวิธีที่พลาดง่ายที่สุด — ลำดับผิดแล้วติด
-- foreign key ครึ่งทาง เหลือข้อมูลค้างที่ไม่มีใครเห็นและไม่มีใครตามเก็บ
--
-- ฟังก์ชันนี้ลบให้ครบทั้งชุดในทรานแซกชันเดียว จำกัดไว้ที่ผู้ดูแลระบบเท่านั้น (users.manage)

create or replace function public.admin_force_delete_trip(p_trip_id bigint)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_trip   public.trips;
  v_pods   int := 0;
  v_orders int := 0;
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

  /* ใบดิบจาก TMS กลับไปเป็น "ยังไม่ถูกสั่งงาน" — ไม่งั้นนำเข้าใหม่แล้วใบจะไม่ตามมา */
  update public.tms_shipments s
     set order_id = null
    from public.orders o
   where o.trip_id = p_trip_id and s.order_id = o.id;

  update public.tms_trips set trip_id = null where trip_id = p_trip_id;

  /* pod_photos หายเองตาม pod (cascade) เช่นเดียวกับ order_items / trip_drivers /
     trip_locations ที่ผูกกับ orders / trips แบบ cascade อยู่แล้ว */
  delete from public.pod p using public.orders o
   where o.id = p.order_id and o.trip_id = p_trip_id;

  delete from public.orders where trip_id = p_trip_id;
  get diagnostics v_orders = row_count;

  delete from public.trips where id = p_trip_id;

  /* ไฟล์รูป POD ใน Storage ไม่ถูกลบด้วย — ลบแถวในฐานไม่แตะถังเก็บไฟล์
     ตั้งใจปล่อยไว้: ไฟล์กำพร้าไม่ทำใครเดือดร้อน ส่วนการไล่ลบไฟล์ผิดใบ
     ทำให้หลักฐานของงานจริงหายแบบกู้ไม่ได้ */
  return json_build_object(
    'trip_no', v_trip.trip_no,
    'deleted_orders', v_orders,
    'deleted_pods', v_pods
  );
end;
$fn$;

grant execute on function public.admin_force_delete_trip(bigint) to authenticated;
