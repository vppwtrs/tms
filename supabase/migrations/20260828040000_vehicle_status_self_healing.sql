/* สถานะรถต้องตามความจริงเสมอ ไม่ใช่ตามว่าใครจำได้บ้างว่าต้องอัปเดต
 *
 * ตรวจฐานจริง 28 ส.ค. 2569: รถ 3 จาก 6 คันค้าง `on_trip` ทั้งที่ไม่มีเที่ยวเปิดอยู่เลย
 * (3ฒน5038, 4ฒญ9844, 4ฒญ9850) และไม่มีคันไหนเป็น available สักคัน หน้าจัดการรถ
 * จึงบอกว่ารถเต็มอู่ทั้งที่ว่างอยู่ครึ่งอู่ และหน้าภาพรวมที่เพิ่งทำก็จะโกหกด้วย
 * เพราะอ่านจากช่องเดียวกัน
 *
 * ต้นเหตุไม่ใช่ RPC ตัวใดตัวหนึ่งเขียนผิด แต่เป็น**รูปแบบ**: `vehicles.status` เป็นค่า
 * ที่จำไว้ ไม่ใช่ค่าที่คำนวณ ทุกเส้นทางที่แตะเที่ยวต้องจำอัปเดตให้ครบเอง —
 * create_trip, ยกเลิกเที่ยว, ลบเที่ยว, ปิดเที่ยว, การซิงก์สถานะจาก TMS, สคริปต์แก้ข้อมูล
 * พลาดเส้นเดียวก็ค้าง และค้างแบบเงียบ ๆ ไม่มีอะไรเตือน
 *
 * ที่แก้: ให้ฐานคำนวณเองทุกครั้งที่ตาราง trips ขยับ ไม่ว่าขยับด้วยเส้นทางไหน
 * RPC เดิมยังเขียนค่าเหมือนเดิมได้ ไม่ต้องแก้สักตัว — trigger ทำงานทีหลังและได้ผลเท่ากัน
 * ต่างกันตรงที่ตอนนี้เส้นทางที่ "ลืม" ก็ถูกต้องด้วย
 *
 * ทำไมไม่ทิ้งช่องนี้แล้วใช้ view คำนวณสด: ของที่อ่านช่องนี้มีทั้งหน้าเว็บ RPC และ
 * ตัวจัดเที่ยว การเปลี่ยนพร้อมกันทั้งหมดเสี่ยงกว่าที่ได้คืน ช่องนี้จึงอยู่ต่อ
 * แต่เลิกเป็นของที่ต้องมีคนคอยดูแล
 */

/* ซ่อม/ปลดระวาง เป็นการตัดสินใจของคน ไม่ใช่ผลของงานที่วิ่งอยู่ — trigger ห้ามแตะ
   รถที่เข้าอู่ระหว่างมีเที่ยวค้าง ต้องยังเป็น maintenance ต่อไป */
create or replace function app.sync_vehicle_status(p_vehicle_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_vehicle_id is null then return; end if;

  update public.vehicles v
     set status = case
                    when exists (
                      select 1 from public.trips t
                       where t.vehicle_id = p_vehicle_id
                         and t.status in ('planned', 'in_progress', 'returning')
                    ) then 'on_trip'::vehicle_status
                    else 'available'::vehicle_status
                  end
   where v.id = p_vehicle_id
     and v.status in ('available', 'on_trip')   -- ไม่แตะ maintenance / inactive
     and v.status is distinct from case
                    when exists (
                      select 1 from public.trips t
                       where t.vehicle_id = p_vehicle_id
                         and t.status in ('planned', 'in_progress', 'returning')
                    ) then 'on_trip'::vehicle_status
                    else 'available'::vehicle_status
                  end;
end;
$fn$;

comment on function app.sync_vehicle_status(bigint) is
  'ตั้ง vehicles.status ตามเที่ยวที่เปิดอยู่จริง — ไม่แตะ maintenance/inactive';

create or replace function app.trips_sync_vehicle()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  /* ย้ายรถข้ามเที่ยวต้องซิงก์สองคัน คันเก่าอาจว่างลง คันใหม่อาจไม่ว่างแล้ว */
  if tg_op = 'UPDATE' and old.vehicle_id is distinct from new.vehicle_id then
    perform app.sync_vehicle_status(old.vehicle_id);
  end if;

  if tg_op = 'DELETE' then
    perform app.sync_vehicle_status(old.vehicle_id);
  else
    perform app.sync_vehicle_status(new.vehicle_id);
  end if;

  return null;
end;
$fn$;

drop trigger if exists trips_sync_vehicle on public.trips;

/* AFTER ทุกอย่างที่แตะ trips — insert (จ่ายงาน), update (สถานะเปลี่ยน/ย้ายรถ),
   delete (ลบเที่ยว) ครอบทั้งเส้นทางที่เขียนเองและที่มาจากการซิงก์กับ TMS */
create trigger trips_sync_vehicle
after insert or update of vehicle_id, status or delete on public.trips
for each row execute function app.trips_sync_vehicle();

/* ---- ซ่อมของที่ค้างอยู่ตอนนี้ ----
   คำนวณใหม่ทุกคันจากเที่ยวจริง ไม่ใช่แค่คันที่รู้ว่าค้าง เพราะไม่มีทางรู้ว่ามีกี่คัน
   ที่เพี้ยนไปแล้วโดยไม่มีใครสังเกต */
update public.vehicles v
   set status = case
                  when exists (
                    select 1 from public.trips t
                     where t.vehicle_id = v.id
                       and t.status in ('planned', 'in_progress', 'returning')
                  ) then 'on_trip'::vehicle_status
                  else 'available'::vehicle_status
                end
 where v.status in ('available', 'on_trip');

/* คนขับมีรูปแบบเดียวกันเป๊ะ ๆ และเพี้ยนได้ด้วยเหตุผลเดียวกัน — แต่ผูกกับเที่ยว
   ผ่าน trip_drivers (คนขับหลายคนต่อเที่ยวได้) จึงต้องดูทั้งสองทาง */
create or replace function app.sync_driver_status(p_driver_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_busy boolean;
begin
  if p_driver_id is null then return; end if;

  select exists (
    select 1 from public.trips t
     where t.status in ('planned', 'in_progress', 'returning')
       and (t.driver_id = p_driver_id
            or exists (select 1 from public.trip_drivers td
                        where td.trip_id = t.id and td.driver_id = p_driver_id))
  ) into v_busy;

  /* off_duty คือคนลา ไม่ใช่ผลของงาน — ห้ามแตะ เหมือน maintenance ของรถ */
  update public.drivers d
     set status = case when v_busy then 'on_trip'::driver_status
                       else 'available'::driver_status end
   where d.id = p_driver_id
     and d.status in ('available', 'on_trip')
     and d.status is distinct from case when v_busy then 'on_trip'::driver_status
                                        else 'available'::driver_status end;
end;
$fn$;

create or replace function app.trips_sync_driver()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'UPDATE' and old.driver_id is distinct from new.driver_id then
    perform app.sync_driver_status(old.driver_id);
  end if;

  if tg_op = 'DELETE' then
    perform app.sync_driver_status(old.driver_id);
  else
    perform app.sync_driver_status(new.driver_id);
  end if;

  return null;
end;
$fn$;

drop trigger if exists trips_sync_driver on public.trips;
create trigger trips_sync_driver
after insert or update of driver_id, status or delete on public.trips
for each row execute function app.trips_sync_driver();

create or replace function app.trip_drivers_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'DELETE' then
    perform app.sync_driver_status(old.driver_id);
  else
    perform app.sync_driver_status(new.driver_id);
    if tg_op = 'UPDATE' and old.driver_id is distinct from new.driver_id then
      perform app.sync_driver_status(old.driver_id);
    end if;
  end if;
  return null;
end;
$fn$;

drop trigger if exists trip_drivers_sync on public.trip_drivers;
create trigger trip_drivers_sync
after insert or update of driver_id or delete on public.trip_drivers
for each row execute function app.trip_drivers_sync();

/* ซ่อมคนขับที่ค้างอยู่ตอนนี้ ด้วยกติกาเดียวกับ trigger */
update public.drivers d
   set status = case
                  when exists (
                    select 1 from public.trips t
                     where t.status in ('planned', 'in_progress', 'returning')
                       and (t.driver_id = d.id
                            or exists (select 1 from public.trip_drivers td
                                        where td.trip_id = t.id and td.driver_id = d.id))
                  ) then 'on_trip'::driver_status
                  else 'available'::driver_status
                end
 where d.status in ('available', 'on_trip');

revoke all on function app.sync_vehicle_status(bigint) from public, anon, authenticated;
revoke all on function app.sync_driver_status(bigint)  from public, anon, authenticated;
