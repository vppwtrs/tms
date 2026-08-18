-- แก้เส้นทางข้อมูล Trip จาก TMS ที่ไม่ไหลเข้าระบบ
--
-- อาการ: public.tms_trips และ public.orders ค้างอยู่ที่ 0 แถว ทั้งที่ tms_shipments มี 1,682 แถว
-- สาเหตุ: push_tms_trips ใช้ inner join public.tms_carriers เป็นด่านกรอง carrier
--         แต่ตารางนั้นไม่เคยถูก seed จึงกรองเที่ยวทิ้งทั้งหมดแบบเงียบ ๆ
--         (นับเป็น skipped_carrier ไม่ raise exception หน้าเว็บเลยขึ้นว่า "ไม่มีอะไรเปลี่ยน")

-- 1) seed carrier ของกองรถเรา — ชื่อต้องตรงกับ OUR_CARRIERS ใน web/src/api/tmsPull.ts
insert into public.tms_carriers (carrier_name, is_ours, note)
values
  ('Fleet Owner', true, 'กองรถของเราเอง'),
  ('Fleet Owner (Scooter)', true, 'กองรถของเราเอง — สกูตเตอร์')
on conflict (carrier_name) do update set is_ours = excluded.is_ours;

-- 2) ให้การ push เที่ยวเขียน tms_sync_log ทุกครั้ง
--    เดิม log มีแต่ source = 'pl' ฝั่งเที่ยวล้มเหลวแล้วไม่ทิ้งร่องรอยไว้เลย
create or replace function public.push_tms_trips_and_sync(p_rows jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_push json;
  v_sync json;
  v_user bigint := app.current_user_id();
  v_date date;
  v_pl   int;
begin
  v_push := public.push_tms_trips(p_rows);
  v_sync := public.sync_tms_trip_status();

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
    'synced_orders', (v_sync->>'orders')::int
  );
end;
$$;

-- 3) เปิด realtime ให้ตารางที่หน้าเว็บต้องเห็นทันที
--    เดิม publication supabase_realtime ไม่มีตารางเลย ทุกหน้าจึงต้องรอ polling
do $$
declare
  t text;
begin
  foreach t in array array['tms_trips', 'orders', 'trips', 'tms_shipments', 'pod'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
