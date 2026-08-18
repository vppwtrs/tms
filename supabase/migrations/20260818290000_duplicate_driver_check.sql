-- ตัวตรวจคนขับที่น่าจะเป็นคนเดียวกัน
--
-- ที่ผ่านมาคนซ้ำถูกเจอเพราะคนไปเปิดหน้าแล้วสังเกตเอง ซึ่งแปลว่ารู้ช้าเสมอ
-- และรู้ก็ต่อเมื่อสองแถวบังเอิญอยู่หน้าเดียวกัน (เรียงตามชื่อ แต่สะกดต่างกัน
-- ก็ตกไปคนละหน้าได้) กว่าจะเจอ ประวัติเที่ยวก็กระจายไปสองแถวแล้ว
--
-- ตัวนี้ไม่รวมให้เอง — แค่ชี้ว่าคู่ไหนน่าสงสัย เพราะการรวมผิดคนแก้คืนยากกว่ามาก
-- (ประวัติปนกันแล้วแยกไม่ออกว่าเที่ยวไหนของใคร)
--
-- สัญญาณที่ใช้ เรียงตามความหนักแน่น:
--  1. ชื่อเล่นในวงเล็บตรงกัน — สัญญาณที่ดีที่สุดในข้อมูลชุดนี้ เพราะ TMS ใส่มาทุกคน
--     และไม่ค่อยซ้ำกันข้ามคน ("เอกชัย บุญอินทร์ (เอก)" กับ "เอกชัย (เอก)")
--  2. เบอร์โทรตรงกัน — ถ้ามีคนกรอกไว้ ถือว่าชัดพอ ๆ กัน
--  3. ชื่อจริงคำแรกตรงกัน แต่ชื่อเล่นไม่ตรง — อ่อนกว่า ใช้เตือนเฉย ๆ

create or replace function app.driver_nick(p_name text)
returns text language sql immutable as $fn$
  /* เอาเฉพาะข้อความในวงเล็บคู่สุดท้าย แล้วตัดช่องว่างทิ้งแบบเดียวกับ driver_key */
  select nullif(regexp_replace(
           coalesce((regexp_match(coalesce(p_name, ''), '\(([^)]*)\)[^)]*$'))[1], ''),
           '\s', '', 'g'), '');
$fn$;

create or replace function public.suspected_duplicate_drivers()
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_out json;
begin
  if not app.has_perm('drivers.view') then
    raise exception 'ไม่มีสิทธิ์ดูพนักงานขับ' using errcode = '42501';
  end if;

  select coalesce(json_agg(x order by x.strength desc, x.a_name), '[]'::json)
    into v_out
    from (
      select a.id as a_id, a.name as a_name, b.id as b_id, b.name as b_name,
             case
               when app.driver_nick(a.name) is not null
                and app.driver_nick(a.name) = app.driver_nick(b.name)
                 then 'ชื่อเล่นตรงกัน'
               when a.phone is not null and a.phone = b.phone
                 then 'เบอร์โทรตรงกัน'
               else 'ชื่อจริงคำแรกตรงกัน'
             end as reason,
             case
               when app.driver_nick(a.name) is not null
                and app.driver_nick(a.name) = app.driver_nick(b.name) then 3
               when a.phone is not null and a.phone = b.phone then 2
               else 1
             end as strength,
             (select count(*) from public.trips t where t.driver_id = a.id) as a_trips,
             (select count(*) from public.trips t where t.driver_id = b.id) as b_trips
        from public.drivers a
        join public.drivers b on b.id > a.id
       where (
               (app.driver_nick(a.name) is not null
                and app.driver_nick(a.name) = app.driver_nick(b.name))
            or (a.phone is not null and btrim(a.phone) <> '' and a.phone = b.phone)
            or (split_part(btrim(a.name), ' ', 1) = split_part(btrim(b.name), ' ', 1))
             )
    ) x;

  return v_out;
end;
$fn$;

grant execute on function public.suspected_duplicate_drivers() to authenticated;
