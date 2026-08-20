-- กดส่งผิดร้านแล้วต้องถอยได้
--
-- `deliver_order` เป็นทางเดียว ไม่มีขากลับ คนขับที่กางการ์ดผิดร้านแล้วกด
-- "ส่งร้านนี้เสร็จแล้ว" ทำอะไรไม่ได้อีกเลย ต้องโทรหาออฟฟิศให้ไปแก้ในฐาน
-- เกิดขึ้นจริงแล้วกับใบ TF-20-08-2026-3 (Building VPPW HQ) ซึ่งขึ้นว่าส่งแล้ว
-- ทั้งที่ยังไม่ได้ไป และไม่มีหลักฐานสักชิ้น
--
-- คืนเป็น `in_transit` ไม่ใช่ `assigned` — ใบยังอยู่บนรถที่กำลังวิ่ง สถานะนั้น
-- คือความจริงก่อนกดผิด ส่วน `assigned` แปลว่ายังไม่ออกจากคลัง ซึ่งไม่จริงแล้ว
--
-- ใบที่เก็บหลักฐานไปแล้วถอยไม่ได้ ตั้งใจ: ถอยเงียบ ๆ จะเหลือ POD ที่ผูกกับใบ
-- ที่ระบบบอกว่ายังไม่ได้ส่ง ซึ่งอ่านไม่ออกว่าเกิดอะไรขึ้น และรูปในถังก็ยังอยู่
-- เคสนั้นต้องมีคนตัดสินใจว่าจะลบหลักฐานหรือแก้อะไร ไม่ใช่ปุ่มเดียวจบ
--
-- เที่ยวต้องยังวิ่งอยู่ เที่ยวที่ปิดไปแล้วไม่ใช่เรื่องที่คนขับแก้เองได้อีก
-- รับ `returning` ไว้ด้วยเพราะขั้นกลับคลังกำลังจะมา และตอนนั้นใบก็ยังแก้ได้อยู่

create or replace function public.undo_deliver_order(p_order_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_order public.orders;
  v_trip  public.trips;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  select o.* into v_order
    from public.orders o
   where o.id = p_order_id
     for update;

  if not found then
    raise exception 'ไม่พบใบนี้' using errcode = 'P0002';
  end if;

  if v_order.trip_id is null then
    raise exception 'ใบนี้ไม่ได้อยู่ในเที่ยวไหน' using errcode = 'P0002';
  end if;

  select t.* into v_trip from public.trips t where t.id = v_order.trip_id;

  /* ต้องเป็นเที่ยวของคนที่กด — ด่านเดียวกับ deliver_order ผู้ช่วยก็แก้ได้
     เพราะเขาก็ปิดจุดส่งได้เหมือนกัน คนที่กดผิดควรแก้เองได้ทันที */
  if not (v_trip.driver_id = app.current_driver_id()
          or exists (select 1 from public.trip_drivers td
                      where td.trip_id = v_trip.id
                        and td.driver_id = app.current_driver_id())) then
    raise exception 'ไม่พบใบนี้ในเที่ยวของคุณ' using errcode = 'P0002';
  end if;

  if v_trip.status not in ('in_progress', 'returning') then
    raise exception 'เที่ยวนี้ปิดไปแล้ว แก้เองไม่ได้ — แจ้งออฟฟิศ' using errcode = 'P0001';
  end if;

  if v_order.status <> 'delivered' then
    raise exception 'ใบนี้ยังไม่ได้ปิดส่ง ไม่มีอะไรให้ยกเลิก' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.pod where order_id = p_order_id) then
    raise exception 'ใบนี้เก็บหลักฐานไปแล้ว ยกเลิกเองไม่ได้ — แจ้งออฟฟิศให้แก้ให้'
      using errcode = 'P0001';
  end if;

  update public.orders
     set status = 'in_transit',
         delivered_at = null,
         updated_at = now()
   where id = p_order_id;

  return json_build_object(
    'order_id', p_order_id,
    'order_no', v_order.order_no,
    'pl_no', v_order.tms_picking_list_no
  );
end;
$function$;

grant execute on function public.undo_deliver_order(bigint) to authenticated;
