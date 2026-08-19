-- เก็บกวาดใบดิบจาก TMS ที่ไม่เคยถูกสั่งงาน
--
-- ที่มา: ตอนตั้งระบบมีการดึงข้อมูลย้อนหลังจาก TMS เข้ามาทดลอง ซึ่งเป็นเที่ยวที่
-- ปิดงานไปแล้วทั้งหมดในระบบต้นทาง คนขับของเราไม่เคยวิ่งงานพวกนั้นเลยสักเที่ยว
-- ใบดิบ 1,431 ใบจากช่วง พ.ค.–ส.ค. 2569 จึงเป็นของที่ไม่มีใครจะใช้อีก
-- แต่กินพื้นที่ 7.6 MB จาก 500 MB ของแพลนฟรี
--
-- ล้างรอบแรกด้วยมือแล้วได้ 40 MB -> 16 MB (ที่บวมส่วนใหญ่เป็น dead tuple ค้าง
-- จากการลบ/แก้ครั้งก่อน ๆ ซึ่ง vacuum full เก็บกวาดคืนไปพร้อมกัน)
--
-- ตัวนี้ทำให้ทำซ้ำได้จากหน้าจอ ไม่ต้องเปิด SQL editor และไม่ต้องจำเงื่อนไขเอง
-- เพราะเงื่อนไขที่ปลอดภัยมีรายละเอียดที่จำผิดแล้วลบของที่ยังต้องใช้ได้:
--
--   order_id is null   ใบที่ไม่เคยถูกแปลงเป็นออเดอร์ ลบแล้วไม่มีงานไหนกระทบ
--   เก่ากว่า N วัน      ตัวดึงจาก TMS เอาเฉพาะเที่ยววันปัจจุบัน ของเก่าจึงไม่ถูก
--                      ดึงกลับมา ส่วนของใหม่ถ้าเผลอลบ มันจะกลับมาในไม่กี่นาที
--                      แล้วสร้างงานซ้ำซ้อนให้คนวางแผนสับสน
--
-- vacuum อยู่ในฟังก์ชันไม่ได้ (รันในทรานแซกชันไม่ได้) หน้าจอจึงบอกคำสั่งให้ไปรันเอง
-- ถ้าอยากคืนพื้นที่ให้ระบบปฏิบัติการจริง ๆ — ไม่รันก็ได้ autovacuum จะเอาที่ว่าง
-- กลับมาใช้ซ้ำเอง ขนาดฐานจะหยุดโตแทนที่จะลดลง ซึ่งพอสำหรับเรื่องโควตา

create or replace function public.cleanup_tms_raw(p_keep_days int default 14)
returns json
language plpgsql
security definer
set search_path to 'public', 'auth'
as $fn$
declare
  v_bills  int := 0;
  v_trips  int := 0;
  v_before bigint;
  v_after  bigint;
begin
  if not app.has_perm('users.manage') then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่เก็บกวาดข้อมูลดิบได้' using errcode = '42501';
  end if;

  /* กันพลาดจากการพิมพ์ตัวเลขผิด — เก็บไว้อย่างน้อยหนึ่งสัปดาห์เสมอ
     ใส่ 0 มาแล้วลบใบของวันนี้ทิ้ง คือการลบงานที่คนวางแผนกำลังจะสั่ง */
  if p_keep_days < 7 then
    raise exception 'ต้องเก็บใบดิบไว้อย่างน้อย 7 วัน' using errcode = 'P0001';
  end if;

  select pg_database_size(current_database()) into v_before;

  delete from public.tms_shipments
   where order_id is null
     and trip_date < current_date - p_keep_days;
  get diagnostics v_bills = row_count;

  /* เที่ยวดิบที่ไม่เหลือใบและไม่เคยถูกนำเข้า — ค้างไว้ก็ไม่มีใครเปิดดู */
  delete from public.tms_trips t
   where t.trip_id is null
     and not exists (select 1 from public.tms_shipments s where s.tms_trip_id = t.tms_id);
  get diagnostics v_trips = row_count;

  select pg_database_size(current_database()) into v_after;

  if v_bills > 0 or v_trips > 0 then
    insert into public.evidence_audit_log (actor_user_id, action, detail)
    values (app.current_user_id(), 'tms_raw_cleaned',
            json_build_object('bills', v_bills, 'trips', v_trips, 'keep_days', p_keep_days));
  end if;

  return json_build_object(
    'deleted_bills', v_bills,
    'deleted_trips', v_trips,
    'keep_days', p_keep_days,
    /* ตัวเลขนี้มักเป็น 0 ทั้งที่ลบไปหลายพันแถว — Postgres เก็บที่ว่างไว้ใช้ซ้ำ
       ไม่คืนให้ระบบปฏิบัติการจนกว่าจะ vacuum full บอกไว้ให้หน้าจออธิบายถูก */
    'db_bytes_before', v_before,
    'db_bytes_after', v_after
  );
end;
$fn$;

grant execute on function public.cleanup_tms_raw(int) to authenticated;
