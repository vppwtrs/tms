/* หน้าภาพรวมดูเป็น "ช่วงวัน" ได้ ไม่ใช่แค่วันเดียว
 *
 * เจ้าของงานขอ: อยากเลือกดูตั้งแต่วันหนึ่งถึงวันหนึ่ง ไม่ใช่ทีละวัน
 * ซึ่งเป็นสิ่งที่ ops_overview รองรับอยู่แล้ว (p_from/p_to) แต่ ops_today ยังไม่
 * ทั้งหน้าจึงเลือกช่วงไม่ได้ทั้งที่ครึ่งหนึ่งของหน้าพร้อมแล้ว
 *
 * ตัวเลขทุกช่องรวมทั้งช่วง ยกเว้นสภาพกองรถ (รถว่าง/ใช้ได้) ซึ่งเป็นสถานะ ณ ตอนนี้
 * ไม่ใช่ของช่วงที่เลือก — สองอย่างนี้ต่างกันและรวมกันไม่ได้
 *
 * ของเดิมที่รับวันเดียวยังอยู่ เป็นตัวห่อที่เรียกตัวใหม่ด้วย from=to เพื่อไม่ให้
 * หน้าเว็บรุ่นที่ยังไม่อัปเดต (ระหว่างรอ Pages บิลด์เสร็จ) พังไปสองสามนาที
 */

create or replace function public.ops_today(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $fn$
declare
  v_tz    constant text := 'Asia/Bangkok';
  /* เกณฑ์และอัตราเบี้ยจุดส่ง — เปลี่ยนที่นี่ที่เดียว */
  v_free_stops constant int := 5;
  v_rate       constant numeric := 50;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_to    date := coalesce(p_to, p_from, v_today);
  v_from  date := coalesce(p_from, v_to);
  v_money boolean;
  v_out   jsonb;
begin
  if not app.has_perm('dashboard.view') then
    raise exception 'ไม่มีสิทธิ์ดูหน้าภาพรวม' using errcode = '42501';
  end if;

  /* ด่านเดียวกับ ops_overview — ช่วงกลับหัวหรือยาวเกินปีคือคำถามที่ตอบไม่ได้
     ปล่อยให้วิ่งจะได้ผลลัพธ์ว่างเปล่าที่อ่านเหมือน "วันนั้นไม่มีงาน" */
  if v_from > v_to then
    raise exception 'ช่วงวันกลับหัว' using errcode = '22007';
  end if;
  if v_to - v_from > 366 then
    raise exception 'ช่วงวันยาวเกิน 1 ปี' using errcode = '22003';
  end if;

  /* ตัวเลขเงินเห็นได้เฉพาะคนที่ดูแผนงานได้ เหมือน ops_overview
     คนที่เห็นแค่ภาพรวมยังเห็นจำนวนเที่ยว/จุดได้ตามปกติ */
  v_money := app.has_perm('dispatch.view');

  with
  tr as (
    select t.id,
           t.vehicle_id,
           t.driver_id,
           t.status,
           t.freight_cost,
           t.freight_actual_cost
      from public.trips t
     where t.status <> 'cancelled'
       and ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date
           between v_from and v_to
  ),
  ord as (
    select tr.id as trip_id,
           app.stop_key(o.customer_id, o.destination) as stop_key,
           o.destination,
           o.status,
           o.delivered_at,
           o.tms_picking_list_no,
           o.id as order_id,
           coalesce(o.work_kind, 'vehicle') as work_kind,
           coalesce(o.tms_unit_count, 0) as units
      from public.orders o
      join tr on tr.id = o.trip_id
  ),
  stop as (
    select trip_id,
           stop_key,
           /* ชื่อร้านที่ยาวที่สุดในกลุ่ม — ใบเดียวกันบางใบส่งที่อยู่มาห้วนกว่า
              เอาตัวที่ข้อมูลครบที่สุดไปแสดง ไม่ใช่ตัวที่บังเอิญมาก่อน */
           (array_agg(destination order by length(coalesce(destination, '')) desc))[1] as name,
           bool_and(status = 'cancelled') as cancelled,
           count(*) filter (where status not in ('delivered', 'cancelled')) = 0 as done,
           max(delivered_at) as last_delivered_at
      from ord
     group by trip_id, stop_key
  ),
  trip_stop as (
    select tr.id,
           tr.vehicle_id,
           tr.status,
           tr.freight_cost,
           tr.freight_actual_cost,
           count(s.stop_key) as stops,
           count(*) filter (where s.done and not s.cancelled) as stops_done
      from tr
      left join stop s on s.trip_id = tr.id
     group by tr.id, tr.vehicle_id, tr.status, tr.freight_cost, tr.freight_actual_cost
  ),
  /* คนขับของเที่ยว — มีได้สองทาง: trips.driver_id (คนหลัก) กับ trip_drivers (ทั้งชุด)
     ต้องรวมสองทางแล้วตัดซ้ำ ไม่งั้นเที่ยวที่บันทึกทั้งสองที่จะนับคนเดียวเป็นสองคน
     แล้วเบี้ยต่อคนจะหารผิด */
  trip_crew as (
    select t.id as trip_id, d.driver_id
      from tr t
      join lateral (
        select t.driver_id as driver_id where t.driver_id is not null
        union
        select td.driver_id from public.trip_drivers td where td.trip_id = t.id
      ) d on true
  ),
  trip_bonus as (
    select ts.id,
           ts.vehicle_id,
           greatest(ts.stops - v_free_stops, 0) as paid_stops,
           greatest(ts.stops - v_free_stops, 0) * v_rate as bonus,
           greatest((select count(*) from trip_crew tc where tc.trip_id = ts.id), 1) as crew
      from trip_stop ts
  ),
  veh as (
    select ts.vehicle_id,
           count(*) as trips,
           sum(ts.stops) as stops,
           sum(ts.stops_done) as stops_done,
           sum(tb.bonus) as bonus,
           max(tb.crew) as crew,
           sum(ts.freight_cost) as cost_plan,
           sum(ts.freight_actual_cost) as cost_actual,
           count(*) filter (where ts.freight_actual_cost is null) as trips_open_cost,
           bool_or(ts.stops > v_free_stops) as over_free
      from trip_stop ts
      join trip_bonus tb on tb.id = ts.id
     where ts.vehicle_id is not null
     group by ts.vehicle_id
  ),
  /* จุดล่าสุดของรถ = จุดที่ปิดล่าสุดในบรรดาเที่ยวของคันนั้นวันนี้
     ไม่ใช่ตำแหน่ง GPS — บนเว็บ ตำแหน่งหยุดส่งทันทีที่คนขับล็อกจอ
     สิ่งที่เชื่อถือได้คือ "เขากดปิดจุดนี้เมื่อกี้" ไม่ใช่หมุดที่อาจค้างมาชั่วโมงแล้ว */
  veh_last as (
    select distinct on (ts.vehicle_id)
           ts.vehicle_id,
           s.name as last_stop,
           s.last_delivered_at
      from trip_stop ts
      join stop s on s.trip_id = ts.id
     where ts.vehicle_id is not null
       and s.last_delivered_at is not null
     order by ts.vehicle_id, s.last_delivered_at desc
  ),
  veh_crew as (
    select ts.vehicle_id,
           string_agg(distinct d.name, ' + ' order by d.name) as crew_names
      from trip_stop ts
      join trip_crew tc on tc.trip_id = ts.id
      join public.drivers d on d.id = tc.driver_id
     where ts.vehicle_id is not null
     group by ts.vehicle_id
  )
  select jsonb_build_object(
    /* คืนช่วงกลับไปด้วยเสมอ หน้าจอจะได้เขียนกำกับว่าตัวเลขที่เห็นเป็นของช่วงไหน
       ไม่ใช่ให้คนจำเอาเองว่าเมื่อกี้เลือกอะไรไว้ */
    'from', v_from,
    'to', v_to,
    'days', (v_to - v_from) + 1,
    'date', v_to,
    'money', v_money,

    /* แถวบนของหน้า — ตัวเลขที่ถูกถามก่อนเสมอ */
    'today', jsonb_build_object(
      'vehicles_used', (select count(*) from veh),
      'vehicles_usable', (select count(*) from public.vehicles
                           where status in ('available', 'on_trip')),
      'vehicles_free', (select count(*) from public.vehicles where status = 'available'),
      'trips', (select count(*) from tr),
      /* หนึ่งใบ = หนึ่ง picking list ถ้าไม่มีเลขใบ (ออเดอร์ที่สร้างเอง) นับเป็นหนึ่งใบ */
      'shipments', (select count(distinct coalesce(tms_picking_list_no, 'ORD-' || order_id))
                      from ord),
      'stops', (select count(*) from stop),
      'stops_done', (select count(*) from stop where done and not cancelled),
      'cost_plan', case when v_money then (select sum(freight_cost) from tr) end,
      'cost_actual', case when v_money then (select sum(freight_actual_cost) from tr) end,
      /* เที่ยวที่ยังไม่มีตัวเลขจริง — หน้าจอต้องเขียนกำกับว่ายอดจริงยังไม่ครบ
         ไม่ใช่ปล่อยให้อ่านว่าวันนี้ถูกกว่าแผน ทั้งที่แค่ยังปิดไม่หมด */
      'trips_open_cost', case when v_money then
        (select count(*) from tr where freight_actual_cost is null) end,
      'bonus_total', case when v_money then
        (select coalesce(sum(bonus), 0) from trip_bonus) end,
      'bonus_trips', (select count(*) from trip_bonus where paid_stops > 0)
    ),

    /* หน่วยงานแยกประเภท — คืนเท่าที่มีจริงในข้อมูล ไม่เติมประเภทที่ไม่มี
       ตรวจ 28 ส.ค. 2569: มีแค่ box กับ vehicle · พาเรทยังไม่มีที่ไหนในฐานเลย
       การส่งช่องพาเรทเป็นศูนย์กลับไปคือการบอกว่า "วันนี้ไม่มีงานพาเรท"
       ทั้งที่ความจริงคือเราไม่รู้ — สองอย่างนี้ต่างกันมากเวลาเอาไปตัดสินใจ */
    'units', coalesce((
      select jsonb_agg(jsonb_build_object('kind', kind, 'orders', n, 'units', u)
                       order by u desc, n desc)
        from (select work_kind as kind, count(*) as n, sum(units) as u
                from ord group by work_kind) k
    ), '[]'::jsonb),

    /* งานรายคัน — หัวใจของ v6 */
    'fleet', coalesce((
      select jsonb_agg(jsonb_build_object(
               'vehicle_id', v.vehicle_id,
               'plate', vv.plate_no,
               'crew', vc.crew_names,
               'crew_size', v.crew,
               'trips', v.trips,
               'stops', v.stops,
               'stops_done', v.stops_done,
               'over_free', v.over_free,
               'last_stop', vl.last_stop,
               'last_at', vl.last_delivered_at,
               'cost_plan', case when v_money then v.cost_plan end,
               'cost_actual', case when v_money then v.cost_actual end,
               'cost_open', v.trips_open_cost,
               'bonus', case when v_money then v.bonus end
             ) order by v.stops desc, vv.plate_no)
        from veh v
        join public.vehicles vv on vv.id = v.vehicle_id
        left join veh_last vl on vl.vehicle_id = v.vehicle_id
        left join veh_crew vc on vc.vehicle_id = v.vehicle_id
    ), '[]'::jsonb),

    'bonus_rule', jsonb_build_object('free_stops', v_free_stops, 'rate', v_rate)
  )
  into v_out;

  return v_out;
end;
$fn$;


comment on function public.ops_today(date, date) is
  'งานในช่วงวัน + งานรายคันสำหรับหน้าภาพรวม — จุดนับด้วย app.stop_key เบี้ยจ่ายเฉพาะจุดที่เกิน 5';

/* ตัวห่อของเดิม — หน้าเว็บรุ่นก่อนเรียกด้วย p_date ตัวเดียว */
create or replace function public.ops_today(p_date date default null)
returns jsonb
language sql
security definer
set search_path = public, app
as $fn$
  select public.ops_today(p_date, p_date)
$fn$;

comment on function public.ops_today(date) is
  'ของเดิมที่รับวันเดียว — เรียก ops_today(from, to) ด้วย from = to';

revoke all on function public.ops_today(date, date) from public, anon, authenticated;
revoke all on function public.ops_today(date)       from public, anon, authenticated;
grant execute on function public.ops_today(date, date) to authenticated;
grant execute on function public.ops_today(date)       to authenticated;
