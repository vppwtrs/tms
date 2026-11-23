-- หน้าติดตามรถอ่านพิกัดจากเช็กพอยต์ด้วย
-- ตั้งแต่ 19 พ.ย. แอปคนขับเลิกส่งตำแหน่งต่อเนื่องเข้า trip_locations และเก็บ GPS
-- เฉพาะตอนกดปุ่ม (ออกวิ่ง ถึงร้าน ส่งเสร็จ พัก เติมน้ำมัน ปิดงาน) ลง trip_checkpoints
-- หน้าติดตามรถยังอ่านแค่ trip_locations จึงไม่เห็นพิกัดใหม่เลย
-- รวมสองแหล่งเข้าด้วยกัน — เที่ยวเก่ายังมีเส้นทางเดิม เที่ยวใหม่ได้จุดเช็กพอยต์

create or replace function public.trip_track(p_trip_id bigint)
 returns json
 language sql
 stable security definer
 set search_path to 'public', 'auth'
as $function$
  select coalesce(json_agg(json_build_object(
           'lat', s.lat, 'lng', s.lng,
           'accuracy_m', s.accuracy_m,
           'recorded_at', s.recorded_at) order by s.recorded_at), '[]'::json)
    from (
      select l.lat, l.lng, l.accuracy_m, l.recorded_at
        from public.trip_locations l
       where l.trip_id = p_trip_id
      union all
      select c.lat, c.lng, c.accuracy_m, c.recorded_at
        from public.trip_checkpoints c
       where c.trip_id = p_trip_id and c.lat is not null and c.lng is not null
    ) s
    join public.trips t on t.id = p_trip_id
   where ((app.has_perm('dispatch.view') or app.has_perm('tracking.view'))
          or t.driver_id = app.current_driver_id()
          or exists (select 1 from public.trip_drivers td
                      where td.trip_id = t.id
                        and td.driver_id = app.current_driver_id()));
$function$;

create or replace function public.tracking_board()
 returns json
 language sql
 stable security definer
 set search_path to 'public', 'auth'
as $function$
  select coalesce(json_agg(x order by x.trip_no), '[]'::json)
    from (
      select t.id as trip_id,
             t.trip_no,
             t.status,
             t.departed_at,
             t.arrived_at,
             t.returned_at,
             v.plate_no,
             (select string_agg(d.name, ', ' order by td.seq)
                from public.trip_drivers td
                join public.drivers d on d.id = td.driver_id
               where td.trip_id = t.id) as drivers,
             (select json_build_object('lat', s.lat, 'lng', s.lng,
                                       'accuracy_m', s.accuracy_m,
                                       'recorded_at', s.recorded_at)
                from (
                  select l.lat, l.lng, l.accuracy_m, l.recorded_at
                    from public.trip_locations l
                   where l.trip_id = t.id
                  union all
                  select c.lat, c.lng, c.accuracy_m, c.recorded_at
                    from public.trip_checkpoints c
                   where c.trip_id = t.id and c.lat is not null and c.lng is not null
                ) s
               order by s.recorded_at desc
               limit 1) as last_seen,
             (select count(*) from public.orders o
               where o.trip_id = t.id and o.status = 'delivered') as stops_done,
             (select count(*) from public.orders o where o.trip_id = t.id) as stops_total,
             (select coalesce(json_agg(json_build_object(
                       'order_id', p.order_id, 'lat', p.lat, 'lng', p.lng,
                       'collected_at', p.collected_at) order by p.collected_at), '[]'::json)
                from public.pod p
                join public.orders o on o.id = p.order_id
               where o.trip_id = t.id and p.lat is not null) as pod_points
        from public.trips t
        join public.vehicles v on v.id = t.vehicle_id
       where (t.status in ('planned', 'in_progress', 'returning')
              or (t.status = 'completed'
                  and t.arrived_at is not null
                  and (timezone('Asia/Bangkok', t.arrived_at))::date
                      = (timezone('Asia/Bangkok', now()))::date))
         and ((app.has_perm('dispatch.view') or app.has_perm('tracking.view'))
              or t.driver_id = app.current_driver_id()
              or exists (select 1 from public.trip_drivers td
                          where td.trip_id = t.id
                            and td.driver_id = app.current_driver_id()))
    ) x;
$function$;

create index if not exists trip_checkpoints_trip_recorded_idx
  on public.trip_checkpoints (trip_id, recorded_at desc);
