-- ยกเลิกจุดส่งทั้งร้าน พร้อมเหตุผล — ทำได้ทั้งคนขับและออฟฟิศ
--
-- อาการหน้างาน: ต้นทางยกเลิกร้านหนึ่งกลางเที่ยว คนขับส่งไม่ได้ ใบนั้นค้างเป็น
-- assigned ตลอด แล้ว complete_trip นับว่ายังส่งไม่ครบ คนขับจึงปิดเที่ยวไม่ได้
-- ทั้งเที่ยว ทั้งที่ร้านอื่นส่งครบแล้ว ต้องรอออฟฟิศมาเคลียร์ให้เท่านั้น
--
-- ทางที่เลือก: ยกเลิกเป็น "ร้าน" ไม่ใช่ "ใบ" และไม่ใช่ "เที่ยว"
--   ร้าน เพราะหน้างานยกเลิกทั้งร้าน ไม่มีใครยกเลิกทีละใบของร้านเดียวกัน
--   ไม่ใช่เที่ยว เพราะคนขับรู้แค่ว่าร้านนี้ไม่รับของ ไม่ได้รู้ว่าทั้งเที่ยวควรถูกล้าง
--
-- ไม่ลบข้อมูล ต่างจาก dispatch_cancel_trip ที่ลบแถวจริงเพื่อให้นำเข้าใหม่ได้
-- ที่นี่แค่เปลี่ยนสถานะ เพราะร่องรอยว่ามีคนขับรถไปถึงหน้าร้านคือเรื่องค่าเที่ยว
-- และข้อโต้แย้งกับลูกค้า ลบทิ้งแล้วตอบไม่ได้ว่าใครไปหรือไม่ไป
--
-- ไม่ปลด tms_shipments.order_id ตั้งใจ — ปลดแล้วใบดิบกลับไปรอสั่งใหม่ทันที
-- ซึ่งถูกเฉพาะตอนยกเลิกจริง แต่หน้างานจำนวนมากคือ "เลื่อนไปพรุ่งนี้" ที่หน้าตา
-- เหมือนกันเป๊ะตอนคนขับกด ให้ออฟฟิศเป็นคนตัดสินว่าจะปล่อยกลับหรือไม่
--
-- complete_trip ไม่ต้องแก้ ด่านของมันเขียนว่า not in (delivered, cancelled)
-- อยู่แล้ว ใบที่ยกเลิกจึงไม่นับเป็นงานค้างตั้งแต่วินาทีที่สถานะเปลี่ยน

alter table public.orders
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  bigint references public.users(id) on delete set null;

comment on column public.orders.cancel_reason is
  'เหตุผลที่ยกเลิกจุดส่งนี้ — บังคับกรอก ไม่มีทางยกเลิกโดยไม่บอกเหตุผล';

/* คนขับต้องเห็นว่าร้านที่ตัวเองยกเลิกไปเมื่อกี้ถูกยกเลิกด้วยเหตุผลอะไร
   ไม่งั้นจอจะบอกได้แค่ว่า "ยกเลิก" ลอย ๆ ซึ่งอ่านย้อนหลังไม่ได้ความ */
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
         (exists (select 1 from public.pod p where p.order_id = o.id)) as has_pod,
         /* คอลัมน์ใหม่ต่อท้ายเสมอ — create or replace view เปลี่ยนลำดับหรือแทรก
            กลางลิสต์ไม่ได้ Postgres ปฏิเสธทั้งคำสั่ง ต้อง drop view ทิ้งก่อน
            ซึ่งพังของที่อ้างถึง view นี้อยู่ */
         o.cancel_reason,
         o.cancelled_at
    from public.orders o
    join public.trips t on t.id = o.trip_id
    left join public.customers c on c.id = o.customer_id
   where app.has_perm('myjobs.view'::text)
     and (t.driver_id = app.current_driver_id()
          or exists (select 1 from public.trip_drivers td
                      where td.trip_id = t.id
                        and td.driver_id = app.current_driver_id()));

/* ---------------------------------------------------------------
   cancel_stop — ยกเลิกทุกใบของร้านหนึ่งในเที่ยว

   รับเป็น array เพราะร้านเดียวมีได้หลายใบ และต้องยกเลิกพร้อมกันหรือไม่ยกเลิกเลย
   ครึ่ง ๆ กลาง ๆ แปลว่าคนขับต้องจำเองว่าเหลือใบไหน ซึ่งเป็นที่มาของงานตกหล่น
   --------------------------------------------------------------- */
create or replace function public.cancel_stop(p_order_ids bigint[], p_reason text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_office boolean := app.has_perm('dispatch.write');
  v_is_driver boolean := app.has_perm('myjobs.progress');
  v_reason    text    := nullif(btrim(coalesce(p_reason, '')), '');
  v_trip_id   bigint;
  v_trip      public.trips;
  v_count     int;
  v_trips     int;
  v_pods      int;
  v_mine      boolean;
  v_user      bigint := app.current_user_id();
  r           record;
begin
  if not (v_is_office or v_is_driver) then
    raise exception 'ไม่มีสิทธิ์ยกเลิกจุดส่ง' using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'ต้องบอกเหตุผลที่ยกเลิก' using errcode = 'P0001';
  end if;

  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'ไม่ได้ระบุใบที่จะยกเลิก' using errcode = 'P0001';
  end if;

  /* ทุกใบต้องอยู่เที่ยวเดียวกัน — ไม่งั้นนี่ไม่ใช่ "ร้านหนึ่งในเที่ยว" แต่เป็น
     การกวาดข้ามเที่ยวซึ่งไม่มีจอไหนตั้งใจสั่ง และตรวจสิทธิ์เป็นเที่ยวไม่ได้ */
  select count(*), count(distinct trip_id), min(trip_id)
    into v_count, v_trips, v_trip_id
    from public.orders
   where id = any(p_order_ids);

  if v_count <> array_length(p_order_ids, 1) then
    raise exception 'มีใบที่ไม่พบในระบบ' using errcode = 'P0002';
  end if;
  if v_trips <> 1 or v_trip_id is null then
    raise exception 'ใบที่เลือกไม่ได้อยู่เที่ยวเดียวกัน' using errcode = 'P0001';
  end if;

  select * into v_trip from public.trips where id = v_trip_id for update;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  if v_trip.status = 'completed' then
    raise exception 'เที่ยวนี้ปิดงานไปแล้ว' using errcode = 'P0001';
  end if;

  /* คนขับแตะได้เฉพาะเที่ยวของตัวเอง และเฉพาะตอนที่รถกำลังวิ่งอยู่จริง
     ออฟฟิศแตะได้ทุกเที่ยวที่ยังไม่ปิด เพราะเขาแก้แผนก่อนรถออกก็ได้ */
  if not v_is_office then
    v_mine := v_trip.driver_id = app.current_driver_id()
              or exists (select 1 from public.trip_drivers td
                          where td.trip_id = v_trip.id
                            and td.driver_id = app.current_driver_id());
    if not v_mine then
      raise exception 'ไม่ใช่เที่ยวของคุณ' using errcode = '42501';
    end if;
    if v_trip.status <> 'in_progress' then
      raise exception 'ยกเลิกจุดส่งได้เฉพาะตอนเที่ยวกำลังวิ่ง' using errcode = 'P0001';
    end if;
  end if;

  /* หลักฐานมาก่อนเสมอ — ใบที่เก็บ POD แล้วแปลว่าของถึงมือคนรับจริง
     ยกเลิกทับลงไปคือลบความจริงข้อนั้นทิ้ง ปฏิเสธทั้งชุด ไม่ยกเลิกบางใบ */
  select count(*) into v_pods
    from public.pod where order_id = any(p_order_ids);
  if v_pods > 0 then
    raise exception 'ยกเลิกไม่ได้ — มีใบที่เก็บหลักฐานแล้ว % ใบ', v_pods using errcode = 'P0001';
  end if;

  update public.orders
     set status        = 'cancelled',
         cancel_reason = v_reason,
         cancelled_at  = now(),
         cancelled_by  = v_user,
         delivered_at  = null,
         updated_at    = now()
   where id = any(p_order_ids);

  for r in select id, destination from public.orders where id = any(p_order_ids) loop
    insert into public.evidence_audit_log (actor_user_id, action, trip_no, order_id, detail)
    values (v_user, 'stop_cancelled', v_trip.trip_no, r.id,
            json_build_object('reason', v_reason,
                              'destination', r.destination,
                              'by', case when v_is_office then 'office' else 'driver' end));
  end loop;

  return json_build_object('cancelled', v_count, 'trip_id', v_trip_id);
end;
$function$;

/* ---------------------------------------------------------------
   undo_cancel_stop — กดผิดร้านต้องแก้เองได้ในนาทีนั้น

   คืนเป็น assigned ซึ่งเป็นสถานะก่อนถึงร้าน ไม่ใช่ delivered
   --------------------------------------------------------------- */
create or replace function public.undo_cancel_stop(p_order_ids bigint[])
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_office boolean := app.has_perm('dispatch.write');
  v_is_driver boolean := app.has_perm('myjobs.progress');
  v_trip_id   bigint;
  v_trip      public.trips;
  v_user      bigint := app.current_user_id();
  v_mine      boolean;
  v_back      int;
  r           record;
begin
  if not (v_is_office or v_is_driver) then
    raise exception 'ไม่มีสิทธิ์แก้จุดส่ง' using errcode = '42501';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'ไม่ได้ระบุใบที่จะถอน' using errcode = 'P0001';
  end if;

  select min(trip_id) into v_trip_id
    from public.orders where id = any(p_order_ids);
  if v_trip_id is null then
    raise exception 'ไม่พบใบเหล่านี้ในเที่ยวไหน' using errcode = 'P0002';
  end if;

  select * into v_trip from public.trips where id = v_trip_id for update;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  if not v_is_office then
    v_mine := v_trip.driver_id = app.current_driver_id()
              or exists (select 1 from public.trip_drivers td
                          where td.trip_id = v_trip.id
                            and td.driver_id = app.current_driver_id());
    if not v_mine then
      raise exception 'ไม่ใช่เที่ยวของคุณ' using errcode = '42501';
    end if;
  end if;

  update public.orders
     set status        = 'assigned',
         cancel_reason = null,
         cancelled_at  = null,
         cancelled_by  = null,
         updated_at    = now()
   where id = any(p_order_ids) and status = 'cancelled';
  get diagnostics v_back = row_count;

  for r in select id from public.orders where id = any(p_order_ids) loop
    insert into public.evidence_audit_log (actor_user_id, action, trip_no, order_id, detail)
    values (v_user, 'stop_cancel_undone', v_trip.trip_no, r.id,
            json_build_object('by', case when v_is_office then 'office' else 'driver' end));
  end loop;

  return json_build_object('restored', v_back, 'trip_id', v_trip_id);
end;
$function$;

revoke all on function public.cancel_stop(bigint[], text) from public;
revoke all on function public.undo_cancel_stop(bigint[]) from public;
grant execute on function public.cancel_stop(bigint[], text) to authenticated;
grant execute on function public.undo_cancel_stop(bigint[]) to authenticated;
