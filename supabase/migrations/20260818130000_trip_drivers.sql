-- คนขับคนที่สองหายไปจากทุกเส้นทางหลังนำเข้า
--
-- ตั้งแต่แยกชื่อคนขับ (20260818020000) เที่ยวที่ไปสองคนจะตั้งทุกคนเป็น on_trip
-- แต่ trips เก็บคนขับได้คนเดียวใน driver_id คนที่เหลืออยู่แค่ในข้อความหมายเหตุ
-- ผลคือ:
--  * ปิดเที่ยว/ยกเลิกเที่ยว คืนสถานะให้เฉพาะ driver_id — คนที่สองค้าง on_trip ตลอดไป
--    (เห็นในหน้าพนักงานขับ: ชื่อเดียวกันแถวหนึ่งว่าง อีกแถวกำลังขนส่งไม่มีวันหลุด)
--  * view my_trips กรองด้วย t.driver_id คนที่สองเปิดแอปแล้วไม่เห็นงานที่ตัวเองไปด้วย
--  * รายงานต่อคนขับนับงานให้คนแรกคนเดียว
--
-- แก้ที่โครงสร้าง ไม่ใช่ไล่แปะทีละจุด: เก็บคนขับของเที่ยวเป็นตารางความสัมพันธ์
-- trips.driver_id ยังอยู่เหมือนเดิมในฐานะ "คนขับหลัก" เพราะโค้ดอีกหลายที่ยังอ้างถึง

create table if not exists public.trip_drivers (
  trip_id    bigint not null references public.trips (id) on delete cascade,
  driver_id  bigint not null references public.drivers (id) on delete cascade,
  seq        smallint not null default 1,
  created_at timestamptz not null default now(),
  primary key (trip_id, driver_id)
);

create index if not exists trip_drivers_driver_idx on public.trip_drivers (driver_id);

alter table public.trip_drivers enable row level security;

drop policy if exists trip_drivers_select on public.trip_drivers;
create policy trip_drivers_select on public.trip_drivers
  for select using (
    app.has_perm('dispatch.view')
    /* คนขับต้องอ่านแถวของตัวเองได้ ไม่งั้น my_trips ที่ join ตารางนี้จะว่างเปล่า */
    or driver_id = app.current_driver_id()
  );

drop policy if exists trip_drivers_write on public.trip_drivers;
create policy trip_drivers_write on public.trip_drivers
  for all using (app.has_perm('dispatch.write'))
  with check (app.has_perm('dispatch.write'));

-- เติมย้อนหลัง: คนขับหลักของทุกเที่ยวที่มีอยู่แล้ว
insert into public.trip_drivers (trip_id, driver_id, seq)
select t.id, t.driver_id, 1
  from public.trips t
 where t.driver_id is not null
on conflict do nothing;

-- เติมย้อนหลัง: คนที่ไปด้วย เอาจากชื่อใน tms_trips ที่ผูกกับเที่ยวนั้น
-- ข้อมูลต้นทางยังอยู่ครบ ไม่ต้องไปแกะจากข้อความหมายเหตุ
insert into public.trip_drivers (trip_id, driver_id, seq)
select x.trip_id, m.driver_id, u.ord::smallint
  from public.tms_trips x
  cross join lateral unnest(app.tms_driver_names(x.driver_name))
    with ordinality as u(n, ord)
  join public.tms_driver_map m
    on m.driver_key = u.n and not m.ignored and m.driver_id is not null
 where x.trip_id is not null
on conflict do nothing;

-- คนที่ค้าง on_trip ทั้งที่เที่ยวจบไปแล้ว ต้องคืนสถานะให้ตรงความจริง
update public.drivers d
   set status = 'available'
 where d.status = 'on_trip'
   and not exists (
     select 1
       from public.trip_drivers td
       join public.trips t on t.id = td.trip_id
      where td.driver_id = d.id
        and t.status in ('planned', 'in_progress')
   );

-- คนขับทุกคนของเที่ยวเห็นงานของตัวเอง ไม่ใช่แค่คนขับหลัก
create or replace view public.my_trips as
  select t.id, t.trip_no, t.status, t.departed_at, t.arrived_at, t.notes,
         v.plate_no, v.vehicle_type
    from public.trips t
    join public.vehicles v on v.id = t.vehicle_id
   where app.has_perm('myjobs.view')
     and (
       t.driver_id = app.current_driver_id()
       or exists (
         select 1 from public.trip_drivers td
          where td.trip_id = t.id and td.driver_id = app.current_driver_id()
       )
     );
