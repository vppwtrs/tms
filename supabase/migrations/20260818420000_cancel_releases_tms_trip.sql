-- ยกเลิกแล้วต้องนำเข้าใหม่ได้
--
-- ของเดิม: ยกเลิกเที่ยวคืนออเดอร์เป็น "รอจัดคิว" ค้างไว้ ส่วน tms_trips.trip_id ยังชี้อยู่
-- หน้าเที่ยวจาก TMS จึงขึ้นว่า "นำเข้าแล้ว" ตลอดไป สั่งงานใหม่ไม่ได้อีกเลย
-- และในหน้าออเดอร์เหลือใบยกเลิกลอยอยู่โดยไม่มีใครใช้ต่อ
--
-- การนำเข้าผิดคน ผิดเที่ยว หรือกดพลาด เป็นเรื่องปกติของงานหน้างาน ทางออกที่ควรมีคือ
-- "ถอยกลับไปเป็นเหมือนไม่เคยกด" ไม่ใช่ "ทิ้งซากไว้แล้วห้ามแตะอีก"
--
-- กติกาความปลอดภัยข้อเดียวที่ตั้งไว้: **มีหลักฐานการส่งมอบแล้วห้ามลบ**
-- POD คือสิ่งที่ยืนยันว่าของถึงมือคนรับจริง เที่ยวแบบนั้นให้ปิดงานตามจริง ไม่ใช่ล้างทิ้ง

-- ของเดิมคืน void ต้อง drop ก่อน เปลี่ยนชนิดที่คืนด้วย create or replace ไม่ได้
drop function if exists public.dispatch_cancel_trip(bigint);

create or replace function public.dispatch_cancel_trip(p_trip_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_trip    public.trips;
  v_pods    int;
  v_orders  int;
  v_drivers bigint[];
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;
  if v_trip.status = 'completed' then
    raise exception 'เที่ยวนี้ปิดงานไปแล้ว ยกเลิกไม่ได้' using errcode = 'P0001';
  end if;

  select count(*) into v_pods
    from public.pod p
    join public.orders o on o.id = p.order_id
   where o.trip_id = p_trip_id;

  if v_pods > 0 then
    raise exception 'ยกเลิกไม่ได้ — เที่ยวนี้มีหลักฐานการส่งมอบแล้ว % ใบ ให้ปิดงานตามจริงแทน',
      v_pods using errcode = 'P0001';
  end if;

  select array_agg(driver_id) into v_drivers
    from public.trip_drivers where trip_id = p_trip_id;

  /* ใบดิบจาก TMS ต้องกลับไปเป็น "ยังไม่ถูกสั่งงาน" ไม่งั้นสั่งใหม่แล้วใบจะไม่ตามมา */
  update public.tms_shipments s
     set order_id = null
    from public.orders o
   where o.trip_id = p_trip_id and s.order_id = o.id;

  select count(*) into v_orders from public.orders where trip_id = p_trip_id;

  delete from public.order_items i
   using public.orders o
   where o.id = i.order_id and o.trip_id = p_trip_id;

  delete from public.orders where trip_id = p_trip_id;

  /* ตำแหน่งที่บันทึกไว้หายไปพร้อมเที่ยว (on delete cascade) — เป็นร่องรอยของงาน
     ที่ถือว่าไม่เคยเกิด ไม่ใช่หลักฐานที่ต้องเก็บ */
  delete from public.trip_drivers where trip_id = p_trip_id;

  /* ปลดก่อนลบ ไม่งั้น FK ของ tms_trips กันการลบไว้ */
  update public.tms_trips set trip_id = null where trip_id = p_trip_id;

  delete from public.trips where id = p_trip_id;

  update public.vehicles set status = 'available' where id = v_trip.vehicle_id;
  update public.drivers set status = 'available'
   where id = v_trip.driver_id
      or id = any(coalesce(v_drivers, array[]::bigint[]));

  return json_build_object('deleted_orders', v_orders, 'trip_id', p_trip_id);
end;
$function$;

/* ยกเลิกใบเดียวในเที่ยว — ลบใบนั้นทิ้งแล้วคืนใบดิบให้สั่งใหม่ได้เหมือนกัน
   เหลือใบอื่นในเที่ยวก็ไม่แตะ เที่ยวยังวิ่งต่อได้ตามปกติ */
create or replace function public.remove_order(p_order_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders;
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

  return json_build_object('deleted', p_order_id, 'order_no', v_order.order_no);
end;
$function$;

grant execute on function public.remove_order(bigint) to authenticated;

-- ล้างซากที่ค้างจากพฤติกรรมเดิม: ใบที่ถูกยกเลิกและไม่มีหลักฐานการส่งมอบ
do $$
declare v_n int;
begin
  update public.tms_shipments s
     set order_id = null
    from public.orders o
   where s.order_id = o.id
     and o.status = 'cancelled'
     and not exists (select 1 from public.pod p where p.order_id = o.id);

  delete from public.order_items i
   using public.orders o
   where o.id = i.order_id
     and o.status = 'cancelled'
     and not exists (select 1 from public.pod p where p.order_id = o.id);

  with gone as (
    delete from public.orders o
     where o.status = 'cancelled'
       and not exists (select 1 from public.pod p where p.order_id = o.id)
    returning 1
  )
  select count(*) into v_n from gone;

  raise notice 'ลบออเดอร์ที่ยกเลิกค้างไว้ % ใบ', v_n;
end;
$$;

-- เที่ยวที่ถูกยกเลิกไว้ก่อนหน้านี้ ปลดออกจากเที่ยวดิบให้สั่งงานใหม่ได้
update public.tms_trips t
   set trip_id = null
  from public.trips tr
 where tr.id = t.trip_id and tr.status = 'cancelled';
