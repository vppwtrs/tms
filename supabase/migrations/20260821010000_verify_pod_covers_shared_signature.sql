/*
 * ยืนยันหลักฐาน: ลายเซ็นชุดเดียว = ยืนยันครั้งเดียว
 *
 * อาการที่เจอหน้างาน: ร้านที่มีสองใบขึ้นไป กดยืนยันแล้วป้ายของร้านไม่เปลี่ยน
 * ยังค้างเป็น "POD" ทั้งที่เพิ่งกดยืนยันไป แต่พอกดยกเลิกการยืนยัน ป้ายเปลี่ยนทันที
 * ดูเหมือนปุ่มยืนยันเสีย ทั้งที่มันทำงานถูกทุกครั้ง
 *
 * ต้นเหตุ: คนขับเซ็นครั้งเดียวที่หน้าร้าน แต่ระบบเขียน pod แยกใบละแถว
 * (ลายเซ็นกับรูปชุดเดียวกันถูกอ้างซ้ำทุกแถว) ส่วน verify_pod ยืนยันทีละแถว
 * ป้ายของร้านขึ้น "ยืนยันแล้ว" ก็ต่อเมื่อครบทุกใบ กดหนึ่งใบจากสองใบจึงไม่มีอะไรขยับ
 * ส่วนการยกเลิกดูเหมือนได้ผลทันทีเพราะเงื่อนไข "ครบทุกใบ" พังทันทีที่ปลดใบเดียว
 *
 * วิธีแก้: ให้ทั้งยืนยันและยกเลิกทำกับ "ชุดลายเซ็นเดียวกัน" ทั้งชุด
 * นิยามของชุด = ใบที่อยู่เที่ยวเดียวกัน จุดส่งเดียวกัน และลายเซ็นตรงกันทุกตัวอักษร
 * ไม่ใช่แค่ "จุดส่งเดียวกัน" เฉย ๆ เพราะร้านเดียวกันอาจถูกส่งสองรอบคนละลายเซ็น
 * และรอบที่คนตรวจยังไม่ได้ดู ต้องไม่ถูกยืนยันไปด้วยโดยที่ไม่มีใครตั้งใจ
 *
 * บันทึกลง evidence_audit_log ทุกแถวที่ถูกแตะเหมือนเดิม — ถ้ายืนยันสามใบ
 * ก็ต้องมีสามบรรทัด ไม่ใช่บรรทัดเดียวแล้วให้คนอ่านทีหลังเดาว่ากินไปถึงใบไหนบ้าง
 *
 * สิทธิ์ ข้อความ และรูปแบบค่าที่คืนกลับ เหมือนเดิมทั้งหมด หน้าเว็บไม่ต้องแก้
 * เพิ่มมาตัวเดียวคือ `covered` = จำนวนใบที่การกดครั้งนั้นกินไปจริง
 */

create or replace function public.verify_pod(p_pod_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public', 'auth'
as $fn$
declare
  v_pod   public.pod;
  v_order public.orders;
  v_ids   bigint[];
  v_id    bigint;
  v_done  int := 0;
begin
  if not app.has_perm('pod.verify') then
    raise exception 'ไม่มีสิทธิ์ยืนยันหลักฐานการส่งมอบ' using errcode = '42501';
  end if;

  select * into v_pod from public.pod where id = p_pod_id for update;
  if not found then
    raise exception 'ไม่พบหลักฐานใบนี้' using errcode = 'P0002';
  end if;

  select * into v_order from public.orders where id = v_pod.order_id;

  /* ใบอื่นที่ใช้ลายเซ็นแผ่นเดียวกันของจุดส่งเดียวกันในเที่ยวเดียวกัน
     ล็อกไว้ทั้งชุดก่อนแก้ กันคนสองคนกดยืนยันคนละใบพร้อมกันแล้วได้ผลครึ่ง ๆ */
  select array_agg(p.id order by p.id)
    into v_ids
    from public.pod p
    join public.orders o on o.id = p.order_id
   where p.status <> 'verified'
     and o.trip_id is not distinct from v_order.trip_id
     and o.destination is not distinct from v_order.destination
     and o.customer_id is not distinct from v_order.customer_id
     and p.signature_data is not distinct from v_pod.signature_data;

  if v_ids is null or array_length(v_ids, 1) is null then
    /* ยืนยันซ้ำไม่ใช่ error — คนสองคนกดพร้อมกันจากคนละหน้าจอเกิดขึ้นได้จริง
       และผลลัพธ์ที่ได้ก็ตรงกับที่ทั้งคู่ต้องการอยู่แล้ว */
    return json_build_object('id', v_pod.id, 'status', 'verified', 'already', true, 'covered', 0);
  end if;

  foreach v_id in array v_ids loop
    perform 1 from public.pod where id = v_id for update;

    update public.pod set status = 'verified', updated_at = now() where id = v_id;

    insert into public.evidence_audit_log (actor_user_id, action, order_id, pod_id, detail)
    select app.current_user_id(), 'pod_verified', p.order_id, p.id,
           json_build_object('recipient_name', p.recipient_name,
                             'with_pod_id', v_pod.id)
      from public.pod p where p.id = v_id;

    v_done := v_done + 1;
  end loop;

  return json_build_object('id', v_pod.id, 'status', 'verified', 'already', false, 'covered', v_done);
end;
$fn$;

grant execute on function public.verify_pod(bigint) to authenticated;

/* การยกเลิกต้องกินทั้งชุดเหมือนกัน ไม่งั้นจะเกิดสภาพที่ไม่มีใครสั่ง:
   ลายเซ็นแผ่นเดียว แต่บางใบยืนยันแล้วบางใบไม่ ซึ่งอ่านไม่ออกว่าใครตั้งใจอะไร */
create or replace function public.unverify_pod(p_pod_id bigint, p_reason text)
returns json
language plpgsql
security definer
set search_path to 'public', 'auth'
as $fn$
declare
  v_pod   public.pod;
  v_order public.orders;
  v_ids   bigint[];
  v_id    bigint;
  v_done  int := 0;
begin
  if not app.has_perm('pod.verify') then
    raise exception 'ไม่มีสิทธิ์ยกเลิกการยืนยันหลักฐาน' using errcode = '42501';
  end if;

  /* เหตุผลบังคับ — บันทึกที่บอกว่า "ถูกปลด" โดยไม่บอกว่าทำไม ตอบข้อโต้แย้ง
     กับลูกค้าไม่ได้ ซึ่งคือเหตุผลเดียวที่บันทึกนี้มีอยู่ */
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องระบุเหตุผลที่ยกเลิกการยืนยัน' using errcode = 'P0001';
  end if;

  select * into v_pod from public.pod where id = p_pod_id for update;
  if not found then
    raise exception 'ไม่พบหลักฐานใบนี้' using errcode = 'P0002';
  end if;

  select * into v_order from public.orders where id = v_pod.order_id;

  select array_agg(p.id order by p.id)
    into v_ids
    from public.pod p
    join public.orders o on o.id = p.order_id
   where p.status = 'verified'
     and o.trip_id is not distinct from v_order.trip_id
     and o.destination is not distinct from v_order.destination
     and o.customer_id is not distinct from v_order.customer_id
     and p.signature_data is not distinct from v_pod.signature_data;

  if v_ids is null or array_length(v_ids, 1) is null then
    return json_build_object('id', v_pod.id, 'status', v_pod.status, 'already', true, 'covered', 0);
  end if;

  foreach v_id in array v_ids loop
    perform 1 from public.pod where id = v_id for update;

    update public.pod set status = 'collected', updated_at = now() where id = v_id;

    insert into public.evidence_audit_log (actor_user_id, action, order_id, pod_id, detail)
    select app.current_user_id(), 'pod_unverified', p.order_id, p.id,
           json_build_object('reason', btrim(p_reason), 'with_pod_id', v_pod.id)
      from public.pod p where p.id = v_id;

    v_done := v_done + 1;
  end loop;

  return json_build_object('id', v_pod.id, 'status', 'collected', 'already', false, 'covered', v_done);
end;
$fn$;

grant execute on function public.unverify_pod(bigint, text) to authenticated;
