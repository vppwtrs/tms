-- หน้า "เที่ยวจาก TMS" เปิดมาแล้วเจอแต่เที่ยวที่กดนำเข้าไม่ได้
--
-- เดิมค่าเริ่มต้นคือวันล่าสุดที่มีข้อมูลใน tms_trips ซึ่งมักเป็นวันที่ TMS เพิ่งเปิดเที่ยว
-- สถานะยัง Confirm และยังไม่จ่ายคนขับ ทุกแถวจึงถูกล็อกไว้ ส่วนเที่ยวของวันก่อนหน้า
-- ที่จับคู่คนขับครบและพร้อมนำเข้า กลับถูกซ่อนอยู่หลังตัวเลือกวันที่

create or replace function public.preview_tms_trips(p_date date default null)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_date date;
  v_out  json;
begin
  if not app.has_perm('dispatch.view') then
    raise exception 'ไม่มีสิทธิ์ดูแผนงาน' using errcode = '42501';
  end if;

  /* วันเริ่มต้นของหน้า = วันล่าสุดที่ยังมีเที่ยว "พร้อมนำเข้า" ไม่ใช่วันล่าสุดที่มีข้อมูล
     เที่ยวที่ TMS เพิ่งเปิด (สถานะ Confirm) ยังไม่จ่ายคนขับ กดนำเข้าไม่ได้อยู่ดี
     ถ้าเปิดหน้ามาเจอแต่ของแบบนั้น คนวางแผนจะเห็นแต่ปุ่มเทาแล้วนึกว่าระบบพัง
     ทั้งที่ของที่ทำได้จริงอยู่ในวันก่อนหน้า */
  if p_date is not null then
    v_date := p_date;
  else
    select max(t.order_date) into v_date
      from public.tms_trips t
     where t.trip_id is null
       and t.status_id is distinct from 6
       /* มีชื่อคนขับมาแล้วคือเงื่อนไขเดียวที่ต้องดู ไม่ใช่ต้องจับคู่เสร็จก่อน —
          เที่ยวที่ชื่อยังไม่รู้จักก็กดจับคู่ได้ในหน้านั้นเลย ถือว่าเป็นงานที่ทำได้
          ส่วนเที่ยวที่ TMS ยังไม่จ่ายคนขับ ไม่มีอะไรให้ทำ ไม่ควรเป็นวันเริ่มต้น */
       and t.driver_name is not null;

    /* ไม่มีเที่ยวที่พร้อมเลย ก็กลับไปใช้วันล่าสุดที่มีข้อมูลตามเดิม
       หน้าเปล่ากับหน้าที่ยังไม่มีใครดึงข้อมูล ต้องแยกออกจากกันให้ได้ */
    if v_date is null then
      select max(order_date) into v_date from public.tms_trips;
    end if;
  end if;

  select json_build_object(
    'date', v_date,
    'latest_date', (select max(order_date) from public.tms_trips),
    'trips', coalesce((
      select json_agg(x order by x.trip_no)
        from (
          select t.tms_id, t.trip_no, t.status, t.status_id, t.reason,
                 t.license_plate, t.driver_name, t.area, t.vehicle_type,
                 t.total_pl, t.total_unit, t.warehouse_code,
                 t.trip_id is not null as imported,
                 t.trip_id,
                 dm.driver_id,
                 /* ใบที่ยังไม่รู้ว่าเป็นลูกค้ารายไหน — **ไม่กันการนำเข้า**
                    เที่ยวไปทั้งก้อน ใบพวกนี้เข้าเป็นออเดอร์ที่ยังไม่ผูกลูกค้า */
                 (select count(distinct s.picking_list_no)
                    from public.tms_shipments s
                    left join public.tms_dealer_map m on m.dealer_code = s.dealer_code
                   where s.tms_trip_id = t.tms_id
                     and (m.customer_id is null or m.ignored)) as unmapped_pls,
                 (select count(distinct s.picking_list_no)
                    from public.tms_shipments s
                   where s.tms_trip_id = t.tms_id) as pls_in_db
            from public.tms_trips t
            left join public.tms_driver_map dm on dm.driver_key = t.driver_name and not dm.ignored
           where t.order_date = v_date
        ) x
    ), '[]'::json),
    /* เหลือค้างอย่างเดียวที่คนต้องทำก่อนนำเข้าได้ */
    'unmapped_drivers', coalesce((
      select json_agg(distinct t.driver_name)
        from public.tms_trips t
        left join public.tms_driver_map dm on dm.driver_key = t.driver_name
       where t.order_date = v_date and t.driver_name is not null
         and (dm.driver_key is null or (dm.driver_id is null and not dm.ignored))
    ), '[]'::json),
    /* ออเดอร์ที่นำเข้าแล้วแต่ยังไม่ผูกลูกค้า — เติมได้ด้วยการจับคู่ร้านแล้วกดเติมย้อนหลัง */
    'orders_without_customer', (
      select count(*)::int from public.orders o
       join public.trips tr on tr.id = o.trip_id
       join public.tms_trips t on t.trip_id = tr.id
      where o.customer_id is null),
    'cancelled_after_import', coalesce((
      select json_agg(json_build_object('trip_no', t.trip_no, 'reason', t.reason,
                                        'our_trip_id', t.trip_id))
        from public.tms_trips t
       where t.status_id = 6 and t.trip_id is not null
    ), '[]'::json)
  ) into v_out;

  return v_out;
end;
$fn$;
