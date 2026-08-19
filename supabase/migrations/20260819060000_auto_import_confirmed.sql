-- เที่ยวที่ข้อมูลครบแล้ว ส่งถึงคนขับเอง
--
-- ของเดิมปิดการนำเข้าอัตโนมัติทิ้งทั้งก้อน เพราะชื่อคนขับใน TMS เป็นข้อความอิสระ
-- แล้วระบบเดาเองว่าชื่อไหนคือใคร ซึ่งจ่ายงานผิดคนสะสมมาเรื่อย ๆ
--
-- สิ่งที่เปลี่ยนไปตั้งแต่ตอนนั้นคือมี tms_driver_map — คนวางแผนตอบ "ชื่อนี้คือใคร"
-- ครั้งเดียวแล้วคำตอบถูกจำไว้ ตัวที่เคยอันตรายคือ "การเดา" ไม่ใช่ "การอัตโนมัติ"
-- รอบนี้จึงเปิดอัตโนมัติกลับมาโดยไม่เดาเลยแม้แต่ชื่อเดียว: ชื่อไหนยังไม่มีคำตอบ
-- เที่ยวนั้นค้างรอคนกดเหมือนเดิม
--
-- ประตูที่ต้องผ่านครบทุกข้อถึงจะเข้าเอง:
--   1. TMS ยืนยันแล้ว (status = Confirm) — ก่อนหน้านั้นแผนยังเปลี่ยนได้ทั้งรถและของ
--   2. ชื่อคนขับทุกชื่อในเที่ยวจับคู่กับคนในระบบแล้ว
--   3. มีใบเบิกอย่างน้อยหนึ่งใบ — เที่ยวเปล่าส่งถึงคนขับแล้วเขาไม่มีอะไรให้ทำ
--   4. เป็นงานของวันนี้หรือเมื่อวาน — รอบดึงข้อมูลไม่ควรลากงานเก่าทั้งเดือนเข้ามา
--
-- คนขับยังต้องกดรับงานเองอยู่ การนำเข้าไม่ได้แปลว่ารับงานแล้ว

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
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
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
       and lower(btrim(coalesce(t.status, ''))) = 'confirm'
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

grant execute on function public.auto_import_trips() to authenticated;
