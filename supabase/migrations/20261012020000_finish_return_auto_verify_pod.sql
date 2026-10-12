-- คนขับกด "กลับถึงคลัง" (finish_return) แล้ว POD ของเที่ยวนั้นยืนยันให้อัตโนมัติ
-- ผู้ใช้เลือกแบบนี้ 12 ต.ค. 2569 — ป้าย "ยืนยันแล้ว" ของเที่ยวที่ปิดผ่านทางนี้
-- จึงแปลว่า "คนขับนำหลักฐานกลับถึงคลังแล้ว" ไม่ใช่ "ออฟฟิศตรวจแล้ว"
-- แยกได้จาก evidence_audit_log: detail->>'by' = 'driver_return'

CREATE OR REPLACE FUNCTION public.finish_return(p_trip_id bigint, p_toll_cost numeric DEFAULT NULL::numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_me      bigint := app.current_driver_id();
  v_user    bigint := app.current_user_id();
  v_primary bigint;
  v_trip    public.trips;
  v_nopod   integer;
  v_verified integer := 0;
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

  if p_toll_cost is not null and p_toll_cost < 0 then
    raise exception 'ค่าทางด่วนติดลบไม่ได้' using errcode = 'P0001';
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
         returned_at = coalesce(returned_at, now()),
         /* ไม่แตะ toll_cost ถ้าไม่ได้ส่งมา — ออฟฟิศอาจกรอกไว้ก่อนแล้ว
            การเขียนทับด้วย 0 เพราะจอไม่ได้ถาม คือลบตัวเลขที่มีคนกรอกมาแล้ว */
         toll_cost = case when p_toll_cost is null then toll_cost else p_toll_cost end,
         toll_reported_at = case when p_toll_cost is null then toll_reported_at else now() end,
         toll_reported_by = case when p_toll_cost is null then toll_reported_by else v_user end
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

  /* กลับถึงคลัง = ยืนยัน POD ของเที่ยวนี้ทั้งหมด — บันทึกทีละใบเหมือน verify_pod
     แต่ติดป้าย by = driver_return ให้แยกออกจากการตรวจของออฟฟิศได้ */
  with done as (
    update public.pod p
       set status = 'verified', updated_at = now()
      from public.orders o
     where o.id = p.order_id
       and o.trip_id = p_trip_id
       and p.status = 'collected'
    returning p.id, p.order_id, p.recipient_name
  ), logged as (
    insert into public.evidence_audit_log (actor_user_id, action, trip_no, order_id, pod_id, detail)
    select v_user, 'pod_verified', v_trip.trip_no, d.order_id, d.id,
           json_build_object('recipient_name', d.recipient_name, 'by', 'driver_return')
      from done d
    returning 1
  )
  select count(*) into v_verified from logged;

  /* ค่าทางด่วนคือเงิน ต้องตอบได้ว่าใครใส่ตัวเลขนี้และใส่เมื่อไหร่ */
  if p_toll_cost is not null then
    insert into public.evidence_audit_log (actor_user_id, action, trip_no, order_id, detail)
    values (v_user, 'toll_reported', v_trip.trip_no, null,
            json_build_object('toll_cost', p_toll_cost, 'by', 'driver'));
  end if;

  return json_build_object('trip_id', p_trip_id, 'trip_no', v_trip.trip_no, 'pod_verified', v_verified);
end;
$function$;
