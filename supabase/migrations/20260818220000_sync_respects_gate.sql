-- สถานะจาก TMS ต้องไม่ดันเที่ยวข้ามประตูรับงานของคนขับ
--
-- เดิม sync_tms_trip_status ดันทุกเที่ยวไปข้างหน้าตาม TMS ทุกรอบ
-- เที่ยวที่คนขับยังไม่กดรับจึงกลายเป็น "กำลังวิ่ง" เองภายใน 5 นาที
-- ปุ่มรับงานที่เพิ่งใส่ไปจะไม่มีความหมายเลยถ้าไม่กันตรงนี้ด้วย
--
-- ที่ยังปล่อยให้ผ่าน: เที่ยวที่คนขับรับแล้ว (accepted_at ไม่เป็น null)
-- และ "จบงาน" จาก TMS ซึ่งเป็นข้อเท็จจริงที่เกิดไปแล้ว การกักไว้ไม่ทำให้ของกลับมา
-- แต่จะทำให้รถกับคนขับค้างสถานะไม่ว่างทั้งที่งานจบแล้ว

create or replace function public.sync_tms_trip_status()
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_trips  int;
  v_orders int;
begin
  with want as (
    select t.trip_id,
           case t.status_id when 2 then 'planned'
                            when 3 then 'in_progress'
                            when 4 then 'in_progress'
                            when 5 then 'completed'
                            else null end::trip_status as st
      from public.tms_trips t
     where t.trip_id is not null and t.status_id in (2, 3, 4, 5)
  ),
  upd as (
    update public.trips tr
       set status = w.st,
           /* เวลาออกรถของจริงมาจาก TMS (onDeliveryDate) ถ้าฝั่งเรายังไม่มี
              ไม่เขียนทับของเดิม เพราะคนขับกดออกรถเองก็บันทึกเวลาไว้แล้ว */
           departed_at = coalesce(tr.departed_at,
             case when w.st = 'in_progress'
                  then (select on_delivery_date from public.tms_trips z where z.trip_id = tr.id)
             end),
           arrived_at = coalesce(tr.arrived_at, case when w.st = 'completed' then now() end),
           /* เที่ยวที่ TMS ปิดไปเองโดยคนขับไม่เคยกดรับ ถือว่าประตูหมดหน้าที่แล้ว
              ปล่อยให้ค้างเป็น null จะไปโผล่ในช่อง "รอคนขับรับ" ตลอดกาล */
           accepted_at = coalesce(tr.accepted_at, case when w.st = 'completed' then now() end)
      from want w
     where tr.id = w.trip_id
       and w.st is not null
       /* ไปข้างหน้าเท่านั้น และไม่แตะเที่ยวที่ถูกยกเลิกฝั่งเรา */
       and tr.status <> 'cancelled'
       and app.trip_rank(w.st) > app.trip_rank(tr.status)
       /* ประตูรับงาน: เที่ยวที่คนขับยังไม่กดรับ ห้ามเดินไป "กำลังวิ่ง"
          ส่วน "จบงาน" ยังปล่อยผ่าน เพราะเป็นเรื่องที่เกิดไปแล้วจริง
          และถ้ากักไว้ รถกับคนขับจะค้างสถานะไม่ว่างทั้งที่งานจบ */
       and (tr.accepted_at is not null or w.st = 'completed')
    returning tr.id
  )
  select count(*)::int into v_trips from upd;

  /* ออเดอร์ในเที่ยวตามสถานะเที่ยว — ไม่แตะใบที่ delivered หรือ cancelled แล้ว
     ใบที่ delivered มี POD ผูกอยู่ การถอยสถานะคือทำหลักฐานให้ขัดกับสถานะงาน */
  with want as (
    select o.id,
           case tr.status when 'planned' then 'assigned'
                          when 'in_progress' then 'in_transit'
                          when 'completed' then 'delivered'
                          else null end::order_status as st
      from public.orders o
      join public.trips tr on tr.id = o.trip_id
      join public.tms_trips t on t.trip_id = tr.id
  ),
  upd as (
    update public.orders o
       set status = w.st,
           delivered_at = coalesce(o.delivered_at, case when w.st = 'delivered' then now() end),
           updated_at = now()
      from want w
     where o.id = w.id and w.st is not null
       and o.status not in ('delivered', 'cancelled')
       and app.order_rank(w.st) > app.order_rank(o.status)
    returning o.id
  )
  select count(*)::int into v_orders from upd;

  return json_build_object('trips', coalesce(v_trips, 0), 'orders', coalesce(v_orders, 0));
end;
$fn$;
