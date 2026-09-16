-- ปักหมุดร้านอัตโนมัติจากพิกัดตอนปิดงาน (POD) — ผูกกับปุ่มปิดงานเดิม ไม่เพิ่มปุ่มใหม่
--
-- ปุ่มนำทางเดิมยิง Google Maps ด้วยที่อยู่เป็นข้อความ (geocode เดา) ที่อยู่จาก TMS
-- มักสั้นห้วน พาไปผิดจุดได้ ทุกครั้งที่คนขับปิดงานอยู่แล้วมีการขอพิกัด GPS ของเครื่อง
-- ส่งมาพร้อม POD (ดู PodSheet.tsx) — เก็บพิกัดนั้นไว้ที่ลูกค้าครั้งแรกที่มี แล้วให้
-- ปุ่มนำทางของทุกออเดอร์ในอนาคตของร้านเดียวกันใช้พิกัดนี้แทนที่อยู่เป็นข้อความ
--
-- เขียนทับเฉพาะตอนยังไม่มีพิกัด (first-write-wins) — พิกัดตอนปิดงานอาจคลาดเคลื่อนได้
-- (จอดรถห่างจากประตูร้าน, GPS อ่อนสัญญาณในตึก) ไม่ยอมให้ทับพิกัดที่ตั้งไว้แล้ว
-- อัตโนมัติ การแก้พิกัดที่ผิดเป็นงานฝั่งออฟฟิศที่ต้องทำเอง (ยังไม่ทำรอบนี้)

alter table public.customers
  add column if not exists lat double precision,
  add column if not exists lng double precision;

create or replace function public.save_pod(
  p_order_id bigint,
  p_recipient_name text,
  p_signature_data text,
  p_photo_path text default null::text,
  p_notes text default null::text,
  p_lat double precision default null::double precision,
  p_lng double precision default null::double precision
)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_id bigint;
  v_customer_id bigint;
begin
  if not app.has_perm('myjobs.pod') and not app.has_perm('pod.write') then
    raise exception 'ไม่มีสิทธิ์เก็บหลักฐานการส่งมอบ' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.orders o
      join public.trips t on t.id = o.trip_id
     where o.id = p_order_id
       and o.status = 'delivered'
       and (t.driver_id = app.current_driver_id()
            or exists (select 1 from public.trip_drivers td
                        where td.trip_id = t.id
                          and td.driver_id = app.current_driver_id())
            or app.has_perm('pod.write'))
  ) then
    raise exception 'ออเดอร์นี้ยังไม่ได้ปิด หรือไม่ใช่งานของคุณ' using errcode = 'P0002';
  end if;

  insert into public.pod (order_id, recipient_name, signature_data, photo_path,
                          notes, lat, lng, collected_by, collected_at)
  values (p_order_id, p_recipient_name, p_signature_data, p_photo_path,
          p_notes, p_lat, p_lng, app.current_user_id(), now())
  on conflict (order_id) do update
     set recipient_name = excluded.recipient_name,
         signature_data = excluded.signature_data,
         photo_path     = excluded.photo_path,
         notes          = excluded.notes,
         updated_at     = now()
   where public.pod.status = 'collected'
  returning id into v_id;

  if v_id is null then
    raise exception 'หลักฐานใบนี้ถูกยืนยันแล้ว แก้ไขไม่ได้' using errcode = 'P0001';
  end if;

  /* ปักหมุดร้านครั้งแรกที่มีพิกัด — ออเดอร์ที่ยังไม่ได้จับคู่ลูกค้า (customer_id ว่าง)
     ข้ามไปเฉย ๆ ไม่มีที่เก็บ ไม่ใช่ความผิดพลาด */
  if p_lat is not null and p_lng is not null then
    select o.customer_id into v_customer_id from public.orders o where o.id = p_order_id;
    if v_customer_id is not null then
      update public.customers
         set lat = p_lat, lng = p_lng
       where id = v_customer_id
         and lat is null and lng is null;
    end if;
  end if;

  return v_id;
end;
$function$;

-- ส่งพิกัดร้านไปให้จอคนขับด้วย — ที่มาของปุ่มนำทางที่แม่นกว่าที่อยู่เป็นข้อความ
create or replace view public.my_orders as
 select o.id,
    o.order_no,
    o.trip_id,
    o.status,
    o.priority,
    o.origin,
    o.destination,
    o.distance_km,
    o.goods_desc,
    o.weight_kg,
    o.scheduled_at,
    o.delivered_at,
    o.notes,
    o.tms_trip_no,
    o.tms_picking_list_no,
    o.tms_unit_count,
    o.work_kind,
    o.seq,
    c.name as customer_name,
    c.phone as customer_phone,
    c.address as customer_address,
    (exists ( select 1
           from pod p
          where p.order_id = o.id)) as has_pod,
    o.cancel_reason,
    o.cancelled_at,
    /* ต่อท้ายสุด — CREATE OR REPLACE VIEW ห้ามแทรกคอลัมน์ใหม่กลางลิสต์เดิม
       (Postgres ยึดตำแหน่งคอลัมน์เดิมทั้งหมด แทรกกลางแล้วชน 42P16 ทันที) */
    c.lat as customer_lat,
    c.lng as customer_lng
   from orders o
     join trips t on t.id = o.trip_id
     left join customers c on c.id = o.customer_id
  where app.has_perm('myjobs.view'::text) and (t.driver_id = app.current_driver_id() or (exists ( select 1
           from trip_drivers td
          where td.trip_id = t.id and td.driver_id = app.current_driver_id())));
