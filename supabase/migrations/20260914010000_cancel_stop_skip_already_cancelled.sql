-- cancel_stop เขียนทับใบที่ยกเลิกไปแล้วที่ร้านเดียวกัน
--
-- ร้านที่มีหลายใบ ยกเลิกใบแรกไปแล้ว (มีเหตุผล+เวลาของมันเอง) ใบที่สองยัง
-- pending อยู่ ปุ่มยกเลิกจึงยังขึ้นให้กดได้ (stop.cancelled เป็น false จนกว่า
-- ทุกใบจะถูกยกเลิกหมด — ดู StopGroup.cancelled ใน utils/stops.ts) ฝั่งเว็บ
-- (doCancelStop ใน CloudMyJobs.tsx) กรองด้วย status !== 'delivered' ซึ่งใบที่
-- cancelled ไปแล้วก็ผ่านเงื่อนไขนี้ด้วย เลยหลุดเข้ามาใน p_order_ids ชุดเดิม
--
-- update เดิมไม่มี and status <> 'cancelled' (undo_cancel_stop มีเงื่อนไข
-- คู่กันคือ and status = 'cancelled' แต่ cancel_stop ไม่มีฝั่งตรงข้าม) จึงเขียน
-- ทับ cancel_reason/cancelled_at/cancelled_by ของใบแรกด้วยเหตุผลของใบที่สอง
-- แบบเงียบ ๆ แล้วยังแทรก audit log ใบซ้ำที่โยงเหตุผลผิดใบเข้าไปอีก
--
-- ทางแก้: กันใบที่ cancelled ไปแล้วออกจาก update และออกจาก audit log ตั้งแต่ต้น
-- ไม่ raise error เพราะใบที่เหลือ (ยัง pending) ต้องยกเลิกได้ตามปกติ การเลือก
-- error จะบล็อกใบที่ถูกต้องไปด้วยทั้งที่ไม่มีอะไรผิด

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
  v_touched   int;
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

  select count(*) into v_pods
    from public.pod where order_id = any(p_order_ids);
  if v_pods > 0 then
    raise exception 'ยกเลิกไม่ได้ — มีใบที่เก็บหลักฐานแล้ว % ใบ', v_pods using errcode = 'P0001';
  end if;

  /* ใบที่ cancelled ไปแล้วไม่แตะซ้ำ — กันเหตุผล/เวลาของใบเดิมไม่ให้ถูกเขียนทับ
     ด้วยเหตุผลของใบอื่นที่บังเอิญยกเลิกพร้อมกันมาในชุดเดียวกัน */
  update public.orders
     set status        = 'cancelled',
         cancel_reason = v_reason,
         cancelled_at  = now(),
         cancelled_by  = v_user,
         delivered_at  = null,
         updated_at    = now()
   where id = any(p_order_ids)
     and status <> 'cancelled';
  get diagnostics v_touched = row_count;

  for r in select id, destination from public.orders
            where id = any(p_order_ids) and cancelled_at = now() loop
    insert into public.evidence_audit_log (actor_user_id, action, trip_no, order_id, detail)
    values (v_user, 'stop_cancelled', v_trip.trip_no, r.id,
            json_build_object('reason', v_reason,
                              'destination', r.destination,
                              'by', case when v_is_office then 'office' else 'driver' end));
  end loop;

  return json_build_object('cancelled', v_touched, 'trip_id', v_trip_id);
end;
$function$;
