-- tms_shipments.license_plate และ driver_name เป็น null ทั้งตาราง
--
-- เส้น Picking List ของ TMS ไม่ส่งทะเบียนรถกับชื่อคนขับมาด้วย ทั้งสองค่านั้น
-- อยู่ที่เส้นเที่ยว (tms_trips) ซึ่งผูกกับใบด้วย tms_shipments.tms_trip_id อยู่แล้ว
-- ปล่อยว่างไว้ทำให้หน้าใบและการตรวจย้อนกลับจากใบไปหารถ/คนขับทำไม่ได้เลย
--
-- เติมจากเที่ยวที่ผูกกันอยู่ ทั้งของเก่าและทุกครั้งที่ push เที่ยวรอบใหม่
-- เขียนทับเฉพาะช่องที่ยังว่าง — ถ้าวันหลัง TMS ส่งค่ามาเองจริง ค่าจากต้นทางต้องชนะ

create or replace function app.fill_shipment_trip_fields()
returns int
language sql
security definer
set search_path = public
as $$
  with upd as (
    update public.tms_shipments s
       set license_plate = coalesce(s.license_plate, nullif(btrim(x.license_plate), '')),
           driver_name   = coalesce(s.driver_name,   nullif(btrim(x.driver_name), ''))
      from public.tms_trips x
     where x.tms_id = s.tms_trip_id
       and (s.license_plate is null or s.driver_name is null)
       and (nullif(btrim(x.license_plate), '') is not null
            or nullif(btrim(x.driver_name), '') is not null)
    returning 1
  )
  select count(*)::int from upd;
$$;

comment on function app.fill_shipment_trip_fields() is
  'เติมทะเบียนรถ/ชื่อคนขับให้ tms_shipments จาก tms_trips ที่ผูกกันด้วย tms_trip_id';

-- ต่อเข้าเส้น push เที่ยว เพื่อให้ของที่นำเข้าใหม่ไม่ว่างอีก
create or replace function public.push_tms_trips_and_sync(p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_push json;
  v_sync json;
  v_fill int;
  v_user bigint := app.current_user_id();
  v_date date;
  v_pl   int;
begin
  v_push := public.push_tms_trips(p_rows);
  v_sync := public.sync_tms_trip_status();
  v_fill := app.fill_shipment_trip_fields();

  -- หนึ่งแถวต่อการ push หนึ่งครั้ง ใช้วันที่ล่าสุดในชุดเป็นตัวแทน
  select max(nullif(r->>'orderDate', '')::date),
         coalesce(sum(jsonb_array_length(coalesce(r->'pickingLists', '[]'::jsonb))), 0)::int
    into v_date, v_pl
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as e(r);

  if v_date is not null then
    insert into public.tms_sync_log (trip_date, rows_pushed, picking_lists,
                                     rows_inserted, rows_updated, source, synced_by)
    values (v_date,
            coalesce((v_push->>'seen')::int, 0),
            v_pl,
            coalesce((v_push->>'inserted')::int, 0),
            coalesce((v_push->>'updated')::int, 0),
            'trip',
            v_user);
  end if;

  return json_build_object(
    'push', v_push,
    'synced_trips', (v_sync->>'trips')::int,
    'synced_orders', (v_sync->>'orders')::int,
    'filled_shipments', v_fill
  );
end;
$$;

-- เติมย้อนหลังของที่นำเข้าไปแล้ว
select app.fill_shipment_trip_fields();
