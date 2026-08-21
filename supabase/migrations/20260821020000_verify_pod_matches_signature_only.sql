/*
 * ยืนยันหลักฐาน: ผูกชุดด้วย "ลายเซ็นแผ่นเดียวกัน" อย่างเดียว
 *
 * รอบก่อน (20260821010000) ผูกชุดด้วย เที่ยว + จุดส่ง + ลายเซ็น ซึ่งยังไม่ครอบคลุม
 * ของจริง: ร้านหนึ่งร้านมี "จุดส่งย่อย" ได้หลายจุด — Building VPPW (HQ) มีสองจุด
 * คนละผู้รับคนละเบอร์ คนขับเซ็นรับครั้งเดียวคลุมทั้งสองใบ แต่ค่า destination
 * ของสองใบไม่ตรงกัน เงื่อนไขจึงไม่จับคู่ ผลคืออาการเดิม: กดยืนยันแล้วป้ายไม่ขยับ
 *
 * รอบนี้ตัดเงื่อนไขที่อยู่กับลูกค้าออกทั้งหมด เหลือสองอย่าง:
 *   1. อยู่เที่ยวเดียวกัน
 *   2. ลายเซ็นตรงกันทุกตัวอักษร
 *
 * ทำไมลายเซ็นอย่างเดียวถึงพอ และไม่กว้างเกินไป:
 * ลายเซ็นถูกเก็บเป็นภาพจากลายเส้นที่คนวาดสด ๆ (data URL ของ canvas)
 * คนคนเดียวกันเซ็นสองครั้งไม่มีทางได้ไฟล์ที่เท่ากันทุกไบต์ ไบต์ที่เท่ากันเป๊ะ
 * จึงแปลได้อย่างเดียวว่ามาจากการเซ็นครั้งเดียวกัน ที่ระบบคัดลอกไปลงหลายใบเอง
 * — ซึ่งคือสิ่งที่เราต้องการให้ยืนยันพร้อมกันพอดี
 *
 * ยังคงขังไว้ในเที่ยวเดียวกัน เพื่อไม่ให้การยืนยันวันนี้ไปแตะงานของวันอื่น
 * แม้จะเป็นไปได้ยากมากก็ตาม — ขอบเขตที่แคบกว่าและยังแก้ปัญหาได้ ควรเลือกอันแคบ
 *
 * ลายเซ็นว่างไม่นับเป็นชุด (ทุกใบที่ไม่มีลายเซ็นจะกลายเป็นชุดเดียวกันทันที)
 * ใบพวกนั้นยืนยันทีละใบเหมือนเดิม
 */

create or replace function public.verify_pod(p_pod_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public', 'auth'
as $fn$
declare
  v_pod   public.pod;
  v_trip  bigint;
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

  select o.trip_id into v_trip from public.orders o where o.id = v_pod.order_id;

  select array_agg(p.id order by p.id)
    into v_ids
    from public.pod p
    join public.orders o on o.id = p.order_id
   where p.status <> 'verified'
     and o.trip_id is not distinct from v_trip
     and (
       p.id = v_pod.id
       or (coalesce(v_pod.signature_data, '') <> ''
           and p.signature_data = v_pod.signature_data)
     );

  if v_ids is null or array_length(v_ids, 1) is null then
    /* ยืนยันซ้ำไม่ใช่ error — คนสองคนกดพร้อมกันคนละหน้าจอเกิดขึ้นได้จริง */
    return json_build_object('id', v_pod.id, 'status', 'verified', 'already', true, 'covered', 0);
  end if;

  foreach v_id in array v_ids loop
    perform 1 from public.pod where id = v_id for update;

    update public.pod set status = 'verified', updated_at = now() where id = v_id;

    insert into public.evidence_audit_log (actor_user_id, action, order_id, pod_id, detail)
    select app.current_user_id(), 'pod_verified', p.order_id, p.id,
           json_build_object('recipient_name', p.recipient_name, 'with_pod_id', v_pod.id)
      from public.pod p where p.id = v_id;

    v_done := v_done + 1;
  end loop;

  return json_build_object('id', v_pod.id, 'status', 'verified', 'already', false, 'covered', v_done);
end;
$fn$;

grant execute on function public.verify_pod(bigint) to authenticated;

create or replace function public.unverify_pod(p_pod_id bigint, p_reason text)
returns json
language plpgsql
security definer
set search_path to 'public', 'auth'
as $fn$
declare
  v_pod   public.pod;
  v_trip  bigint;
  v_ids   bigint[];
  v_id    bigint;
  v_done  int := 0;
begin
  if not app.has_perm('pod.verify') then
    raise exception 'ไม่มีสิทธิ์ยกเลิกการยืนยันหลักฐาน' using errcode = '42501';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องระบุเหตุผลที่ยกเลิกการยืนยัน' using errcode = 'P0001';
  end if;

  select * into v_pod from public.pod where id = p_pod_id for update;
  if not found then
    raise exception 'ไม่พบหลักฐานใบนี้' using errcode = 'P0002';
  end if;

  select o.trip_id into v_trip from public.orders o where o.id = v_pod.order_id;

  select array_agg(p.id order by p.id)
    into v_ids
    from public.pod p
    join public.orders o on o.id = p.order_id
   where p.status = 'verified'
     and o.trip_id is not distinct from v_trip
     and (
       p.id = v_pod.id
       or (coalesce(v_pod.signature_data, '') <> ''
           and p.signature_data = v_pod.signature_data)
     );

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
