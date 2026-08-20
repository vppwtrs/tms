-- ขากลับคลัง + บังคับเก็บหลักฐานก่อนปิดเที่ยว
--
-- สองเรื่องอยู่ไฟล์เดียวกันเพราะแตะ complete_trip ตัวเดียวกัน แยกไฟล์แล้วต้อง
-- เขียนฟังก์ชันเดิมทับกันเองสองรอบ
--
-- ── เรื่องที่หนึ่ง: ขากลับหายไปจากระบบทั้งท่อน ──────────────────────────────
--
-- เดิม complete_trip ทำสามอย่างพร้อมกันตอนคนขับกดปิดงานที่ร้านสุดท้าย:
-- ตั้ง arrived_at, คืนรถเป็นว่าง, คืนคนขับเป็นว่าง แล้วการบันทึกตำแหน่งก็หยุด
-- ตามไปด้วยเพราะเที่ยวไม่ใช่ in_progress อีกแล้ว
--
-- ผลคือ arrived_at ไม่ได้แปลว่า "ถึงคลัง" แต่แปลว่า "กดปุ่มที่หน้าร้านสุดท้าย"
-- ซึ่งอาจห่างคลังสามสิบกิโล และคนวางแผนเห็นรถว่างทันทีทั้งที่ยังวิ่งกลับอยู่
-- จ่ายงานใหม่ให้คันนั้นได้เลยโดยไม่มีอะไรบอกว่าจะถึงคลังกี่โมง
--
-- ตอนนี้แยกเป็นสองจังหวะ: ปิดงานที่ร้านสุดท้าย -> returning -> ถึงคลังกดอีกที
-- ระหว่างนั้น GPS ยังส่งต่อ รถกับคนขับยังไม่ว่าง
--
-- returned_at เป็นคอลัมน์ใหม่ ไม่ยัดรวมกับ arrived_at เพราะสองอันคนละความหมาย
-- และ arrived_at เดิมมีข้อมูลย้อนหลังอยู่แล้ว การเปลี่ยนความหมายของช่องที่มี
-- ข้อมูลเก่าอยู่ คือทำให้ข้อมูลเก่าทั้งกองอ่านผิดไปด้วย
--
-- ── เรื่องที่สอง: ปิดเที่ยวได้ทั้งที่ไม่มีหลักฐาน ──────────────────────────
--
-- complete_trip เช็คแค่ว่าทุกใบ delivered หรือ cancelled ไม่เคยถามว่ามีหลักฐาน
-- ไหม เที่ยว 20260820001 จบไปโดยมี POD ใบเดียวจากสองใบ และไม่มีอะไรทวงเลย
--
-- ด่านอยู่ที่ปิดเที่ยว ไม่ใช่ที่ปิดจุดส่ง ตั้งใจ: คนขับยืนอยู่หน้าร้าน สัญญาณ
-- อาจใช้ไม่ได้ ถ้ากดปิดจุดไม่ได้เลยจนกว่ารูปจะอัปโหลดสำเร็จ เขาจะติดอยู่ตรงนั้น
-- ปล่อยให้ปิดจุดไปก่อนแล้วมาบังคับตอนจบเที่ยว ได้หลักประกันเท่ากันโดยไม่ขังใครไว้
--
-- และรูปเป็นของบังคับใน save_pod_with_photos — ลายเซ็นอย่างเดียวไม่พอ

alter table public.trips
  add column if not exists returned_at timestamptz;

comment on column public.trips.returned_at is
  'เวลาที่รถกลับถึงคลังจริง — คนละอันกับ arrived_at ซึ่งคือเวลาที่ปิดงานที่ร้านสุดท้าย';

/* returning จัดกลุ่มกับ in_progress ไม่ใช่กับ completed — รถยังอยู่ข้างนอก
   ยังไม่ว่าง และยังต้องอยู่บนจอเดียวกับเที่ยวที่กำลังวิ่ง */
create or replace function app.trip_rank(s public.trip_status)
returns integer
language sql
immutable
as $function$
  select case s when 'planned' then 1 when 'in_progress' then 2
                when 'returning' then 2
                when 'completed' then 3 when 'cancelled' then 3 end
$function$;

-- ── ปิดงานที่ร้านสุดท้าย -> กำลังกลับคลัง ─────────────────────────────────
create or replace function public.complete_trip(p_trip_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_pending integer;
  v_nopod   integer;
  v_me      bigint := app.current_driver_id();
  v_primary bigint;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  if not exists (select 1 from public.trips where id = p_trip_id) then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  v_primary := app.trip_primary_driver(p_trip_id);

  /* ข้อความต้องแยกสองกรณีให้ขาด: "ไม่ใช่งานของคุณ" กับ "เป็นงานของคุณแต่คุณไม่ใช่คนหลัก"
     ถ้าพูดเหมือนกัน ผู้ช่วยจะคิดว่าระบบลืมเขาแล้วโทรหาออฟฟิศ */
  if v_primary is distinct from v_me then
    if exists (select 1 from public.trip_drivers td
                where td.trip_id = p_trip_id and td.driver_id = v_me) then
      raise exception 'ปิดเที่ยวได้เฉพาะคนขับหลัก — จุดส่งที่คุณปิดไว้ถูกบันทึกแล้ว'
        using errcode = 'P0001';
    end if;
    raise exception 'ไม่พบเที่ยวนี้ หรือไม่ใช่เที่ยวของคุณ' using errcode = 'P0002';
  end if;

  select count(*) into v_pending
    from public.orders o
   where o.trip_id = p_trip_id
     and o.status not in ('delivered', 'cancelled');

  if v_pending > 0 then
    raise exception 'ยังส่งไม่ครบ เหลืออีก % จุด', v_pending using errcode = 'P0001';
  end if;

  /* ใบที่ส่งแล้วต้องมีทั้งลายเซ็นและรูป ใบที่ยกเลิกไม่ต้อง — ไม่มีของไปส่ง
     นับใบ ไม่ใช่ร้าน เพราะหลักฐานผูกกับใบ และร้านที่มีสามใบอาจเก็บครบแค่ใบเดียว */
  select count(*) into v_nopod
    from public.orders o
   where o.trip_id = p_trip_id
     and o.status = 'delivered'
     and not exists (
       select 1 from public.pod p
        join public.pod_photos f on f.pod_id = p.id
       where p.order_id = o.id
     );

  if v_nopod > 0 then
    raise exception 'ยังเก็บหลักฐานไม่ครบ เหลืออีก % ใบ — ต้องมีทั้งลายเซ็นและรูป', v_nopod
      using errcode = 'P0001';
  end if;

  /* ไม่คืนรถกับคนขับตรงนี้ รถยังวิ่งกลับคลังอยู่ การบอกว่าว่างตอนนี้
     คือเชิญให้คนวางแผนจ่ายงานใหม่ให้รถที่ยังไม่กลับ */
  update public.trips
     set status = 'returning',
         arrived_at = coalesce(arrived_at, now()),
         closed_by = v_me
   where id = p_trip_id and status = 'in_progress';

  if not found then
    raise exception 'ปิดได้เฉพาะเที่ยวที่กำลังวิ่งอยู่' using errcode = 'P0001';
  end if;
end;
$function$;

-- ── ถึงคลังแล้ว -> จบจริง ────────────────────────────────────────────────
create or replace function public.finish_return(p_trip_id bigint)
returns json
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_me      bigint := app.current_driver_id();
  v_primary bigint;
  v_trip    public.trips;
begin
  if not app.has_perm('myjobs.progress') then
    raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
  end if;

  select * into v_trip from public.trips where id = p_trip_id;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  v_primary := app.trip_primary_driver(p_trip_id);
  if v_primary is distinct from v_me then
    raise exception 'ปิดเที่ยวได้เฉพาะคนขับหลัก' using errcode = 'P0001';
  end if;

  update public.trips
     set status = 'completed',
         returned_at = coalesce(returned_at, now())
   where id = p_trip_id and status = 'returning';

  if not found then
    raise exception 'เที่ยวนี้ไม่ได้อยู่ระหว่างกลับคลัง' using errcode = 'P0001';
  end if;

  /* คืนของตรงนี้แทน ไม่ใช่ตอนปิดงานที่ร้านสุดท้าย */
  update public.vehicles set status = 'available' where id = v_trip.vehicle_id;
  update public.drivers set status = 'available'
   where id in (select driver_id from public.trip_drivers where trip_id = p_trip_id)
      or id = v_trip.driver_id
      or id = v_me;

  return json_build_object('trip_id', p_trip_id, 'trip_no', v_trip.trip_no);
end;
$function$;

grant execute on function public.finish_return(bigint) to authenticated;

-- ── ทางลัดของออฟฟิศ ปิดได้จากทั้งสองสถานะ ─────────────────────────────────
create or replace function public.dispatch_complete_trip(p_trip_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_vehicle bigint;
  v_driver  bigint;
begin
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์จัดเที่ยววิ่ง' using errcode = '42501';
  end if;

  /* ออฟฟิศข้ามขั้น returning ได้ ใช้ตอนคนขับลืมกดว่ากลับถึงแล้ว ซึ่งจะเกิดขึ้นแน่
     ด่านหลักฐานไม่บังคับตรงนี้โดยตั้งใจ — นี่คือทางออกฉุกเฉินของคนที่เห็นภาพรวม
     ไม่ใช่เส้นทางปกติ ถ้าบังคับด้วย เที่ยวที่หลักฐานหายจะไม่มีทางปิดได้เลย */
  update public.trips
     set status = 'completed',
         arrived_at = coalesce(arrived_at, now()),
         returned_at = coalesce(returned_at, now())
   where id = p_trip_id and status in ('in_progress', 'returning')
  returning vehicle_id, driver_id into v_vehicle, v_driver;

  if not found then
    raise exception 'ปิดได้เฉพาะเที่ยวที่กำลังวิ่งหรือกำลังกลับคลัง' using errcode = 'P0001';
  end if;

  update public.orders
     set status = 'delivered', delivered_at = coalesce(delivered_at, now()), updated_at = now()
   where trip_id = p_trip_id and status = 'in_transit';

  update public.vehicles set status = 'available' where id = v_vehicle;
  update public.drivers set status = 'available'
   where id = v_driver
      or id in (select driver_id from public.trip_drivers where trip_id = p_trip_id);
end;
$function$;

-- ── หน้าติดตามรถต้องเห็นขากลับด้วย ────────────────────────────────────────
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
             v.plate_no,
             (select string_agg(d.name, ', ' order by td.seq)
                from public.trip_drivers td
                join public.drivers d on d.id = td.driver_id
               where td.trip_id = t.id) as drivers,
             (select json_build_object('lat', l.lat, 'lng', l.lng,
                                       'accuracy_m', l.accuracy_m,
                                       'recorded_at', l.recorded_at)
                from public.trip_locations l
               where l.trip_id = t.id
               order by l.recorded_at desc
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
       where t.status in ('planned', 'in_progress', 'returning')
         and (app.has_perm('dispatch.view')
              or t.driver_id = app.current_driver_id()
              or exists (select 1 from public.trip_drivers td
                          where td.trip_id = t.id
                            and td.driver_id = app.current_driver_id()))
    ) x;
$function$;

-- ── ตารางว่างของคนขับ: กำลังกลับคลัง = ยังไม่ว่าง ─────────────────────────
create or replace function public.drivers_busy_on(p_date date, p_driver_ids bigint[])
returns json
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_out json;
begin
  if not (app.has_perm('dispatch.view') or app.has_perm('dispatch.write')) then
    raise exception 'ไม่มีสิทธิ์ดูตารางงานของพนักงานขับ' using errcode = '42501';
  end if;

  select coalesce(json_agg(json_build_object(
           'driver_id', x.driver_id,
           'driver_name', x.name,
           'trip_id', x.trip_id,
           'trip_no', x.trip_no,
           'status', x.status
         ) order by x.name, x.trip_no), '[]'::json)
    into v_out
    from (
      select distinct td.driver_id, d.name, t.id as trip_id, t.trip_no, t.status
        from public.trip_drivers td
        join public.trips t on t.id = td.trip_id
        join public.drivers d on d.id = td.driver_id
        /* วันของงานคือ order_date ที่ TMS ให้มา ไม่ใช่วันที่แถวถูกสร้าง
           และไม่ใช่ departed_at::date ซึ่งเป็น timestamptz — cast บนเซิร์ฟเวอร์ที่เป็น UTC
           จะตัดวันคลาดไป 7 ชั่วโมง เที่ยวเย็นของไทยจึงถูกนับเป็นของวันถัดไป
           เที่ยวที่สร้างเองในระบบไม่มีแถวใน tms_trips ถอยไปใช้ created_at */
        left join public.tms_trips x2 on x2.trip_id = t.id
       where td.driver_id = any(coalesce(p_driver_ids, '{}'::bigint[]))
         and t.status in ('planned', 'in_progress', 'returning')
         and coalesce(x2.order_date, t.created_at::date) = coalesce(p_date, current_date)
    ) x;

  return v_out;
end;
$function$;

-- ── รูปเป็นของบังคับ ลายเซ็นอย่างเดียวไม่พอ ───────────────────────────────
create or replace function public.save_pod_with_photos(
  p_order_id bigint,
  p_recipient_name text,
  p_signature_data text,
  p_photos jsonb default '[]'::jsonb,
  p_notes text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_id    bigint;
  v_first text;
  v_count int;
begin
  select count(*) into v_count
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) as x(e)
   where nullif(btrim(e->>'path'), '') is not null;

  /* ลายเซ็นบอกว่ามีคนเซ็น รูปบอกว่าของถึงจริงและอยู่ในสภาพไหน เวลามีข้อโต้แย้ง
     ลายเซ็นอย่างเดียวตอบไม่ได้ว่าส่งอะไรไปกี่ชิ้น ด่านนี้จึงอยู่ที่ชั้นข้อมูล
     ไม่ใช่แค่ปุ่มบนจอที่ปิดได้ด้วยการเรียก API ตรง */
  if v_count = 0 then
    raise exception 'ต้องมีรูปอย่างน้อยหนึ่งรูป' using errcode = 'P0001';
  end if;

  select nullif(btrim(e->>'path'), '') into v_first
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) as x(e)
   where nullif(btrim(e->>'path'), '') is not null
   limit 1;

  /* ด่านสิทธิ์ทั้งหมดอยู่ใน save_pod อยู่แล้ว เรียกต่อ ไม่เขียนกฎซ้ำสองที่ */
  v_id := public.save_pod(
    p_order_id, p_recipient_name, p_signature_data,
    v_first, p_notes, p_lat, p_lng
  );

  /* บันทึกซ้ำใบเดิม = แทนที่ชุดรูปทั้งชุด ไม่ใช่สะสมของเก่าปนของใหม่
     (POD ที่ยืนยันแล้วแก้ไม่ได้อยู่แล้ว — save_pod โยน error ก่อนถึงบรรทัดนี้) */
  delete from public.pod_photos where pod_id = v_id;

  insert into public.pod_photos (pod_id, path, kind)
  select v_id,
         nullif(btrim(e->>'path'), ''),
         coalesce(nullif(btrim(e->>'kind'), ''), 'other')
    from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) as x(e)
   where nullif(btrim(e->>'path'), '') is not null;

  return v_id;
end;
$function$;
