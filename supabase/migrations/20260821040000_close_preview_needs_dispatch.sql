/*
 * trip_close_preview ต้องถามสิทธิ์ก่อนตอบ
 *
 * ตอนเขียนครั้งแรกคิดว่า "แค่นับเลข ไม่ได้แตะข้อมูล" จึงไม่ได้ใส่ด่านสิทธิ์
 * ซึ่งผิด — มันเป็น security definer ที่ใครก็ตามที่ล็อกอินยิงได้ทุกเลขเที่ยว
 * แล้วได้เลขเที่ยวกับจำนวนใบกลับไป คนขับคนหนึ่งจึงส่องงานของอีกคนได้ทีละเลข
 * ข้อมูลชิ้นเล็กที่ขอได้ไม่จำกัดจำนวนครั้ง ก็คือข้อมูลทั้งกระดาน
 *
 * เจอตอนไล่ตรวจความปลอดภัยของตัวเอง ไม่ได้เกิดจากใครใช้จริง
 */
create or replace function public.trip_close_preview(p_trip_id bigint)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  /* คนที่ปิดเที่ยวได้เท่านั้นที่ควรรู้ว่าปิดแล้วจะกินอะไรบ้าง — ด่านเดียวกับปุ่มปิด */
  if not app.has_perm('dispatch.write') then
    raise exception 'ไม่มีสิทธิ์ดูสรุปการปิดเที่ยว' using errcode = '42501';
  end if;

  return (
    select json_build_object(
      'trip_no', (select t.trip_no from public.trips t where t.id = p_trip_id),
      'open_orders', (
        select count(*) from public.orders o
         where o.trip_id = p_trip_id and o.status = 'in_transit'
      ),
      'without_pod', (
        select count(*) from public.orders o
         where o.trip_id = p_trip_id
           and o.status in ('in_transit', 'delivered')
           and not exists (
             select 1 from public.pod p
              join public.pod_photos f on f.pod_id = p.id
             where p.order_id = o.id
           )
      )
    )
  );
end;
$fn$;

grant execute on function public.trip_close_preview(bigint) to authenticated;
