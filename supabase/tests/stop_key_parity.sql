/* app.stop_key ต้องให้คำตอบเดียวกับ storeKey() ใน web/src/utils/stops.ts
 *
 * ทำไมต้องมีไฟล์นี้: ถ้าสองฝั่งนับร้านคนละกติกา หน้าภาพรวมจะบอกจำนวนจุดไม่เท่ากับ
 * หน้าออเดอร์กับกระดานจัดคิว ซึ่งไม่มีอะไรฟ้อง — ทุกหน้ายังขึ้นครบ แค่เลขไม่ตรงกัน
 * และคนอ่านจะเลิกเชื่อทั้งสองหน้า
 *
 * ตัวอย่างชุดนี้ต้องเหมือนกับใน web/src/utils/stops.test.ts เป๊ะ ๆ
 * เพิ่มตัวอย่างที่ไหนต้องเพิ่มอีกที่เสมอ
 *
 * วิธีรัน (หลัง npx supabase db push):
 *   psql "$DATABASE_URL" -f supabase/tests/stop_key_parity.sql
 * ผ่าน = ไม่มี output ผิด = ขึ้น exception บอกเคสที่พัง
 */
do $$
declare
  v_case  record;
  v_got   text;
  v_fail  int := 0;
begin
  for v_case in
    select *
      from (values
        /* จับคู่ลูกค้าไว้แล้ว = ใช้ id ตรง ๆ destination ไม่มีผล */
        (12::bigint, 'ร้าน ก · 1/1 จ.ชลบุรี',                 'c12'),
        /* ไม่ได้จับคู่ = ชื่อจุดส่ง + จังหวัด */
        (null::bigint, 'ร้าน ก · 1/1 จ.ชลบุรี',               'ร้าน ก|ชลบุรี'),
        /* ช่องว่างซ้ำถูกยุบ และที่อยู่ที่จริงเป็นชื่อคนรับไม่ทำให้แตกจุด */
        (null::bigint, '  ร้าน  ก   · คุณสมชาย 081 จ.ระยอง',  'ร้าน ก|ระยอง'),
        /* ไม่มีจังหวัด = ครึ่งหลังว่าง ไม่ใช่ null */
        (null::bigint, 'ร้าน ข',                              'ร้าน ข|'),
        /* ส่วนหน้าว่าง = ถอยไปใช้ทั้งเส้น (shipToName) */
        (null::bigint, ' · 9/9 จ.ชลบุรี',                     '· 9/9 จ.ชลบุรี|ชลบุรี'),
        /* ตัวพิมพ์ใหญ่ถูกลดเป็นเล็ก ร้านเดียวกันพิมพ์คนละแบบต้องเป็นจุดเดียว */
        (null::bigint, 'ABC Shop · 5 จ.Chonburi',             'abc shop|chonburi')
      ) as t(customer_id, destination, want)
  loop
    v_got := app.stop_key(v_case.customer_id, v_case.destination);
    if v_got is distinct from v_case.want then
      v_fail := v_fail + 1;
      raise warning 'stop_key(%, %) = % แต่ฝั่ง TS ได้ %',
        v_case.customer_id, v_case.destination, v_got, v_case.want;
    end if;
  end loop;

  if v_fail > 0 then
    raise exception 'app.stop_key ไม่ตรงกับ storeKey() จำนวน % เคส', v_fail;
  end if;

  raise notice 'stop_key parity ผ่านทุกเคส';
end;
$$;
