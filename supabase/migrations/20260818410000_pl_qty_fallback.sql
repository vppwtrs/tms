-- จำนวนในใบขึ้นเป็น 0 ทั้งที่เที่ยวรู้ยอดรวม
--
-- tms_trip_detail รวมจำนวนจาก item_split_qty/item_qty อย่างเดียว ใบชนิด TF (โอนย้าย)
-- ไม่มีสองค่านี้มาจาก TMS ใบจึงขึ้น "0 ชิ้น" และรายการขึ้น ×0 ทุกบรรทัด
-- ทั้งที่หัวเที่ยวบอกว่า 10 คัน — ตัวเลขสองที่ในจอเดียวกันขัดกันเอง
--
-- แก้สองอย่าง:
--  1. ถอยไปใช้ยอดของใบ (total_qty/unit) เมื่อรายการไม่มีจำนวน
--  2. คืนค่า null แทน 0 เมื่อไม่รู้จริง ๆ — "ไม่รู้" กับ "ศูนย์ชิ้น" ไม่ใช่เรื่องเดียวกัน
--     และ 0 ที่แสดงบนจอทำให้คนอ่านคิดว่าใบนี้ไม่มีของ

create or replace function public.tms_trip_detail(p_tms_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t public.tms_trips;
begin
  if not app.has_perm('dispatch.view') then
    raise exception 'ไม่มีสิทธิ์ดูแผนงาน' using errcode = '42501';
  end if;

  select * into v_t from public.tms_trips where tms_id = p_tms_id;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  return json_build_object(
    'trip_no', v_t.trip_no,
    'order_date', v_t.order_date,
    'warehouse_code', v_t.warehouse_code,
    'area', v_t.area,
    'license_plate', v_t.license_plate,
    'vehicle_type', v_t.vehicle_type,
    'driver_names', app.tms_driver_names(v_t.driver_name),
    'status', v_t.status,
    'status_id', v_t.status_id,
    'reason', v_t.reason,
    'cost', nullif(v_t.cost, 0),
    'actual_cost', nullif(v_t.actual_cost, 0),
    'total_pl', v_t.total_pl,
    'total_unit', v_t.total_unit,
    'imported', v_t.trip_id is not null,
    'picking_lists', coalesce((
      select json_agg(p order by p.picking_list_no)
        from (
          select s.picking_list_no,
                 max(s.pl_type)     as pl_type,
                 max(s.dealer_name) as dealer_name,
                 max(coalesce(s.ship_to_name, s.branch))    as ship_to_name,
                 max(coalesce(s.ship_to_province, s.province)) as province,
                 bool_or(m.customer_id is not null and not coalesce(m.ignored, false))
                   as customer_linked,
                 /* ยอดของใบ: รวมจากรายการก่อน ถ้ารายการไม่มีจำนวนเลยค่อยใช้ยอดที่ใบบอก
                    ไม่มีทั้งคู่ = ไม่รู้ ส่ง null ให้หน้าจอเขียนว่าไม่รู้ ไม่ใช่เขียนว่า 0 */
                 coalesce(
                   nullif(sum(coalesce(s.item_split_qty, s.item_qty, 0)), 0),
                   max(coalesce(s.total_qty, s.unit))
                 ) as qty,
                 coalesce((
                   select json_agg(i order by i.item_no)
                     from (
                       select s2.item_no,
                              max(s2.item_name) as item_name,
                              nullif(sum(coalesce(s2.item_split_qty, s2.item_qty, 0)), 0) as qty
                         from public.tms_shipments s2
                        where s2.tms_trip_id = p_tms_id
                          and s2.picking_list_no = s.picking_list_no
                          and coalesce(btrim(s2.item_no), '') <> ''
                        group by s2.item_no
                     ) i
                 ), '[]'::json) as items
            from public.tms_shipments s
            left join public.tms_dealer_map m on m.dealer_code = s.dealer_code
           where s.tms_trip_id = p_tms_id
           group by s.picking_list_no
        ) p
    ), '[]'::json)
  );
end;
$function$;
