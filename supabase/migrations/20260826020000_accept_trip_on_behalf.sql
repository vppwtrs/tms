/* ให้ "รับงานแทน" บนกระดานจัดรถทำงานได้จริง และปิดรูที่ด่านกันสิทธิ์เปิดค้างไว้
 *
 * ปุ่มนี้มีบนการ์ดมาตลอดพร้อมคอมเมนต์ว่าตั้งใจให้คนวางแผนกดแทนคนขับที่โทรคุยกันแล้ว
 * แต่ accept_trip ถูกเขียนไว้สำหรับคนขับกดรับงานของตัวเองเท่านั้น มันอ่าน
 * app.current_driver_id() ซึ่งเป็น null สำหรับคนที่ไม่ใช่คนขับ แล้วเอาค่านั้นไป insert
 * ลง trip_drivers.driver_id ตรง ๆ คนกดจึงได้ข้อความดิบจาก Postgres ว่า
 * null value in column "driver_id" ... violates not-null constraint
 *
 * ที่อันตรายกว่าคือด่านก่อนหน้านั้น
 *
 *   v_mine := v_trip.driver_id = v_me;   -- v_me เป็น null ได้ null ไม่ใช่ false
 *   if not v_mine then raise ...         -- not null คือ null บล็อกนี้จึงไม่ทำงาน
 *
 * แปลว่า "เที่ยวนี้ไม่ใช่งานของคุณ" ไม่เคยถูกโยนเมื่อคนกดไม่ได้เป็นคนขับ สิ่งเดียวที่หยุดไว้
 * คือ not-null constraint ปลายทาง ซึ่งเป็นการกันโดยบังเอิญ ไม่ใช่การกันที่ตั้งใจ
 *
 * ที่แก้:
 *   1. เทียบด้วย is not true เพื่อให้ null นับเป็น "ไม่ใช่ของคุณ" ไม่ใช่ "ไม่รู้ ปล่อยผ่าน"
 *   2. เพิ่มทางของคนวางแผน — มี dispatch.write ให้รับแทนคนขับหลักของเที่ยวนั้นได้
 *      คนที่ถูกบันทึกว่ารับงานคือคนขับ ไม่ใช่คนที่กด เพราะประวัติต้องอ่านว่าใครวิ่งงาน
 *      ส่วนคนกดไปอยู่ใน trips.notes ต่อท้าย เพื่อให้ย้อนได้ว่าใครเป็นคนรับแทน
 *   3. เที่ยวที่ยังไม่มีคนขับ รับแทนไม่ได้ ต้องจ่ายคนขับก่อน ไม่ใช่เดาให้
 */

create or replace function public.accept_trip(p_trip_id bigint)
returns json
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_me       bigint := app.current_driver_id();
  v_trip     public.trips;
  v_tms      int;
  v_mine     boolean;
  v_for      bigint;          -- คนขับที่การรับงานครั้งนี้นับเป็นของเขา
  v_behalf   boolean := false;
  v_actor    text;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found then
    raise exception 'ไม่พบเที่ยวนี้' using errcode = 'P0002';
  end if;

  v_mine := v_trip.driver_id = v_me
         or exists (select 1 from public.trip_drivers td
                     where td.trip_id = p_trip_id and td.driver_id = v_me);

  if v_mine is true then
    /* คนขับกดรับงานของตัวเอง — ทางเดิม ไม่เปลี่ยนเงื่อนไข */
    if not app.has_perm('myjobs.progress') then
      raise exception 'ไม่มีสิทธิ์อัปเดตงาน' using errcode = '42501';
    end if;
    v_for := v_me;
  elsif app.has_perm('dispatch.write') then
    /* คนวางแผนกดแทน — รับแทนได้เฉพาะคนขับที่ผูกกับเที่ยวนี้อยู่แล้ว */
    v_for := app.trip_primary_driver(p_trip_id);
    if v_for is null then
      raise exception 'เที่ยวนี้ยังไม่มีคนขับ จ่ายงานให้คนขับก่อนจึงรับแทนได้'
        using errcode = 'P0001';
    end if;
    v_behalf := true;
  else
    raise exception 'เที่ยวนี้ไม่ใช่งานของคุณ' using errcode = '42501';
  end if;

  insert into public.trip_drivers as td (trip_id, driver_id, seq, accepted_at)
  values (p_trip_id, v_for, 1, now())
  on conflict (trip_id, driver_id) do update
    set accepted_at = coalesce(td.accepted_at, now());

  if v_trip.accepted_at is not null then
    return json_build_object('trip_id', p_trip_id, 'already', true,
                             'accepted', public.trip_accept_state(p_trip_id));
  end if;

  select status_id into v_tms from public.tms_trips where trip_id = p_trip_id;

  update public.trips
     set accepted_at = now(),
         accepted_by = v_for,
         status = case
           when status = 'planned' and coalesce(v_tms, 0) in (3, 4) then 'in_progress'
           else status
         end,
         departed_at = case
           when status = 'planned' and coalesce(v_tms, 0) in (3, 4)
           then coalesce(departed_at, now())
           else departed_at
         end
   where id = p_trip_id;

  if v_behalf then
    select coalesce(u.name, u.username) into v_actor
      from public.users u where u.auth_id = auth.uid();
    update public.trips
       set notes = concat_ws(E'\n', nullif(notes, ''),
                             'รับงานแทนโดย ' || coalesce(v_actor, 'ผู้ใช้ระบบ') ||
                             ' เมื่อ ' || to_char(timezone('Asia/Bangkok', now()),
                                                  'DD/MM/YYYY HH24:MI'))
     where id = p_trip_id;
  end if;

  return json_build_object('trip_id', p_trip_id, 'already', false,
                           'on_behalf', v_behalf,
                           'accepted', public.trip_accept_state(p_trip_id));
end;
$fn$;
