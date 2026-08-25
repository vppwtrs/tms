/*
 * ปิดเที่ยวจากฝั่งออฟฟิศ: ยังข้ามด่านหลักฐานได้ แต่ต้องไม่เงียบ
 *
 * เกิดขึ้นจริงวันนี้: คนที่ออฟฟิศกดปิดงานจากหน้าจัดเที่ยวขณะที่คนขับยังส่งไม่ครบ
 * ปุ่มนั้นเปลี่ยนใบที่ยัง in_transit ทั้งหมดเป็น "ส่งสำเร็จ" ตามที่ออกแบบไว้
 * ผลคือจุดสุดท้าย (WH-A KM23) กลายเป็นส่งแล้วทั้งที่ไม่มีหลักฐานสักใบ
 * และงานหายไปจากจอคนขับกลางคัน
 *
 * ทางออกฉุกเฉินนี้ต้องมีอยู่ต่อ — คนขับลืมกดว่ากลับถึงคลังจะเกิดขึ้นแน่นอน
 * และถ้าบังคับหลักฐานตรงนี้ด้วย เที่ยวที่หลักฐานหายจะปิดไม่ได้เลยตลอดกาล
 * สิ่งที่ผิดไม่ใช่การมีปุ่ม แต่คือปุ่มที่ทำเรื่องใหญ่ขนาดนี้แล้วไม่เหลือร่องรอย
 *
 * รอบนี้เพิ่มสองอย่าง ไม่แตะสิทธิ์และไม่แตะพฤติกรรมการปิด:
 *   1. คืนค่าว่าปิดไปกี่ใบ และในนั้นไม่มีหลักฐานกี่ใบ ให้หน้าเว็บถามยืนยันก่อนได้
 *   2. ลง evidence_audit_log ทุกใบที่ถูกปิดทั้งที่ยังไม่มีหลักฐาน
 *      ตอนลูกค้าทวงว่าของถึงจริงไหม จะตอบได้ว่าใครปิด ปิดเมื่อไหร่ และขาดอะไร
 *
 * เพิ่ม trip_close_preview ไว้ให้ถามล่วงหน้าโดยไม่ต้องแตะข้อมูล — หน้าเว็บเรียกก่อน
 * แล้วค่อยขึ้นกล่องยืนยันที่บอกตัวเลขจริง ไม่ใช่คำเตือนลอย ๆ ที่ทุกคนกดผ่าน
 */

create or replace function public.trip_close_preview(p_trip_id bigint)
returns json
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select json_build_object(
    'trip_no', (select t.trip_no from public.trips t where t.id = p_trip_id),
    /* ใบที่ปุ่มปิดงานจะเปลี่ยนเป็น "ส่งสำเร็จ" ให้ทันที */
    'open_orders', (
      select count(*) from public.orders o
       where o.trip_id = p_trip_id and o.status = 'in_transit'
    ),
    /* ใบที่จะถูกนับว่าส่งแล้วทั้งที่ไม่มีหลักฐานสักใบ — ตัวเลขที่ต้องเอาไปขึ้นจอ */
    'without_pod', (
      select count(*) from public.orders o
       where o.trip_id = p_trip_id
         and o.status in ('in_transit', 'delivered')
         and not exists (
           select 1 from public.pod p
            join public.pod_photos f on f.pod_id = p.id
           where p.order_id = o.id
         )
    )
  );
$fn$;

grant execute on function public.trip_close_preview(bigint) to authenticated;

/* เดิมคืน void ตอนนี้คืน json — postgres ไม่ยอมให้ replace ข้ามชนิดที่คืนกลับ
   ต้องทิ้งของเดิมก่อน สิทธิ์ที่ให้ไว้หายไปพร้อมกัน จึง grant ใหม่ท้ายไฟล์ */
drop function if exists public.dispatch_complete_trip(bigint);

create or replace function public.dispatch_complete_trip(p_trip_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_vehicle bigint;
  v_driver  bigint;
  v_trip_no text;
  v_closed  int := 0;
  v_nopod   int := 0;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  /* ออฟฟิศข้ามขั้น returning ได้ ใช้ตอนคนขับลืมกดว่ากลับถึงแล้ว ซึ่งจะเกิดขึ้นแน่
     ด่านหลักฐานไม่บังคับตรงนี้โดยตั้งใจ — นี่คือทางออกฉุกเฉินของคนที่เห็นภาพรวม
     ไม่ใช่เส้นทางปกติ ถ้าบังคับด้วย เที่ยวที่หลักฐานหายจะไม่มีทางปิดได้เลย */
  update public.trips
     set status = 'completed',
         arrived_at = coalesce(arrived_at, now()),
         returned_at = coalesce(returned_at, now())
   where id = p_trip_id and status in ('in_progress', 'returning')
  returning vehicle_id, driver_id, trip_no into v_vehicle, v_driver, v_trip_no;

  if not found then
    raise exception 'ปิดได้เฉพาะเที่ยวที่กำลังวิ่งหรือกำลังกลับคลัง' using errcode = 'P0001';
  end if;

  with closed as (
    update public.orders
       set status = 'delivered', delivered_at = coalesce(delivered_at, now()), updated_at = now()
     where trip_id = p_trip_id and status = 'in_transit'
    returning id, destination, customer_id
  )
  select count(*) into v_closed from closed;

  /* บันทึกเฉพาะใบที่ถูกนับว่าส่งแล้วทั้งที่ไม่มีหลักฐาน — ใบที่มีหลักฐานครบ
     ไม่ต้องมีบรรทัดในนี้ บันทึกที่เต็มไปด้วยเรื่องปกติคือบันทึกที่ไม่มีใครอ่าน */
  insert into public.evidence_audit_log (actor_user_id, action, trip_no, order_id, detail)
  select app.current_user_id(), 'trip_closed_without_pod', v_trip_no, o.id,
         json_build_object('destination', o.destination, 'closed_by', 'dispatch')
    from public.orders o
   where o.trip_id = p_trip_id
     and o.status = 'delivered'
     and not exists (
       select 1 from public.pod p
        join public.pod_photos f on f.pod_id = p.id
       where p.order_id = o.id
     );

  get diagnostics v_nopod = row_count;

  update public.vehicles set status = 'available' where id = v_vehicle;
  update public.drivers set status = 'available'
   where id = v_driver
      or id in (select driver_id from public.trip_drivers where trip_id = p_trip_id);

  return json_build_object('trip_no', v_trip_no, 'closed', v_closed, 'without_pod', v_nopod);
end;
$fn$;

grant execute on function public.dispatch_complete_trip(bigint) to authenticated;
