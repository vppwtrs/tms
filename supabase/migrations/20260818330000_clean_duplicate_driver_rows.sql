-- ล้างคนขับชื่อซ้ำที่เกิดจากการกดสร้างบัญชีที่ล้มกลางคัน
--
-- create_app_user สร้างแถว drivers ให้เองทุกครั้งที่บทบาทเป็นคนขับ พอขั้นผูกกับคนที่
-- เลือกไว้ล้ม (ชน drivers_user_id_key) คำขอถูกตีกลับแต่แถวที่สร้างไปแล้วไม่ถูกถอย
-- ทุกครั้งที่กดจึงเหลือคนขับชื่อเดียวกันเพิ่มมาอีกหนึ่งแถว ไม่มีเที่ยว ไม่มีบัญชี
-- (หน้าพนักงานขับขึ้นเตือนคู่ที่น่าจะเป็นคนเดียวกันจาก 2 คู่เป็น 7 คู่)
--
-- ที่นี่ล้างของที่ค้างอยู่ ส่วนต้นเหตุแก้ที่ admin-users แล้ว — ถ้าขั้นผูกล้ม
-- ฟังก์ชันจะถอยทั้งแถวคนขับ แถวผู้ใช้ และบัญชี auth ให้ครบ
--
-- เงื่อนไขการลบตั้งไว้แคบโดยตั้งใจ: ลบเฉพาะแถวที่ "ไม่มีอะไรผูกอยู่เลย" —
-- ไม่มีเที่ยวทั้งทางตรงและทาง trip_drivers ไม่มีบัญชีผู้ใช้ ไม่ถูกใช้เป็นคีย์แม็ปจาก TMS
-- และต้องมีแถวชื่อเดียวกันตัวอื่นเหลืออยู่เสมอ คนขับตัวจริงจึงไม่มีทางหายไป

do $$
declare
  v_key    text;
  v_keep   bigint;
  v_drop   bigint;
  v_count  int := 0;
begin
  for v_key in
    select app.driver_key(name)
      from public.drivers
     group by app.driver_key(name)
    having count(*) > 1
  loop
    /* คนที่เก็บไว้: มีบัญชีก่อน ถัดมาคือคนที่มีเที่ยวมากที่สุด สุดท้ายคือแถวที่เก่าที่สุด */
    select d.id into v_keep
      from public.drivers d
     where app.driver_key(d.name) = v_key
     order by (d.user_id is not null) desc,
              (select count(*) from public.trip_drivers td where td.driver_id = d.id) desc,
              d.id
     limit 1;

    for v_drop in
      select d.id
        from public.drivers d
       where app.driver_key(d.name) = v_key
         and d.id <> v_keep
         and d.user_id is null
         and not exists (select 1 from public.trips t
                          where t.driver_id = d.id or t.accepted_by = d.id)
         and not exists (select 1 from public.trip_drivers td where td.driver_id = d.id)
         and not exists (select 1 from public.tms_driver_map m where m.driver_id = d.id)
    loop
      delete from public.drivers where id = v_drop;
      v_count := v_count + 1;
    end loop;
  end loop;

  raise notice 'ลบคนขับซ้ำที่ไม่มีอะไรผูกอยู่ % แถว', v_count;
end;
$$;
