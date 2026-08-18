-- คืนสิทธิ์อ่านให้ view my_orders หลังถูก drop แล้วสร้างใหม่
--
-- drop view ทิ้ง grant ที่ผูกกับ view เดิมไปด้วย ถ้าไม่คืนให้ คนขับจะเปิดแอปแล้วเจอ
-- "permission denied for view my_orders" ซึ่งหน้าจอแสดงเป็นงานว่างเปล่า

grant select on public.my_orders to authenticated;
