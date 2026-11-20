-- ให้ฟังก์ชัน/นโยบายที่ดึงข้อมูลของ 4 เมนู รับสิทธิ์ใหม่ด้วย (ต่อจาก 20261120020000_split_menu_perms)
-- สิทธิ์เดิมยังใช้ได้ทุกจุด — แค่เพิ่ม "หรือสิทธิ์ใหม่" เข้าไป ไม่มีใครเสียการเข้าถึง
--   tms.view        : preview_tms_trips, tms_trip_detail, drivers_busy_on, tms_pull_coverage, tms_board
--                     + อ่าน tms_trips, tms_shipments, tms_pull_runs
--   documents.print : tms_board, tms_pull_coverage + อ่าน tms_shipments, tms_pull_runs
--   labels.print    : tms_board + อ่าน tms_shipments
--   tracking.view   : tracking_board, trip_track + อ่าน trip_locations
-- ดัดจากนิยามปัจจุบันใน DB เฉพาะจุดเช็กสิทธิ์ (ข้ามถ้าเคยดัดแล้ว จึงรันซ้ำได้)

create or replace function pg_temp.widen(p_fn regprocedure, p_from text, p_extra text[])
returns void language plpgsql as $f$
declare v text; v_new text; e text;
begin
  v := pg_get_functiondef(p_fn);
  v_new := format('app.has_perm(%L)', p_from);
  foreach e in array p_extra loop
    if position(format('app.has_perm(%L)', e) in v) > 0 then return; end if;
    v_new := v_new || format(' or app.has_perm(%L)', e);
  end loop;
  execute replace(v, format('app.has_perm(%L)', p_from), '(' || v_new || ')');
end $f$;

select pg_temp.widen('public.preview_tms_trips(date)', 'dispatch.view', array['tms.view']);
select pg_temp.widen('public.tms_trip_detail(uuid)', 'dispatch.view', array['tms.view']);
select pg_temp.widen('public.drivers_busy_on(date,bigint[])', 'dispatch.view', array['tms.view']);
select pg_temp.widen('public.tms_pull_coverage(integer)', 'dispatch.view', array['tms.view','documents.print']);
select pg_temp.widen('public.tms_board(date)', 'orders.view', array['tms.view','documents.print','labels.print']);
select pg_temp.widen('public.tracking_board()', 'dispatch.view', array['tracking.view']);
select pg_temp.widen('public.trip_track(bigint)', 'dispatch.view', array['tracking.view']);

alter policy tms_trips_select on public.tms_trips
  using (app.has_perm('dispatch.view') or app.has_perm('tms.view'));
alter policy tms_shipments_select on public.tms_shipments
  using (app.has_perm('orders.view') or app.has_perm('tms.view')
         or app.has_perm('documents.print') or app.has_perm('labels.print'));
alter policy tms_pull_runs_read on public.tms_pull_runs
  using (app.has_perm('dispatch.view') or app.has_perm('orders.write')
         or app.has_perm('tms.view') or app.has_perm('documents.print'));
alter policy trip_locations_read on public.trip_locations
  using (app.has_perm('dispatch.view') or app.has_perm('tracking.view')
         or driver_id = app.current_driver_id()
         or exists (select 1 from public.trip_drivers td
                     where td.trip_id = trip_locations.trip_id
                       and td.driver_id = app.current_driver_id()));
