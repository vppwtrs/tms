/* 0004 — ทางเข้าฝั่งคนขับ
 *
 * ทำไมคนขับไม่ได้ policy บน trips/orders ตรง ๆ:
 * RLS กันได้แค่ "แถวไหน" กัน "คอลัมน์ไหน" ไม่ได้  แต่ trips มี fuel_cost/toll_cost/other_cost
 * และ orders มี fee  ให้ policy select ไปเมื่อไหร่ คนขับยิง PostgREST เลือกคอลัมน์เองได้ทันที
 * — กฎเดิมของโปรเจ็คคือ "ห้ามให้ตัวเลขเงินโผล่ในหน้าคนขับ" ซึ่งของเดิมทำโดยไม่ SELECT มาให้
 * ตั้งแต่ repository  ที่นี่ใช้วิธีเดียวกัน: view ที่ไม่มีคอลัมน์เงินอยู่ในนั้นเลย
 *
 * view พวกนี้ตั้ง security_invoker = off โดยตั้งใจ (ค่า default ของ Postgres อยู่แล้ว
 * แต่เขียนไว้ให้ชัดเพราะมันคือหัวใจ) — view ทำงานด้วยสิทธิ์ของเจ้าของ จึงข้าม RLS
 * ของ trips/orders ได้  ตัวกรองความปลอดภัยคือ where ในตัว view เอง ห้ามลบเด็ดขาด
 */

create view public.my_trips with (security_invoker = off) as
  select t.id,
         t.trip_no,
         t.status,
         t.departed_at,
         t.arrived_at,
         t.notes,
         v.plate_no,
         v.vehicle_type
    from public.trips t
    join public.vehicles v on v.id = t.vehicle_id
   where t.driver_id = app.current_driver_id()
     and app.has_perm('myjobs.view');

comment on view public.my_trips is
  'เที่ยวของคนขับที่ล็อกอินอยู่ — ไม่มีคอลัมน์ต้นทุนใด ๆ โดยตั้งใจ';

create view public.my_orders with (security_invoker = off) as
  select o.id,
         o.order_no,
         o.trip_id,
         o.status,
         o.priority,
         o.origin,
         o.destination,
         o.goods_desc,
         o.weight_kg,
         o.scheduled_at,
         o.delivered_at,
         o.notes,
         c.name  as customer_name,
         c.phone as customer_phone,
         exists (select 1 from public.pod p where p.order_id = o.id) as has_pod
    from public.orders o
    join public.trips t     on t.id = o.trip_id
    left join public.customers c on c.id = o.customer_id
   where t.driver_id = app.current_driver_id()
     and app.has_perm('myjobs.view');

comment on view public.my_orders is
  'จุดส่งของในเที่ยวตัวเอง — ไม่มีคอลัมน์ fee';

/* revoke ใน 0003 รันไปก่อนที่ view สองตัวนี้จะเกิด และ Supabase แจก grant ให้ anon
   กับทุก object ใหม่ใน public อัตโนมัติ — ต้องตัดซ้ำตรงนี้ ไม่งั้น anon ถือสิทธิ์เต็มบน view
   ที่ security_invoker = off ซึ่งเป็น view ที่ข้าม RLS ได้ตามออกแบบ */
revoke all on public.my_trips, public.my_orders from anon;
grant select on public.my_trips, public.my_orders to authenticated;

/* ===== การกระทำของคนขับ =====
 * ทั้งหมดเป็นฟังก์ชัน ไม่ใช่ update ตรง เพราะคนขับไม่มีสิทธิ์เขียน orders/trips
 * และเพราะ logic พวกนี้ต้องอยู่ที่เดียว ไม่ใช่กระจายอยู่ในหน้าจอ
 */

create or replace function public.start_trip(p_trip_id bigint)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  update public.trips
     set status = 'in_progress',
         departed_at = coalesce(departed_at, now())
   where id = p_trip_id
     and driver_id = app.current_driver_id()
     and status = 'planned';

  if not found then
    raise exception 'ไม่พบเที่ยวนี้ หรือไม่ใช่เที่ยวของคุณ' using errcode = 'P0002';
  end if;

  update public.orders set status = 'in_transit', updated_at = now()
   where trip_id = p_trip_id and status = 'assigned';
end;
$$;

/* ปิดการส่งทีละจุด — ตรงกับ POST /api/my-jobs/orders/:id/deliver ของเดิม
   ต้องมีเพราะเที่ยวหนึ่งมีหลายร้าน และ POD รับเฉพาะออเดอร์ที่ delivered แล้ว
   ถ้าไม่มีทางปิดทีละจุด คนขับจะเก็บลายเซ็นร้านแรกไม่ได้จนกว่าจะวิ่งครบทุกร้าน */
create or replace function public.deliver_order(p_order_id bigint)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  update public.orders o
     set status = 'delivered',
         delivered_at = coalesce(o.delivered_at, now()),
         updated_at = now()
    from public.trips t
   where o.id = p_order_id
     and t.id = o.trip_id
     and t.driver_id = app.current_driver_id()
     and o.status not in ('delivered', 'cancelled');

  if not found then
    raise exception 'ไม่พบออเดอร์นี้ในเที่ยวของคุณ หรือปิดไปแล้ว' using errcode = 'P0002';
  end if;
end;
$$;

/* ปิดเที่ยว — เหมาออเดอร์ที่เหลือเป็น delivered ให้หมด เหมือน trips.complete() เดิม
   นี่คือเหตุผลที่มันต้องอยู่ในฟังก์ชัน ไม่ใช่ปล่อยให้หน้าจอยิง update เอง:
   ถ้าคนขับสั่งได้เอง เขาปิดงานที่ยังไม่ได้ส่งได้ทั้งเที่ยว */
create or replace function public.complete_trip(p_trip_id bigint)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_pending integer;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  /* หน้าจอ disable ปุ่มไว้อยู่แล้วจนกว่าจะส่งครบ แต่ปุ่มที่ disable กันคนที่ยิง API ตรงไม่ได้
     กฎจริงต้องอยู่ตรงนี้ */
  select count(*) into v_pending
    from public.orders o
    join public.trips t on t.id = o.trip_id
   where o.trip_id = p_trip_id
     and t.driver_id = app.current_driver_id()
     and o.status not in ('delivered', 'cancelled');

  if v_pending > 0 then
    raise exception 'ยังส่งไม่ครบ เหลืออีก % จุด', v_pending using errcode = 'P0001';
  end if;

  update public.trips
     set status = 'completed',
         arrived_at = coalesce(arrived_at, now())
   where id = p_trip_id
     and driver_id = app.current_driver_id()
     and status = 'in_progress';

  if not found then
    raise exception 'ไม่พบเที่ยวนี้ หรือไม่ใช่เที่ยวของคุณ' using errcode = 'P0002';
  end if;

  update public.drivers set status = 'available' where id = app.current_driver_id();
end;
$$;

create or replace function public.save_pod(
  p_order_id       bigint,
  p_recipient_name text,
  p_signature_data text,
  p_photo_path     text default null,
  p_notes          text default null,
  p_lat            double precision default null,
  p_lng            double precision default null
)
returns bigint
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_id bigint;
begin
  if not app.has_perm('myjobs.pod') and not app.has_perm('pod.write') then
    raise exception 'ไม่มีสิทธิ์เก็บหลักฐานการส่งมอบ' using errcode = '42501';
  end if;

  /* รับเฉพาะออเดอร์ที่ปิดแล้วและเป็นของคนขับคนนี้ — เงื่อนไขเดิมของ pod.create() */
  if not exists (
    select 1 from public.orders o
      join public.trips t on t.id = o.trip_id
     where o.id = p_order_id
       and o.status = 'delivered'
       and (t.driver_id = app.current_driver_id() or app.has_perm('pod.write'))
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
   /* ใบที่ยืนยันแล้วล็อกถาวร เขียนทับไม่ได้แม้แต่คนที่เก็บเอง */
   where public.pod.status = 'collected'
  returning id into v_id;

  if v_id is null then
    raise exception 'หลักฐานใบนี้ถูกยืนยันแล้ว แก้ไขไม่ได้' using errcode = 'P0001';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.start_trip, public.deliver_order,
                          public.complete_trip, public.save_pod from public;
grant execute on function public.start_trip, public.deliver_order,
                         public.complete_trip, public.save_pod to authenticated;
