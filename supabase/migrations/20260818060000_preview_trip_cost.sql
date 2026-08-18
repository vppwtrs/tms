-- ส่งค่าขนส่งออกมาให้หน้า "เที่ยวจาก TMS" เห็น
--
-- tms_trips.cost / actual_cost ถูกเก็บครบมาตั้งแต่ push แล้ว แต่ preview_tms_trips
-- ไม่เคย select ออกมา ตัวเลขจึงค้างอยู่ในฐานโดยไม่มีใครเห็น
-- ทั้งที่เป็นข้อมูลที่คนวางแผนต้องใช้ตัดสินใจมากที่สุดตัวหนึ่ง

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

  /* ลำดับการเลือกวันเริ่มต้นของหน้า:
       1) วันนี้ ถ้ามีเที่ยวที่ "ทำได้" อยู่จริง
       2) วันล่าสุดที่ยังมีเที่ยวทำได้ (ของค้างจากวันก่อน)
       3) วันล่าสุดที่มีข้อมูล
     เที่ยวที่ TMS เพิ่งเปิด (สถานะ Confirm) ยังไม่จ่ายคนขับ กดนำเข้าไม่ได้อยู่ดี
     ถ้าเปิดหน้ามาเจอแต่ของแบบนั้น คนวางแผนจะเห็นแต่ปุ่มเทาแล้วนึกว่าระบบพัง */
  if p_date is not null then
    v_date := p_date;
  else
    /* วันนี้มาก่อนเสมอถ้ามีงานที่ทำได้ — รอบอัตโนมัติดึงเฉพาะเที่ยวของวันนี้แล้ว
       เปิดหน้ามาต้องเจอวันนี้ ไม่ใช่ตกไปอยู่เมื่อวานเพราะของเมื่อวานยังค้าง */
    select current_date into v_date
     where exists (
       select 1 from public.tms_trips t
        where t.order_date = current_date
          and t.trip_id is null
          and t.status_id is distinct from 6
          and app.tms_driver_names(t.driver_name) <> '{}'
     );

    if v_date is null then
      select max(t.order_date) into v_date
        from public.tms_trips t
       where t.trip_id is null
         and t.status_id is distinct from 6
         /* มีชื่อคนขับมาแล้วคือเงื่อนไขเดียวที่ต้องดู ไม่ใช่ต้องจับคู่เสร็จก่อน —
            เที่ยวที่ชื่อยังไม่รู้จักก็กดจับคู่ได้ในหน้านั้นเลย ถือว่าเป็นงานที่ทำได้
            ส่วนเที่ยวที่ TMS ยังไม่จ่ายคนขับ ไม่มีอะไรให้ทำ ไม่ควรเป็นวันเริ่มต้น */
         and app.tms_driver_names(t.driver_name) <> '{}';

      /* ไม่มีเที่ยวที่พร้อมเลย ก็กลับไปใช้วันล่าสุดที่มีข้อมูลตามเดิม
         หน้าเปล่ากับหน้าที่ยังไม่มีใครดึงข้อมูล ต้องแยกออกจากกันให้ได้ */
      if v_date is null then
        select max(order_date) into v_date from public.tms_trips;
      end if;
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
                 /* ค่าขนส่งติดมากับ Trip ของ TMS อยู่แล้ว แต่ไม่เคยถูกส่งออกมาให้หน้าเว็บ
                    cost = ค่าจ้างตามสัญญา, actual_cost = ที่ปิดจริงหลังจบงาน
                    0 ของ TMS แปลว่า "ยังไม่ลง" ไม่ใช่ "ฟรี" — ส่งเป็น null ให้หน้าเว็บ
                    แยกออกจากศูนย์จริงได้ ไม่ต้องไปเดาเอาเองทีหลัง */
                 nullif(t.cost, 0) as cost,
                 nullif(t.actual_cost, 0) as actual_cost,
                 t.trip_id is not null as imported,
                 t.trip_id,
                 dm.driver_id,
                 /* ชื่อที่ยังไม่รู้จักของ **เที่ยวนี้** เพื่อให้ปุ่มจับคู่อยู่ในแถวที่มันเกี่ยวข้อง
                    ไม่ใช่กองรวมอยู่ด้านบนแล้วให้คนเดาเองว่าชื่อไหนของเที่ยวไหน */
                 coalesce((
                   select array_agg(u.n order by u.ord)
                     from unnest(app.tms_driver_names(t.driver_name)) with ordinality as u(n, ord)
                     left join public.tms_driver_map m
                       on m.driver_key = u.n and not m.ignored and m.driver_id is not null
                    where m.driver_key is null
                 ), '{}') as unmapped_driver_names,
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
            /* จับคู่ทีละชื่อ ไม่ใช่ทั้งก้อน — คนขับหลักคือชื่อแรกที่จับคู่แล้ว */
            left join lateral (
              select dm.driver_id
                from unnest(app.tms_driver_names(t.driver_name)) with ordinality as u(n, ord)
                join public.tms_driver_map dm
                  on dm.driver_key = u.n and not dm.ignored and dm.driver_id is not null
               order by u.ord
               limit 1
            ) dm on true
           where t.order_date = v_date
        ) x
    ), '[]'::json),
    /* เหลือค้างอย่างเดียวที่คนต้องทำก่อนนำเข้าได้ */
    'unmapped_drivers', coalesce((
      select json_agg(distinct u.n)
        from public.tms_trips t
        cross join unnest(app.tms_driver_names(t.driver_name)) as u(n)
        left join public.tms_driver_map dm on dm.driver_key = u.n
       where t.order_date = v_date
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
