-- แก้บั๊ก: tms_trip_no อยู่ในตาราง orders ไม่ใช่ trips (migration ก่อนหน้าอ้างผิดตาราง
-- ทำให้ฟังก์ชันพังทั้งหมด — "column t.tms_trip_no does not exist")
-- ดึงเลขทริป TMS จากออเดอร์แรกของเที่ยวที่มีเลขนี้แทน เที่ยวที่สร้างเองไม่มีออเดอร์จาก TMS
-- เลย fallback ไปใช้ trip_no ภายในของเราเหมือนเดิม
create or replace function public.ops_today(p_from date default null::date, p_to date default null::date)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  v_tz    constant text := 'Asia/Bangkok';
  v_free_stops constant int := 5;
  v_rate       constant numeric := 50;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_to    date := coalesce(p_to, p_from, v_today);
  v_from  date := coalesce(p_from, v_to);
  v_money boolean;
  v_out   jsonb;
begin
  if not app.has_perm('dashboard.view') then
    raise exception 'ไม่มีสิทธิ์ดูหน้าภาพรวม' using errcode = '42501';
  end if;

  if v_from > v_to then
    raise exception 'ช่วงวันกลับหัว' using errcode = '22007';
  end if;
  if v_to - v_from > 366 then
    raise exception 'ช่วงวันยาวเกิน 1 ปี' using errcode = '22003';
  end if;

  v_money := app.has_perm('dispatch.view');

  with
  tr as (
    select t.id,
           t.vehicle_id,
           t.driver_id,
           coalesce(
             (select o2.tms_trip_no from public.orders o2
               where o2.trip_id = t.id and o2.tms_trip_no is not null limit 1),
             t.trip_no
           ) as trip_no,
           t.status,
           t.freight_cost,
           t.freight_actual_cost,
           ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date as trip_date
      from public.trips t
     where t.status <> 'cancelled'
       and ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date
           between v_from and v_to
  ),
  ord as (
    select tr.id as trip_id,
           app.stop_key(o.customer_id, o.destination) as stop_key,
           o.destination,
           o.status,
           o.delivered_at,
           o.tms_picking_list_no,
           o.id as order_id,
           coalesce(o.work_kind, 'vehicle') as work_kind,
           coalesce(o.tms_unit_count, 0) as units
      from public.orders o
      join tr on tr.id = o.trip_id
  ),
  stop as (
    select trip_id,
           stop_key,
           (array_agg(destination order by length(coalesce(destination, '')) desc))[1] as name,
           bool_and(status = 'cancelled') as cancelled,
           count(*) filter (where status not in ('delivered', 'cancelled')) = 0 as done,
           max(delivered_at) as last_delivered_at
      from ord
     group by trip_id, stop_key
  ),
  trip_stop as (
    select tr.id,
           tr.vehicle_id,
           tr.trip_no,
           tr.trip_date,
           tr.status,
           tr.freight_cost,
           tr.freight_actual_cost,
           count(s.stop_key) as stops,
           count(*) filter (where s.done and not s.cancelled) as stops_done
      from tr
      left join stop s on s.trip_id = tr.id
     group by tr.id, tr.vehicle_id, tr.trip_no, tr.trip_date, tr.status, tr.freight_cost, tr.freight_actual_cost
  ),
  trip_crew as (
    select t.id as trip_id, d.driver_id
      from tr t
      join lateral (
        select t.driver_id as driver_id where t.driver_id is not null
        union
        select td.driver_id from public.trip_drivers td where td.trip_id = t.id
      ) d on true
  ),
  trip_bonus as (
    select ts.id,
           ts.vehicle_id,
           greatest(ts.stops - v_free_stops, 0) as paid_stops,
           greatest(ts.stops - v_free_stops, 0) * v_rate as bonus,
           greatest((select count(*) from trip_crew tc where tc.trip_id = ts.id), 1) as crew
      from trip_stop ts
  ),
  veh as (
    select ts.vehicle_id,
           count(*) as trips,
           sum(ts.stops) as stops,
           sum(ts.stops_done) as stops_done,
           max(ts.stops) as max_trip_stops,
           sum(tb.bonus) as bonus,
           max(tb.crew) as crew,
           sum(ts.freight_cost) as cost_plan,
           sum(ts.freight_actual_cost) as cost_actual,
           count(*) filter (where ts.freight_actual_cost is null) as trips_open_cost,
           bool_or(ts.stops > v_free_stops) as over_free
      from trip_stop ts
      join trip_bonus tb on tb.id = ts.id
     where ts.vehicle_id is not null
     group by ts.vehicle_id
  ),
  veh_last as (
    select distinct on (ts.vehicle_id)
           ts.vehicle_id,
           s.name as last_stop,
           s.last_delivered_at
      from trip_stop ts
      join stop s on s.trip_id = ts.id
     where ts.vehicle_id is not null
       and s.last_delivered_at is not null
     order by ts.vehicle_id, s.last_delivered_at desc
  ),
  veh_crew as (
    select ts.vehicle_id,
           string_agg(distinct d.name, ' + ' order by d.name) as crew_names
      from trip_stop ts
      join trip_crew tc on tc.trip_id = ts.id
      join public.drivers d on d.id = tc.driver_id
     where ts.vehicle_id is not null
     group by ts.vehicle_id
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'days', (v_to - v_from) + 1,
    'date', v_to,
    'money', v_money,

    'today', jsonb_build_object(
      'vehicles_used', (select count(*) from veh),
      'vehicles_usable', (select count(*) from public.vehicles
                           where status in ('available', 'on_trip')),
      'vehicles_free', (select count(*) from public.vehicles where status = 'available'),
      'trips', (select count(*) from tr),
      'shipments', (select count(distinct coalesce(tms_picking_list_no, 'ORD-' || order_id))
                      from ord),
      'stops', (select count(*) from stop),
      'stops_done', (select count(*) from stop where done and not cancelled),
      'cost_plan', case when v_money then (select sum(freight_cost) from tr) end,
      'cost_actual', case when v_money then (select sum(freight_actual_cost) from tr) end,
      'trips_open_cost', case when v_money then
        (select count(*) from tr where freight_actual_cost is null) end,
      'bonus_total', case when v_money then
        (select coalesce(sum(bonus), 0) from trip_bonus) end,
      'bonus_trips', (select count(*) from trip_bonus where paid_stops > 0)
    ),

    'units', coalesce((
      select jsonb_agg(jsonb_build_object('kind', kind, 'orders', n, 'units', u)
                       order by u desc, n desc)
        from (select work_kind as kind, count(*) as n, sum(units) as u
                from ord group by work_kind) k
    ), '[]'::jsonb),

    'fleet', coalesce((
      select jsonb_agg(jsonb_build_object(
               'vehicle_id', v.vehicle_id,
               'plate', vv.plate_no,
               'crew', vc.crew_names,
               'crew_size', v.crew,
               'trips', v.trips,
               'stops', v.stops,
               'stops_done', v.stops_done,
               'max_trip_stops', v.max_trip_stops,
               'over_free', v.over_free,
               'last_stop', vl.last_stop,
               'last_at', vl.last_delivered_at,
               'cost_plan', case when v_money then v.cost_plan end,
               'cost_actual', case when v_money then v.cost_actual end,
               'cost_open', v.trips_open_cost,
               'bonus', case when v_money then v.bonus end
             ) order by v.stops desc, vv.plate_no)
        from veh v
        join public.vehicles vv on vv.id = v.vehicle_id
        left join veh_last vl on vl.vehicle_id = v.vehicle_id
        left join veh_crew vc on vc.vehicle_id = v.vehicle_id
    ), '[]'::jsonb),

    'trip_rows', case when v_money then coalesce((
      select jsonb_agg(jsonb_build_object(
               'plate', vv.plate_no,
               'trip_no', ts.trip_no,
               'trip_date', ts.trip_date,
               'stops', ts.stops,
               'stops_done', ts.stops_done,
               'paid_stops', tb.paid_stops,
               'bonus', tb.bonus,
               'cost_plan', ts.freight_cost,
               'cost_actual', ts.freight_actual_cost
             ) order by vv.plate_no, ts.trip_date, ts.trip_no)
        from trip_stop ts
        join trip_bonus tb on tb.id = ts.id
        join public.vehicles vv on vv.id = ts.vehicle_id
       where ts.vehicle_id is not null
    ), '[]'::jsonb) end,

    'bonus_rule', jsonb_build_object('free_stops', v_free_stops, 'rate', v_rate)
  )
  into v_out;

  return v_out;
end;
$function$;
