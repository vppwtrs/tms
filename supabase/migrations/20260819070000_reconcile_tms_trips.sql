-- เที่ยวที่หายไปจาก TMS ต้องหายจากของเราด้วย
--
-- รอบดึงข้อมูลเดิมเป็น "เติมอย่างเดียว" (upsert) เที่ยวที่ TMS ลบทิ้งหรือย้ายไปให้
-- ผู้รับจ้างรายอื่น จึงค้างอยู่ในตารางของเราตลอดไป หน้าจอขึ้นเป็นเที่ยวที่กดสั่งงานได้
-- ทั้งที่ต้นทางไม่มีอยู่แล้ว — เที่ยวเปล่า 0 ใบ 0 คัน ที่เห็นบนหน้าจอคือหน้าตาของอาการนี้
--
-- เทียบแล้วลบ ไม่ใช่ลบตามใจ: ผู้เรียกส่งรายการ tms_id ที่ "เห็นจริงในรอบนี้" มาให้
-- ทุกแถวในช่วงวันและคลังเดียวกันที่ไม่อยู่ในรายการนั้น คือแถวที่ต้นทางไม่มีแล้ว
--
-- กติกาความปลอดภัยข้อเดียว: **เที่ยวที่นำเข้าเป็นงานแล้วห้ามลบ** งานนั้นอาจมีคนขับ
-- รับไปแล้ว วิ่งอยู่ หรือมี POD แล้ว การลบเงียบ ๆ คือทำหลักฐานหาย ฟังก์ชันจึงคืน
-- รายการพวกนี้กลับไปให้หน้าจอเตือนคนแทน แล้วให้คนตัดสินใจเอง
--
-- ผู้เรียกต้องมั่นใจว่ารอบดึงครอบคลุมช่วงวันนั้นครบจริง ถ้าไล่หน้าไม่หมดแล้วเรียกอันนี้
-- เที่ยวที่ยังไม่ทันถูกอ่านจะถูกนับเป็น "หายไป" ทั้งที่ยังอยู่ — ฝั่งเว็บจึงเรียกเฉพาะรอบ
-- ที่อ่านจนจบชุดข้อมูลของวันนั้นแล้วเท่านั้น

create or replace function public.reconcile_tms_trips(
  p_from date,
  p_to date,
  p_warehouses text[],
  p_seen uuid[]
)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_missing uuid[];
  v_deleted int := 0;
  v_shipments int := 0;
  v_imported json;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  if p_from is null or p_to is null or coalesce(array_length(p_warehouses, 1), 0) = 0 then
    raise exception 'ต้องระบุช่วงวันและคลัง' using errcode = 'P0001';
  end if;

  select array_agg(t.tms_id) into v_missing
    from public.tms_trips t
   where t.order_date between p_from and p_to
     and t.warehouse_code = any(p_warehouses)
     and not (t.tms_id = any(coalesce(p_seen, '{}'::uuid[])));

  if v_missing is null then
    return json_build_object('deleted', 0, 'shipments', 0, 'kept_imported', '[]'::json);
  end if;

  /* เที่ยวที่กลายเป็นงานไปแล้ว — บอกกลับไป ไม่แตะ */
  select coalesce(json_agg(json_build_object(
           'trip_no', t.trip_no, 'our_trip_id', t.trip_id)), '[]'::json)
    into v_imported
    from public.tms_trips t
   where t.tms_id = any(v_missing) and t.trip_id is not null;

  /* ใบดิบของเที่ยวที่ไม่มีแล้ว ลบพร้อมกัน — ใบที่ถูกสั่งงานไปแล้ว (order_id ไม่ว่าง)
     ไม่แตะ เพราะออเดอร์ของจริงยังอ้างถึงมันอยู่ */
  delete from public.tms_shipments s
   where s.tms_trip_id = any(v_missing)
     and s.order_id is null
     and exists (
       select 1 from public.tms_trips t
        where t.tms_id = s.tms_trip_id and t.trip_id is null
     );
  get diagnostics v_shipments = row_count;

  delete from public.tms_trips t
   where t.tms_id = any(v_missing) and t.trip_id is null;
  get diagnostics v_deleted = row_count;

  return json_build_object(
    'deleted', v_deleted,
    'shipments', v_shipments,
    'kept_imported', v_imported
  );
end;
$fn$;

grant execute on function public.reconcile_tms_trips(date, date, text[], uuid[]) to authenticated;
