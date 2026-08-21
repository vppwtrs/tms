-- ตรวจหลักฐานซ้ำตอนจบงาน ไม่ใช่แค่ตอนปิดงานที่ร้านสุดท้าย
--
-- complete_trip กันไว้อยู่แล้วว่าต้องมีลายเซ็นและรูปครบทุกใบก่อนเที่ยวจะขึ้นเป็น
-- 'returning' แต่ระหว่างที่รถวิ่งกลับคลัง ของยังเปลี่ยนได้: ออฟฟิศถอนตรวจแล้วลบรูป
-- ที่ถ่ายผิด คนวางแผนเพิ่มใบเข้าเที่ยวที่กำลังกลับ หรือคนขับกดยกเลิกการส่งที่กดผิดร้าน
-- เที่ยวที่ผ่านด่านแรกมาแล้วจึงกลับมาขาดหลักฐานได้อีก
--
-- จบงานคือประตูสุดท้าย หลังจากนี้เที่ยวไปอยู่ในประวัติ รถถูกนับว่าว่าง และคนที่ต้อง
-- ตามเก็บหลักฐานคือออฟฟิศ ซึ่งตามจากโต๊ะไม่ได้ ด่านนี้จึงต้องอยู่ฝั่งฐาน
-- ไม่ใช่ฝั่งหน้าจอ — หน้าจอบอกได้ว่าปุ่มไม่ควรกด แต่กันคนที่ยิงตรงมาไม่ได้

create or replace function public.finish_return(p_trip_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_me      bigint := app.current_driver_id();
  v_primary bigint;
  v_trip    public.trips;
  v_nopod   integer;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  select * into v_trip from public.trips where id = p_trip_id;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  v_primary := app.trip_primary_driver(p_trip_id);
  if v_primary is distinct from v_me then
    raise exception 'ปิดเที่ยวได้เฉพาะคนขับหลัก' using errcode = 'P0001';
  end if;

  -- นับใบที่ส่งแล้วแต่ยังไม่มีหลักฐานพร้อมรูป — เงื่อนไขเดียวกับใน complete_trip
  select count(*) into v_nopod
    from public.orders o
   where o.trip_id = p_trip_id
     and o.status = 'delivered'
     and not exists (
       select 1 from public.pod p
        join public.pod_photos f on f.pod_id = p.id
       where p.order_id = o.id
     );

  if v_nopod > 0 then
    raise exception 'ยังเก็บหลักฐานไม่ครบ เหลืออีก % ใบ — เก็บให้ครบก่อนจบงาน', v_nopod
      using errcode = 'P0001';
  end if;

  update public.trips
     set status = 'completed',
         returned_at = coalesce(returned_at, now())
   where id = p_trip_id and status = 'returning';

  if not found then
    raise exception 'เที่ยวนี้ไม่ได้อยู่ระหว่างกลับคลัง' using errcode = 'P0001';
  end if;

  /* คืนของตรงนี้แทน ไม่ใช่ตอนปิดงานที่ร้านสุดท้าย */
  update public.vehicles set status = 'available' where id = v_trip.vehicle_id;
  update public.drivers set status = 'available'
   where id in (select driver_id from public.trip_drivers where trip_id = p_trip_id)
      or id = v_trip.driver_id
      or id = v_me;

  return json_build_object('trip_id', p_trip_id, 'trip_no', v_trip.trip_no);
end;
$function$;

grant execute on function public.finish_return(bigint) to authenticated;
