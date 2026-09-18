-- สถิติการใช้รถรายคัน — กราฟระยะทาง/ค่าทางด่วนตามวัน/เดือน/ปี + อันดับคนขับตามชั่วโมงใช้งาน
-- โครง bucket/grain ก๊อปแบบมาจาก ops_volume() ให้พฤติกรรม partial/ช่วงเวลาตรงกัน
create or replace function public.vehicle_usage(p_vehicle_id bigint, p_grain text default 'day'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app'
as $$
declare
  v_tz    constant text := 'Asia/Bangkok';
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_grain text := lower(coalesce(p_grain, 'day'));
  v_unit  text;
  v_span  int;
  v_out   jsonb;
begin
  if not app.has_perm('vehicles.view') then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลรถ' using errcode = '42501';
  end if;

  if v_grain = 'month' then
    v_unit := 'month'; v_span := 12;
  elsif v_grain = 'year' then
    v_unit := 'year';  v_span := 5;
  else
    v_grain := 'day';  v_unit := 'day'; v_span := 14;
  end if;

  with
  bucket as (
    select generate_series(
             date_trunc(v_unit, v_today::timestamp) - ((v_span - 1) || ' ' || v_unit)::interval,
             date_trunc(v_unit, v_today::timestamp),
             ('1 ' || v_unit)::interval
           )::date as key
  ),
  tr as (
    select t.id, t.driver_id, t.toll_cost, t.departed_at, t.returned_at,
           date_trunc(v_unit,
             ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date::timestamp
           )::date as key
      from public.trips t
     where t.vehicle_id = p_vehicle_id
       and t.status <> 'cancelled'
       and ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date
           >= (select min(key) from bucket)
  ),
  odo as (
    select trip_id,
           max(reading_km) filter (where kind = 'end') - min(reading_km) filter (where kind = 'start') as distance_km
      from public.vehicle_odometer
     where trip_id in (select id from tr)
     group by trip_id
  ),
  agg as (
    select b.key,
           coalesce((select sum(odo.distance_km) from tr join odo on odo.trip_id = tr.id where tr.key = b.key and odo.distance_km > 0), 0) as distance_km,
           coalesce((select sum(tr.toll_cost) from tr where tr.key = b.key), 0) as toll_cost
      from bucket b
  ),
  driver_hours as (
    select tr.driver_id,
           sum(extract(epoch from (tr.returned_at - tr.departed_at)) / 3600.0) as hours,
           count(*) as trips
      from tr
     where tr.driver_id is not null and tr.departed_at is not null and tr.returned_at is not null
     group by tr.driver_id
  )
  select jsonb_build_object(
    'grain', v_grain,
    'points', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', a.key,
               'distance_km', a.distance_km,
               'toll_cost', a.toll_cost,
               'partial', a.key = date_trunc(v_unit, v_today::timestamp)::date
             ) order by a.key)
        from agg a
    ), '[]'::jsonb),
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'driver_id', dh.driver_id,
               'driver_name', d.name,
               'hours', round(dh.hours::numeric, 1),
               'trips', dh.trips
             ) order by dh.hours desc)
        from driver_hours dh
        join public.drivers d on d.id = dh.driver_id
    ), '[]'::jsonb)
  )
  into v_out;

  return v_out;
end;
$$;

grant execute on function public.vehicle_usage(bigint, text) to authenticated;
