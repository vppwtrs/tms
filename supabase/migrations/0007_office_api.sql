/* 0007 — ทางเข้าฝั่งออฟฟิศ
 *
 * เหตุผลเดียวกับ 0004 แต่คนละเหตุผลกับที่คนคิด:
 * ฝั่งคนขับต้องเป็นฟังก์ชันเพราะ "กันไม่ให้ทำเกินสิทธิ์"
 * ฝั่งออฟฟิศต้องเป็นฟังก์ชันเพราะ "หลายแถวต้องเปลี่ยนพร้อมกันหรือไม่เปลี่ยนเลย"
 *
 * ตอนอยู่บน Express ตัว service ห่อด้วย db.transaction() ให้ทั้งก้อน
 * พอย้ายมา PostgREST หน้าจอยิงทีละ request — ยิงสร้างเที่ยวผ่าน แล้ว browser ปิดกลางคัน
 * ออเดอร์ก็ค้างเป็น assigned โดยไม่มีเที่ยว รถค้างเป็น on_trip ตลอดกาล
 * งานที่แตะเกินหนึ่งตารางจึงต้องอยู่ในฟังก์ชันเดียว ไม่ใช่ห้าม request ที่หน้าจอยิงเรียงกัน
 *
 * ส่วน CRUD ธรรมดา (ลูกค้า รถ ใบเสนอราคา) ยังยิงตารางตรงผ่าน PostgREST ได้ตามปกติ
 * RLS ใน 0003 คุมสิทธิ์อยู่แล้ว ไม่ต้องมีฟังก์ชันมาห่อให้เปลือง
 */

/* ===== เลขที่เอกสาร =====
   ของเดิมนับด้วย countByYear() ใน repository แล้ว +1 ต่อท้าย — ย้ายมาไว้ที่เดียวกับข้อมูล
   นับจากของจริงในตาราง ไม่ใช่ sequence เพราะรูปแบบเดิมคือ "ลำดับที่เท่าไหร่ของปีนี้"
   ซึ่ง sequence ตอบไม่ได้เมื่อข้ามปี */
create or replace function app.next_doc_no(p_prefix text, p_table text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_col  text := case p_table
                   when 'orders' then 'order_no'
                   when 'quotes' then 'quote_no'
                   when 'trips'  then 'trip_no'
                 end;
  v_seq  int;
begin
  if v_col is null then
    raise exception 'ไม่รู้จักตาราง %', p_table using errcode = 'P0001';
  end if;

  execute format('select count(*) from public.%I where %I like $1', p_table, v_col)
     into v_seq
    using p_prefix || '-' || v_year || '-%';

  return p_prefix || '-' || v_year || '-' || lpad((v_seq + 1)::text, 4, '0');
end;
$$;

/* เติมเลขเอกสารให้ตอน insert ถ้าไม่ได้ส่งมา — หน้าจอจึง insert ตรงผ่าน PostgREST ได้
   โดยไม่ต้องมีฟังก์ชันแยกแค่เพื่อสร้างเลข
 *
 * IF ต้องซ้อน ห้ามเขียนเป็น `tg_table_name = 'orders' and new.order_no ...` ในบรรทัดเดียว
 * plpgsql ส่งทั้งเงื่อนไขไปให้ SQL ประเมินเป็นนิพจน์เดียว มันจึงต้อง resolve `new.order_no`
 * แม้ตอนที่ trigger ยิงมาจากตาราง quotes ซึ่งไม่มีคอลัมน์นั้น -> 42703 ทันที
 * การลัดวงจรแบบภาษาโปรแกรมทั่วไปไม่มีผลตรงนี้ ส่วน IF ซ้อนคนละ statement จึงคอมไพล์แยกกัน */
create or replace function app.fill_doc_no()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'orders' then
    if coalesce(new.order_no, '') = '' then
      new.order_no := app.next_doc_no('ORD', 'orders');
    end if;
  elsif tg_table_name = 'quotes' then
    if coalesce(new.quote_no, '') = '' then
      new.quote_no := app.next_doc_no('QOT', 'quotes');
    end if;
  elsif tg_table_name = 'trips' then
    if coalesce(new.trip_no, '') = '' then
      new.trip_no := app.next_doc_no('TRP', 'trips');
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_fill_doc_no before insert on public.orders
  for each row execute function app.fill_doc_no();
create trigger quotes_fill_doc_no before insert on public.quotes
  for each row execute function app.fill_doc_no();
create trigger trips_fill_doc_no before insert on public.trips
  for each row execute function app.fill_doc_no();

/* ===== จัดเที่ยว ===== */

/* สร้างเที่ยว + ผูกออเดอร์ + จองรถและคนขับ ในก้อนเดียว
   คืน warning แทนการ raise เมื่อน้ำหนักเกิน — ของเดิมก็เตือนแต่ไม่ห้าม
   เพราะคนจัดรถรู้หน้างานดีกว่าตัวเลขในระบบ (ของบางอย่างเบากว่าที่กรอก) */
create or replace function public.create_trip(
  p_vehicle_id bigint,
  p_driver_id  bigint,
  p_order_ids  bigint[],
  p_notes      text default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_trip     public.trips;
  v_capacity int;
  v_plate    text;
  v_weight   int;
  v_count    int;
  v_warning  text;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then
    raise exception 'เลือกอย่างน้อย 1 ออเดอร์สำหรับเที่ยวนี้' using errcode = 'P0001';
  end if;

  select capacity_kg, plate_no into v_capacity, v_plate
    from public.vehicles where id = p_vehicle_id and status = 'available'
     for update;
  if not found then
    raise exception 'รถคันนี้ไม่ว่าง หรือไม่มีอยู่จริง' using errcode = 'P0001';
  end if;

  perform 1 from public.drivers
   where id = p_driver_id and status = 'available' for update;
  if not found then
    raise exception 'พนักงานขับคนนี้ไม่ว่าง หรือไม่มีอยู่จริง' using errcode = 'P0001';
  end if;

  insert into public.trips (vehicle_id, driver_id, notes)
  values (p_vehicle_id, p_driver_id, p_notes)
  returning * into v_trip;

  /* รับเฉพาะออเดอร์ที่ยัง pending และยังไม่มีเที่ยว — เงื่อนไขเดียวกับ assertOrderAssignable() เดิม
     ถ้าอัปเดตได้ไม่ครบจำนวนที่ส่งมา แปลว่ามีใบที่คนอื่นคว้าไปแล้ว ต้องล้มทั้งก้อน
     ไม่ใช่ผูกเท่าที่ได้แล้วเงียบ — คนจัดรถจะไม่รู้เลยว่าใบไหนหาย */
  with upd as (
    update public.orders
       set status = 'assigned', trip_id = v_trip.id, updated_at = now()
     where id = any(p_order_ids) and status = 'pending' and trip_id is null
    returning weight_kg
  )
  select count(*), coalesce(sum(weight_kg), 0) into v_count, v_weight from upd;

  if v_count <> array_length(p_order_ids, 1) then
    raise exception 'มีออเดอร์บางใบถูกจัดเข้าเที่ยวอื่นไปแล้ว' using errcode = 'P0001';
  end if;

  update public.vehicles set status = 'on_trip' where id = p_vehicle_id;
  update public.drivers  set status = 'on_trip' where id = p_driver_id;

  if v_weight > v_capacity then
    v_warning := 'น้ำหนักรวม ' || v_weight || ' กก. เกินความจุรถ ' || v_plate
              || ' (' || v_capacity || ' กก.) — ยืนยันก่อนออกเดินทาง';
  end if;

  return json_build_object('trip_id', v_trip.id, 'trip_no', v_trip.trip_no, 'warning', v_warning);
end;
$$;

/* เพิ่มออเดอร์เข้าเที่ยวที่ยังไม่ออกวิ่ง */
create or replace function public.add_orders_to_trip(p_trip_id bigint, p_order_ids bigint[])
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_capacity int;
  v_plate    text;
  v_weight   int;
  v_count    int;
  v_warning  text;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  select v.capacity_kg, v.plate_no into v_capacity, v_plate
    from public.trips t join public.vehicles v on v.id = t.vehicle_id
   where t.id = p_trip_id and t.status = 'planned';
  if not found then
    raise exception 'เพิ่มออเดอร์ได้เฉพาะเที่ยวที่ยังไม่ออกวิ่ง' using errcode = 'P0001';
  end if;

  with upd as (
    update public.orders
       set status = 'assigned', trip_id = p_trip_id, updated_at = now()
     where id = any(p_order_ids) and status = 'pending' and trip_id is null
    returning 1
  )
  select count(*) into v_count from upd;

  if v_count <> coalesce(array_length(p_order_ids, 1), 0) then
    raise exception 'มีออเดอร์บางใบถูกจัดเข้าเที่ยวอื่นไปแล้ว' using errcode = 'P0001';
  end if;

  select coalesce(sum(weight_kg), 0) into v_weight
    from public.orders where trip_id = p_trip_id and status <> 'cancelled';

  if v_weight > v_capacity then
    v_warning := 'น้ำหนักรวม ' || v_weight || ' กก. เกินความจุรถ ' || v_plate
              || ' (' || v_capacity || ' กก.)';
  end if;

  return json_build_object('warning', v_warning);
end;
$$;

create or replace function public.remove_order_from_trip(p_trip_id bigint, p_order_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  update public.orders o
     set status = 'pending', trip_id = null, updated_at = now()
    from public.trips t
   where o.id = p_order_id and o.trip_id = p_trip_id
     and t.id = p_trip_id and t.status = 'planned';

  if not found then
    raise exception 'ไม่พบออเดอร์นี้ในเที่ยว หรือเที่ยวออกวิ่งไปแล้ว' using errcode = 'P0002';
  end if;
end;
$$;

/* ออฟฟิศสั่งออกเดินทางแทนคนขับได้ — คนละฟังก์ชันกับ start_trip() ของคนขับ
   เพราะตัวนั้นผูกกับ current_driver_id() ซึ่งพนักงานออฟฟิศไม่มี */
create or replace function public.dispatch_start_trip(p_trip_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  update public.trips set status = 'in_progress', departed_at = coalesce(departed_at, now())
   where id = p_trip_id and status = 'planned';
  if not found then
    raise exception 'เที่ยวนี้ไม่อยู่ในสถานะที่ออกเดินทางได้' using errcode = 'P0001';
  end if;

  update public.orders set status = 'in_transit', updated_at = now()
   where trip_id = p_trip_id and status = 'assigned';
end;
$$;

/* ปิดเที่ยว — เหมาออเดอร์ที่ยังวิ่งอยู่เป็น delivered แล้วปล่อยรถกับคนขับคืน
   ต่างจาก complete_trip() ของคนขับตรงที่ "ไม่บังคับว่าต้องส่งครบก่อน"
   เพราะออฟฟิศมีสิทธิ์ปิดงานที่หน้างานปิดไม่ได้ (คนขับเน็ตหลุด โทรศัพท์แบตหมด) */
create or replace function public.dispatch_complete_trip(p_trip_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
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

  update public.orders set status = 'delivered', delivered_at = coalesce(delivered_at, now()), updated_at = now()
   where trip_id = p_trip_id and status = 'in_transit';

  update public.vehicles set status = 'available' where id = v_vehicle;
  update public.drivers  set status = 'available' where id = v_driver;
end;
$$;

/* ยกเลิกเที่ยว — ออเดอร์กลับไปรอจัดใหม่ ไม่ใช่ถูกยกเลิกตาม
   งานยังต้องส่งอยู่ แค่เที่ยวนี้ไม่ได้ไป */
create or replace function public.dispatch_cancel_trip(p_trip_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
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
  update public.drivers  set status = 'available' where id = v_driver;
end;
$$;

/* ===== ใบเสนอราคา -> ออเดอร์ ===== */

create or replace function public.convert_quote(
  p_quote_id     bigint,
  p_scheduled_at timestamptz,
  p_notes        text default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_quote public.quotes;
  v_order public.orders;
begin
  if not app.has_perm('quotes.convert') then
    raise exception 'ไม่มีสิทธิ์แปลงใบเสนอราคา' using errcode = '42501';
  end if;
  if p_scheduled_at is null then
    raise exception 'ระบุกำหนดส่งก่อนแปลงเป็นออเดอร์' using errcode = 'P0001';
  end if;

  /* for update กันสองคนกดแปลงใบเดียวกันพร้อมกันแล้วได้ออเดอร์สองใบ */
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'ไม่พบใบเสนอราคานี้' using errcode = 'P0002';
  end if;
  if v_quote.converted_order_id is not null then
    raise exception 'ใบเสนอราคานี้แปลงเป็นออเดอร์ไปแล้ว' using errcode = 'P0001';
  end if;
  if v_quote.status not in ('sent', 'accepted') then
    raise exception 'แปลงได้เฉพาะใบที่ส่งแล้วหรือตกลงราคาแล้ว' using errcode = 'P0001';
  end if;

  insert into public.orders (customer_id, origin, destination, distance_km, goods_desc,
                             weight_kg, fee, priority, scheduled_at, notes)
  values (v_quote.customer_id, v_quote.origin, v_quote.destination, v_quote.distance_km,
          v_quote.goods_desc, v_quote.weight_kg, v_quote.fee, 'normal', p_scheduled_at,
          coalesce(nullif(p_notes, ''), 'จากใบเสนอราคา ' || v_quote.quote_no))
  returning * into v_order;

  update public.quotes
     set converted_order_id = v_order.id, status = 'accepted', updated_at = now()
   where id = p_quote_id;

  return json_build_object('order_id', v_order.id, 'order_no', v_order.order_no);
end;
$$;

revoke execute on function
  public.create_trip, public.add_orders_to_trip, public.remove_order_from_trip,
  public.dispatch_start_trip, public.dispatch_complete_trip, public.dispatch_cancel_trip,
  public.convert_quote
from public;

grant execute on function
  public.create_trip, public.add_orders_to_trip, public.remove_order_from_trip,
  public.dispatch_start_trip, public.dispatch_complete_trip, public.dispatch_cancel_trip,
  public.convert_quote
to authenticated;
