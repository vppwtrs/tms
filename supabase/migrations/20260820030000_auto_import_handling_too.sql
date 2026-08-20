-- นำเข้าอัตโนมัติ: รับ Handling ด้วย ไม่ใช่แค่ Confirm
--
-- ประตูเดิมเทียบข้อความว่าต้องเป็น `confirm` เป๊ะ ๆ แต่สถานะใน TMS เดินหน้าไปเรื่อย
-- ไม่ได้ค้างรอให้ระบบเราเห็น เที่ยวที่ถูกยืนยันแล้วเริ่มจัดของ กลายเป็น `Handling`
-- ทันที ซึ่งอยู่ถัดจาก `Confirm` ไปหนึ่งขั้น ไม่ใช่ถอยกลับ — แต่ด่านเดิมอ่านว่า
-- "ไม่ใช่ confirm" แล้วปล่อยค้างรอคนกด
--
-- ผลจริง: รอบดึงที่มาช้ากว่าที่คลังทำงานหนึ่งก้าว จะไม่นำเข้าอะไรเลย
-- ตอนเขียนอยู่นี้มีเที่ยวค้างแบบนี้สามใบ ทั้งที่ผ่านการยืนยันมาแล้วทุกใบ
--
-- บันไดสถานะของ TMS: 2 Confirm → 3 Handling → 4 OnDelivery → 5 Completed
-- (6 คือยกเลิก ซึ่งกันไว้อยู่แล้ว)
--
-- รับถึงแค่ 3 โดยตั้งใจ ไม่ใช่ "ทุกอย่างตั้งแต่ 2 ขึ้นไป"
--   4 OnDelivery = รถออกไปแล้ว งานเดินไปโดยไม่ผ่านระบบเรา การส่งเข้าจอคนขับ
--     ตอนนั้นคือขอให้เขากดรับงานที่เขากำลังทำอยู่ ซึ่งอ่านไม่ออกว่าให้ทำอะไร
--   5 Completed = จบไปแล้ว ยิ่งไม่มีอะไรให้คนขับทำ
-- สองอันนั้นถ้าต้องเข้าระบบ ให้คนกดนำเข้าเองพร้อมเห็นว่ากำลังนำเข้าของที่วิ่งไปแล้ว
--
-- เทียบด้วย status_id เป็นหลัก ข้อความเป็นตัวสำรองเฉพาะแถวที่ไม่มี id ติดมา —
-- ข้อความมาจากระบบคนอื่น เขาเปลี่ยนคำเมื่อไหร่ก็ได้ ส่วนตัวเลขเป็นบันไดที่มีลำดับจริง
--
-- ด่านอื่นไม่ถูกแตะ: ชื่อคนขับต้องจับคู่ครบทุกชื่อ ต้องมีใบเบิกอย่างน้อยหนึ่งใบ
-- และต้องเป็นงานของวันนี้หรือเมื่อวาน คนขับยังต้องกดรับเองเหมือนเดิม

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

grant execute on function public.auto_import_trips() to authenticated;
