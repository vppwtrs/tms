-- ทุกเส้นทางที่ปิด/ยกเลิกเที่ยว ต้องคืนสถานะให้คนขับ "ทุกคน" ของเที่ยวนั้น
--
-- ทั้งสามฟังก์ชันเขียนไว้ว่า where id = v_driver ซึ่งคือคนขับหลักคนเดียว
-- ตั้งแต่มี trip_drivers แล้ว ให้ยึดตารางนั้นเป็นแหล่งความจริงว่าใครอยู่บนรถคันนี้บ้าง
-- ยังเผื่อ trips.driver_id ไว้ด้วย สำหรับเที่ยวเก่าที่อาจไม่มีแถวใน trip_drivers

create or replace function public.dispatch_complete_trip(p_trip_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_vehicle bigint;
  v_driver  bigint;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  update public.trips set status = 'completed', arrived_at = coalesce(arrived_at, now())
   where id = p_trip_id and status = 'in_progress'
  returning vehicle_id, driver_id into v_vehicle, v_driver;
  if not found then
    raise exception 'ปิดได้เฉพาะเที่ยวที่กำลังวิ่งอยู่' using errcode = 'P0001';
  end if;

  update public.orders
     set status = 'delivered', delivered_at = coalesce(delivered_at, now()), updated_at = now()
   where trip_id = p_trip_id and status = 'in_transit';

  update public.vehicles set status = 'available' where id = v_vehicle;
  update public.drivers set status = 'available'
   where id = v_driver
      or id in (select driver_id from public.trip_drivers where trip_id = p_trip_id);
end;
$fn$;

create or replace function public.dispatch_cancel_trip(p_trip_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_vehicle bigint;
  v_driver  bigint;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  update public.trips set status = 'cancelled'
   where id = p_trip_id and status in ('planned', 'in_progress')
  returning vehicle_id, driver_id into v_vehicle, v_driver;
  if not found then
    raise exception 'ยกเลิกได้เฉพาะเที่ยวที่ยังไม่จบ' using errcode = 'P0001';
  end if;

  update public.orders set status = 'pending', trip_id = null, updated_at = now()
   where trip_id = p_trip_id and status in ('assigned', 'in_transit');

  update public.vehicles set status = 'available' where id = v_vehicle;
  update public.drivers set status = 'available'
   where id = v_driver
      or id in (select driver_id from public.trip_drivers where trip_id = p_trip_id);
end;
$fn$;

-- ปุ่มของคนขับเอง — คนที่สองกดปิดได้ด้วย เพราะเขาก็อยู่บนรถคันเดียวกัน
create or replace function public.complete_trip(p_trip_id bigint)
returns void
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_pending integer;
  v_me      bigint := app.current_driver_id();
  v_mine    boolean;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  select (t.driver_id = v_me
          or exists (select 1 from public.trip_drivers td
                      where td.trip_id = t.id and td.driver_id = v_me))
    into v_mine
    from public.trips t
   where t.id = p_trip_id;

  if not coalesce(v_mine, false) then
    raise exception 'ไม่พบเที่ยวนี้ หรือไม่ใช่เที่ยวของคุณ' using errcode = 'P0002';
  end if;

  select count(*) into v_pending
    from public.orders o
   where o.trip_id = p_trip_id
     and o.status not in ('delivered', 'cancelled');

  if v_pending > 0 then
    raise exception 'ยังส่งไม่ครบ เหลืออีก % จุด', v_pending using errcode = 'P0001';
  end if;

  update public.trips
     set status = 'completed', arrived_at = coalesce(arrived_at, now())
   where id = p_trip_id and status = 'in_progress';

  if not found then
    raise exception 'ปิดได้เฉพาะเที่ยวที่กำลังวิ่งอยู่' using errcode = 'P0001';
  end if;

  update public.drivers set status = 'available'
   where id in (select driver_id from public.trip_drivers where trip_id = p_trip_id)
      or id = v_me;

  update public.vehicles v set status = 'available'
    from public.trips t
   where t.id = p_trip_id and v.id = t.vehicle_id;
end;
$fn$;
