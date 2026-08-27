-- auto_import_trips เปิดให้ anon เรียกได้มาตลอด (execute ตกถึง public โดยปริยาย)
-- ตัวมันเองไม่มีด่านสิทธิ์ พึ่งยามของ import_tms_trip ที่เรียกภายในเท่านั้น ผลคือ
-- คนที่ไม่มีสิทธิ์ยิงได้ แล้วทุกเที่ยว fail เงียบใน exception — เปลือง ไม่ปฏิเสธชัด
--
-- ปิดสองชั้น: (1) ถอน execute จาก anon/public ให้เหลือเฉพาะ authenticated
-- (2) ใส่ด่าน has_perm('dispatch.write') ที่บรรทัดแรก คีย์เดียวกับ import_tms_trip
--     ที่มันเรียกต่อ คนล็อกอินที่ไม่มีสิทธิ์จัดเที่ยวจึงถูกปฏิเสธตั้งแต่ต้น ไม่วน loop
--
-- ตัวเรียกในเว็บ (CloudTmsTrips หลังจับคู่ชื่อคนขับ) อยู่ใน try/catch เงียบอยู่แล้ว
-- และคนที่ทำงานตรงนั้นมี dispatch.write ติดตัว flow เดิมจึงไม่กระทบ

create or replace function public.auto_import_trips()
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_t        record;
  v_res      json;
  v_imported int := 0;
  v_orders   int := 0;
  v_waiting  int := 0;
  v_failed   int := 0;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์นำเข้าเที่ยว' using errcode = '42501';
  end if;

  for v_t in
    select t.tms_id,
           t.trip_no,
           /* จับคู่ครบ = ทุกชื่อที่แยกออกมาแล้วมีคนในระบบรออยู่
              เทียบจำนวน ไม่ใช่เช็คแค่ชื่อแรก เที่ยวที่ไปสองคนต้องครบทั้งคู่ */
           cardinality(app.tms_driver_names(t.driver_name)) as names,
           (select count(*)
              from unnest(app.tms_driver_names(t.driver_name)) as u(n)
              join public.tms_driver_map m
                on m.driver_key = u.n and not m.ignored and m.driver_id is not null
           ) as mapped
      from public.tms_trips t
     where t.trip_id is null
       and t.status_id is distinct from 6
       /* ผ่าน Confirm มาแล้ว และยังไม่ออกวิ่ง */
       and (
         case
           when t.status_id is not null then t.status_id in (2, 3)
           else lower(btrim(coalesce(t.status, ''))) in ('confirm', 'handling')
         end
       )
       and t.order_date >= current_date - 1
       and app.tms_driver_names(t.driver_name) <> '{}'
       /* เที่ยวเปล่าไม่ส่งถึงคนขับ — จอเขาจะขึ้นงานที่ไม่มีจุดส่งสักจุด
          และเที่ยวแบบนั้นมักแปลว่า TMS ยังผูกใบไม่เสร็จ ไม่ใช่ว่าไม่มีของจริง */
       and exists (select 1 from public.tms_shipments s where s.tms_trip_id = t.tms_id)
     order by t.order_date, t.trip_no
  loop
    if v_t.mapped < v_t.names then
      v_waiting := v_waiting + 1;
      continue;
    end if;

    /* เที่ยวหนึ่งพังไม่ควรหยุดทั้งรอบ — ของที่เหลือยังนำเข้าได้
       เที่ยวที่พังจะยังค้างให้กดเองแล้วเห็นสาเหตุเต็ม ๆ ในหน้าจอ */
    begin
      v_res := public.import_tms_trip(v_t.tms_id);
      if not coalesce((v_res->>'already')::boolean, false) then
        v_imported := v_imported + 1;
        v_orders := v_orders + coalesce((v_res->>'created_orders')::int, 0);
      end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return json_build_object(
    'imported', v_imported,
    'created_orders', v_orders,
    'waiting_for_driver', v_waiting,
    'failed', v_failed
  );
end;
$fn$;

revoke execute on function public.auto_import_trips() from anon, public;
grant  execute on function public.auto_import_trips() to authenticated;
