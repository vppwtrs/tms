-- ทางออกฉุกเฉินที่ไม่ใช่การถอดกฎทิ้ง
--
-- รอบก่อน (20260819170000) ห้ามลบเที่ยวที่มีหลักฐานยืนยันแล้ว ซึ่งถูก — แต่ทำให้
-- ปุ่มลบถาวรตันสนิทเมื่อยืนยันไปแล้ว ทั้งที่ปุ่มนั้นมีไว้ใช้ตอนฉุกเฉินจริง ๆ
--
-- ทางออกที่ผิดคือใส่ธง "ลบทั้งที่ยืนยันแล้ว" เข้าไปในปุ่มลบ เพราะสุดท้ายทุกคน
-- จะติ๊กมันทุกครั้งจนกฎไม่เหลือความหมาย และบันทึกที่ได้ก็บอกแค่ว่า "ลบ" ไม่ได้
-- บอกว่าใครตัดสินใจว่าหลักฐานใบนั้นไม่ต้องเก็บแล้ว
--
-- ทางออกที่ถูกคือแยกการตัดสินใจออกเป็นสองครั้ง: ปลดการยืนยันก่อน (ต้องบอกเหตุผล
-- และมีชื่อคนปลดติดไว้) แล้วค่อยลบ คนที่ต้องลบจริงยังลบได้ ส่วนคนที่เผลอกดลบ
-- จะเจอกำแพงก่อนเสมอ

create or replace function public.unverify_pod(p_pod_id bigint, p_reason text)
returns json
language plpgsql
security definer
set search_path to 'public', 'auth'
as $fn$
declare
  v_pod public.pod;
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

  if v_pod.status <> 'verified' then
    return json_build_object('id', v_pod.id, 'status', v_pod.status, 'already', true);
  end if;

  update public.pod set status = 'collected', updated_at = now() where id = p_pod_id;

  insert into public.evidence_audit_log (actor_user_id, action, order_id, pod_id, detail)
  values (app.current_user_id(), 'pod_unverified', v_pod.order_id, v_pod.id,
          json_build_object('reason', btrim(p_reason)));

  return json_build_object('id', v_pod.id, 'status', 'collected', 'already', false);
end;
$fn$;

grant execute on function public.unverify_pod(bigint, text) to authenticated;
