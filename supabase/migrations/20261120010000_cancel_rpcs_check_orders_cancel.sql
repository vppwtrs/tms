-- ยกเลิกออเดอร์/เที่ยว ต้องมีสิทธิ์ orders.cancel ด้วย (เดิมฝั่ง DB เช็กแค่ orders.write / dispatch.write
-- ทำให้คนที่ถูกปฏิเสธ orders.cancel ยังเรียก RPC ตรงแล้วลบใบได้)
--   remove_order          : orders.write  -> orders.cancel (ตรงกับปุ่มยกเลิกในหน้าออเดอร์)
--   dispatch_cancel_trip  : dispatch.write -> dispatch.write และ orders.cancel (ยกเลิกเที่ยว = ลบใบทั้งเที่ยว)
-- ดัดจากนิยามปัจจุบันใน DB แทนการเขียนฟังก์ชันใหม่ทั้งก้อน รันซ้ำได้ (replace ไม่เจอก็ไม่เปลี่ยน)
do $$
declare v text;
begin
  v := pg_get_functiondef('public.remove_order(bigint)'::regprocedure);
  v := replace(v, $q$if not app.has_perm('orders.write') then$q$,
                  $q$if not app.has_perm('orders.cancel') then$q$);
  execute v;

  v := pg_get_functiondef('public.dispatch_cancel_trip(bigint)'::regprocedure);
  v := replace(v, $q$if not app.has_perm('dispatch.write') then$q$,
                  $q$if not (app.has_perm('dispatch.write') and app.has_perm('orders.cancel')) then$q$);
  execute v;
end $$;
