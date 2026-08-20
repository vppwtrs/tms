-- ลบใบสุดท้ายของเที่ยว = เที่ยวนั้นไม่เหลืออะไร ให้หายไปด้วย
--
-- อาการ: กดถังขยะบนหน้าออเดอร์จนใบหมดเที่ยว แล้วเหลือเที่ยวเปล่าค้างในฐาน
-- ถ้าเที่ยวนั้นจบไปแล้วและข้ามวัน มันจะหลุดจากกระดานจัดคิวด้วย (กระดานโหลดเฉพาะ
-- เที่ยวที่ยังไม่จบ กับที่จบวันนี้) กลายเป็นแถวที่ไม่มีหน้าไหนในระบบลบได้อีกเลย
-- ต้องไปสวมรอยเรียก RPC ใน SQL Editor ซึ่งทิ้งไฟล์รูปกำพร้าไว้ทุกครั้ง
--
-- ต้นเหตุ: `remove_order` ลบใบ ปลดใบดิบ แล้วจบ ไม่เคยมองว่าเที่ยวเหลืออะไรไหม
-- เที่ยวที่ไม่มีใบสักใบไม่ใช่งาน มันคือแถวเปล่า และการเก็บมันไว้ไม่ได้รักษาอะไร
--
-- ทำตามท่าเดียวกับ `dispatch_cancel_trip` ตอนเก็บกวาดเที่ยวทิ้ง: ปลด tms_trips ก่อน
-- (FK กันการลบไว้) แล้วคืนรถกับคนขับให้ว่าง ไม่งั้นรถค้างสถานะ "ติดงาน" กับเที่ยว
-- ที่ไม่มีอยู่แล้ว ซึ่งกันไม่ให้จ่ายงานคันนั้นได้อีก
--
-- ไม่แตะเส้นทางถอนใบออกจากเที่ยวบนกระดาน — นั่นคือ `remove_order_from_trip`
-- คนละฟังก์ชัน ตั้งใจให้เที่ยวว่างแล้วยังอยู่ เพราะคนวางแผนกำลังจัดใบใหม่เข้าไป
--
-- ไม่แตะด่านหลักฐาน: ใบที่มี POD แล้วยังลบไม่ได้เหมือนเดิม เที่ยวจึงไม่มีทางถูกกวาด
-- ทิ้งไปพร้อมหลักฐานโดยบังเอิญ

create or replace function public.remove_order(p_order_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order   public.orders;
  v_trip    public.trips;
  v_left    int := 0;
  v_swept   boolean := false;
  v_drivers bigint[];
begin
  if not app.has_perm('orders.write') then
    raise exception 'ไม่มีสิทธิ์แก้ออเดอร์' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ไม่พบออเดอร์นี้' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.pod where order_id = p_order_id) then
    raise exception 'ใบนี้มีหลักฐานการส่งมอบแล้ว ลบไม่ได้' using errcode = 'P0001';
  end if;

  update public.tms_shipments set order_id = null where order_id = p_order_id;
  delete from public.order_items where order_id = p_order_id;
  delete from public.orders where id = p_order_id;

  /* ใบที่เพิ่งลบเคยอยู่ในเที่ยวไหม และเที่ยวนั้นยังเหลือใบอื่นอีกหรือเปล่า */
  if v_order.trip_id is not null then
    select * into v_trip from public.trips where id = v_order.trip_id for update;

    if found then
      select count(*) into v_left from public.orders where trip_id = v_trip.id;

      if v_left = 0 then
        select array_agg(driver_id) into v_drivers
          from public.trip_drivers where trip_id = v_trip.id;

        /* ปลดก่อนลบ ไม่งั้น FK ของ tms_trips กันการลบไว้
           ใบดิบของเที่ยวถูกปลดไปแล้วทีละใบข้างบน จึงกลับไปสั่งงานใหม่ได้ครบ */
        update public.tms_trips set trip_id = null where trip_id = v_trip.id;

        /* trip_drivers กับ trip_locations หายตามแบบ cascade */
        delete from public.trips where id = v_trip.id;

        update public.vehicles set status = 'available' where id = v_trip.vehicle_id;
        update public.drivers set status = 'available'
         where id = v_trip.driver_id
            or id = any(coalesce(v_drivers, array[]::bigint[]));

        v_swept := true;
      end if;
    end if;
  end if;

  return json_build_object(
    'deleted', p_order_id,
    'order_no', v_order.order_no,
    /* ฝั่งเว็บเอาไปบอกคนกดว่าเที่ยวหายไปด้วย ไม่ใช่แค่ใบ */
    'trip_removed', v_swept,
    'trip_no', case when v_swept then v_trip.trip_no else null end
  );
end;
$function$;
