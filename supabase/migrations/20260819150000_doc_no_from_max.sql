-- เลขเอกสารต้องนับจากเลขสูงสุด ไม่ใช่จากจำนวนแถว
--
-- ของเดิม: select count(*) ... where เลขขึ้นต้นด้วย PREFIX-ปี  แล้ว +1
--
-- ตราบใดที่ไม่มีใครลบอะไรเลย จำนวนแถวเท่ากับเลขล่าสุดพอดี สูตรนี้จึงถูกมาตลอด
-- แต่พอลบเที่ยวหรือออเดอร์ทิ้งไปหนึ่งใบ จำนวนแถวลดลงในขณะที่เลขสูงสุดอยู่ที่เดิม
-- เลขถัดไปที่คายออกมาจึงเป็นเลขที่ยังมีเจ้าของอยู่ แล้วชน trips_trip_no_key /
-- orders_order_no_key เป็น 23505 ทุกครั้ง จนกว่าจะมีคนสร้างเอกสารจนเลขเดินพ้นช่องว่าง
--
-- อาการที่เห็นจริง: trips มี 4 แถว เลขล่าสุด TRP-2026-0005 — นำเข้าเที่ยวไม่ได้อีกเลย
-- ทั้งที่ข้อมูลดิบสะอาดและไม่มีอะไรกำพร้าค้างอยู่
--
-- แก้เป็นอ่านเลขสูงสุดที่มีอยู่จริงแล้ว +1 ช่องว่างตรงกลางจะถูกข้ามไป ไม่ถูกนำมาใช้ซ้ำ
-- ซึ่งเป็นสิ่งที่ถูกต้องสำหรับเลขเอกสารอยู่แล้ว — เลขที่เคยออกไปแล้วต้องไม่ถูกใช้ใหม่
-- โดยเอกสารคนละใบ ไม่งั้นเอกสารเก่าที่พิมพ์ออกไปแล้วจะชี้ไปหาของผิดใบ
--
-- ล็อกไว้ระหว่างจองเลขด้วย เพราะสองคนที่กดนำเข้าพร้อมกันจะอ่านเลขสูงสุดตัวเดียวกัน
-- แล้วจองเลขเดียวกันทั้งคู่ ล็อกเป็นแบบ transaction ปลดเองเมื่อจบ ไม่ต้องตามปลด

create or replace function app.next_doc_no(p_prefix text, p_table text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_year int := extract(year from now())::int;
  v_col  text := case p_table
                   when 'orders' then 'order_no'
                   when 'quotes' then 'quote_no'
                   when 'trips'  then 'trip_no'
                 end;
  v_seq  int;
begin
  if v_col is null then
    raise exception 'ไม่รู้จักตาราง %', p_table using errcode = 'P0001';
  end if;

  /* กันสองคนจองเลขเดียวกัน — ล็อกแยกตามชนิดเอกสารและปี งานคนละชนิดจึงไม่รอกัน */
  perform pg_advisory_xact_lock(hashtext(p_prefix || '-' || v_year));

  /* อ่านเฉพาะเลขที่อยู่ในรูปแบบ PREFIX-ปี-ตัวเลข เท่านั้น แถวที่ใครใส่เลขมือไว้
     ผิดรูปแบบจะถูกข้าม ไม่ใช่ทำให้ทั้งฟังก์ชันพังตอนแปลงเป็นตัวเลข */
  execute format(
    'select coalesce(max(regexp_replace(%I, $2, '''')::int), 0) from public.%I where %I ~ $1',
    v_col, p_table, v_col)
     into v_seq
    using '^' || p_prefix || '-' || v_year || '-[0-9]+$',
          '^' || p_prefix || '-' || v_year || '-';

  return p_prefix || '-' || v_year || '-' || lpad((v_seq + 1)::text, 4, '0');
end;
$function$;
