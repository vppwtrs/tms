-- ลบเที่ยวถาวร: คืน path ของรูปแบบไม่ซ้ำ
--
-- คนขับเซ็นครั้งเดียวที่ร้าน แล้วรูปชุดเดียวกันถูกผูกกับบิลทุกใบของจุดจอดนั้น
-- (พฤติกรรมที่ตั้งใจ ตั้งแต่ตอนย้ายหลักฐานไปเป็นของจุดจอดแทนที่จะเป็นของแต่ละใบ)
-- array_agg จึงเก็บ path เดิมกลับมาใบละครั้ง — จุดจอดที่มีสามบิลกับรูปสามใบ
-- คืนออกมาเก้ารายการ ทั้งที่มีไฟล์จริงสามไฟล์
--
-- ไม่ได้ทำให้อะไรพัง ฝั่งเว็บสั่งลบไฟล์เดิมซ้ำแล้วก็แค่ไม่มีอะไรเกิดขึ้นในรอบหลัง
-- แต่มันทำให้ตัวเลข photos ใน evidence_audit_log อ่านผิดว่าลบรูปไปเก้าใบ
-- ซึ่งเป็นตัวเลขที่คนจะใช้ตอบว่าหลักฐานหายไปเท่าไหร่ จึงต้องเป็นจำนวนไฟล์จริง
--
-- แก้บรรทัดเดียว: array_agg(distinct f.path)
-- ไม่แตะ signature ไม่แตะด่านสิทธิ์ ไม่แตะด่านหลักฐานที่ยืนยันแล้ว
-- ไม่แตะลำดับการลบ และไม่แตะตารางไหนทั้งสิ้น

create or replace function public.admin_force_delete_trip(p_trip_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_trip      public.trips;
  v_pods      int := 0;
  v_verified  int := 0;
  v_orders    int := 0;
  v_bills     int := 0;
  v_tms_trips int := 0;
  v_tms_ids   uuid[];
  v_paths     text[];
begin
  if not app.has_perm('users.manage') then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ลบเที่ยวถาวรได้' using errcode = '42501';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  select count(*), count(*) filter (where p.status = 'verified')
    into v_pods, v_verified
    from public.pod p join public.orders o on o.id = p.order_id
   where o.trip_id = p_trip_id;

  /* ประตูใหม่ — ใบที่มีคนยืนยันแล้วคือใบที่ออฟฟิศรับรองว่าใช้ตอบลูกค้าได้
     ปุ่มที่มีไว้เก็บกวาดข้อมูลทดสอบ ไม่ควรลบของแบบนั้นได้เลยไม่ว่าใครกด
     ต้องยกเลิกการยืนยันก่อนถ้าจะลบจริง ซึ่งเป็นการตัดสินใจคนละอันกับการกดลบ */
  if v_verified > 0 then
    raise exception 'เที่ยวนี้มีหลักฐานที่ยืนยันแล้ว % ใบ ลบถาวรไม่ได้', v_verified
      using errcode = 'P0001';
  end if;

  /* เก็บ path ของรูปไว้ก่อนแถวจะหาย — ลบ storage.objects จากใน SQL ไม่ทำให้ไฟล์จริง
     หายไปด้วย ต้องให้ฝั่งที่มี session ของผู้ใช้เป็นคนสั่งลบผ่าน storage API

     distinct เพราะรูปชุดเดียวถูกผูกกับบิลทุกใบของจุดจอดเดียวกัน */
  select array_agg(distinct f.path) into v_paths
    from public.pod_photos f
    join public.pod p on p.id = f.pod_id
    join public.orders o on o.id = p.order_id
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

  if v_pods > 0 then
    insert into public.evidence_audit_log (actor_user_id, action, trip_no, detail)
    values (app.current_user_id(), 'pod_deleted_with_trip', v_trip.trip_no,
            json_build_object('pods', v_pods, 'orders', v_orders,
                              'photos', coalesce(array_length(v_paths, 1), 0)));
  end if;

  return json_build_object(
    'trip_no', v_trip.trip_no,
    'deleted_orders', v_orders,
    'deleted_pods', v_pods,
    'deleted_tms_trips', v_tms_trips,
    'deleted_tms_bills', v_bills,
    /* ฝั่งเว็บเอาไปสั่งลบไฟล์ต่อ — ลบพลาดก็แค่เหลือไฟล์กำพร้าเท่าเดิม ไม่ย้อนกลับมา
       ทำให้ข้อมูลในฐานผิด จึงไม่ต้องอยู่ในทรานแซกชันเดียวกัน */
    'orphan_photo_paths', coalesce(to_json(v_paths), '[]'::json)
  );
end;
$function$;
