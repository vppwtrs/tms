/* หน้าภาพรวม v6 — ฐานต้องตอบสองคำถามที่ v5 ไม่เคยถูกถาม
 *
 * v5 ตอบว่า "วันนี้ไปถึงไหนแล้ว" ในภาพรวม แต่เจ้าของงานถามละเอียดกว่านั้น:
 * วันนี้ใช้รถกี่คัน ได้กี่เที่ยว กี่ใบ กี่จุด · แยกเป็นงานประเภทไหนบ้าง ·
 * **รถคันนี้** ได้กี่เที่ยว กี่จุด เกิน 5 จุดไหม ต้องจ่ายเบี้ยเท่าไร ตอนนี้ถึงไหนแล้ว ·
 * และค่าขนส่งที่ตกลงไว้ กับที่จ่ายจริง ต่างกันเท่าไร
 *
 * ทำเป็นสองฟังก์ชันใหม่ ไม่ไปแก้ ops_overview
 * ---------------------------------------------------------------
 * ops_overview เป็นฟังก์ชันสี่ร้อยบรรทัดที่หน้าแรกใช้อยู่จริงและผ่านการตรวจกับข้อมูลจริง
 * มาแล้ว การพิมพ์มันใหม่ทั้งก้อนเพื่อเติมสามบล็อกคือการเอาของที่ใช้งานได้ไปเสี่ยง
 * โดยไม่ได้อะไรกลับมา สองฟังก์ชันนี้จึงแยกออกมา ทดสอบแยกได้ และถ้าพังก็พังเฉพาะ
 * ส่วนใหม่ ส่วนความคืบหน้ากับ Issues ยังขึ้นตามปกติ
 *
 * กติกาที่ยึดตาม ops_overview ทุกข้อ ห้ามแตกต่าง
 * ---------------------------------------------------------------
 *   · วันของเที่ยว = วันที่ออกรถ ยังไม่ออกใช้วันที่สร้าง (departed_at, created_at)
 *   · เที่ยวที่ยกเลิกไม่นับ ไม่มีใครวิ่ง ไม่มีค่าเหมา
 *   · หนึ่งจุดส่ง = หนึ่งร้านในหนึ่งเที่ยว ผ่าน app.stop_key (= storeKey ใน stops.ts)
 *     ไม่ใช่หนึ่งใบ — ใบสามใบส่งร้านเดียวกันคือจุดเดียว
 *   · null ใน freight_cost / freight_actual_cost แปลว่า "ยังไม่มีตัวเลข" ไม่ใช่ "ศูนย์บาท"
 *     จึงไม่ coalesce เป็น 0 แต่รายงานจำนวนเที่ยวที่มีตัวเลขกลับไปให้หน้าจอเขียนกำกับ
 *
 * เบี้ยจุดส่ง — กติกาที่เจ้าของงานยืนยันเมื่อ 28 ส.ค. 2569
 * ---------------------------------------------------------------
 *   จ่าย **เฉพาะจุดที่เกิน 5** จุดละ 50 บาท ต่อหนึ่งเที่ยว
 *   ถ้าเที่ยวนั้นขึ้นหลายคน **หารกันในยอดเดิม** ไม่ใช่คนละยอดเต็ม
 *   เที่ยว 8 จุด คนขับ 2 คน = (8-5) x 50 = 150 บาท = คนละ 75
 *
 *   ยอดนี้ **ไม่ถูกบวกเข้ากับ freight_actual_cost** เพราะยังไม่มีใครยืนยันว่ายอดที่
 *   ปิดจริงรวมเบี้ยไปแล้วหรือยัง บวกซ้ำแล้วต้นทุนจะเกินจริงโดยไม่มีใครจับได้
 *   วันไหนยืนยันว่ารวมแล้ว ค่อยรวมที่นี่ที่เดียว
 *
 *   อัตรากับเกณฑ์อยู่เป็นค่าคงที่ในฟังก์ชัน ไม่ได้ทำเป็นตารางตั้งค่า เพราะมีกติกา
 *   เดียวทั้งบริษัทและยังไม่เคยเปลี่ยน ทำตารางไว้ก่อนคือการสร้างของที่ต้องดูแล
 *   เพื่อรองรับสิ่งที่ยังไม่เกิด
 */

/* ---------- 1. งานวันนี้ + งานรายคัน ---------- */
create or replace function public.ops_today(p_date date default null)
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
  v_day   date := coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date);
  v_money boolean;
  v_out   jsonb;
begin
  if not app.has_perm('dashboard.view') then
    raise exception 'ไม่มีสิทธิ์ดูหน้าภาพรวม' using errcode = '42501';
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
       and ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date = v_day
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
    'date', v_day,
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

comment on function public.ops_today(date) is
  'งานวันนี้ + งานรายคันสำหรับหน้าภาพรวม v6 — จุดนับด้วย app.stop_key เบี้ยจ่ายเฉพาะจุดที่เกิน 5';

/* ---------- 2. ปริมาณงาน วัน / เดือน / ปี ---------- */
create or replace function public.ops_volume(p_grain text default 'day')
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $fn$
declare
  v_tz    constant text := 'Asia/Bangkok';
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_grain text := lower(coalesce(p_grain, 'day'));
  v_unit  text;
  v_span  int;
  v_out   jsonb;
begin
  if not app.has_perm('dashboard.view') then
    raise exception 'ไม่มีสิทธิ์ดูหน้าภาพรวม' using errcode = '42501';
  end if;

  /* สามช่วงเวลานี้ตอบคนละคำถาม: วัน = สัปดาห์นี้เป็นยังไง · เดือน = ปีนี้เป็นยังไง ·
     ปี = โตขึ้นไหม จำนวนจุดที่ย้อนกลับไปจึงไม่เท่ากัน */
  if v_grain = 'month' then
    v_unit := 'month'; v_span := 12;
  elsif v_grain = 'year' then
    v_unit := 'year';  v_span := 5;
  else
    v_grain := 'day';  v_unit := 'day'; v_span := 14;
  end if;

  with
  bucket as (
    select generate_series(
             date_trunc(v_unit, v_today::timestamp) - ((v_span - 1) || ' ' || v_unit)::interval,
             date_trunc(v_unit, v_today::timestamp),
             ('1 ' || v_unit)::interval
           )::date as key
  ),
  tr as (
    select t.id,
           date_trunc(v_unit,
             ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date::timestamp
           )::date as key
      from public.trips t
     where t.status <> 'cancelled'
       and ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date
           >= (select min(key) from bucket)
  ),
  stop as (
    select tr.key, tr.id as trip_id, app.stop_key(o.customer_id, o.destination) as stop_key
      from public.orders o
      join tr on tr.id = o.trip_id
     where o.status <> 'cancelled'
     group by 1, 2, 3
  ),
  agg as (
    select b.key,
           (select count(*) from stop s where s.key = b.key) as stops,
           (select count(*) from tr t where t.key = b.key) as trips
      from bucket b
  )
  select jsonb_build_object(
    'grain', v_grain,
    'points', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', a.key,
               'stops', a.stops,
               'trips', a.trips,
               /* ช่วงสุดท้ายยังไม่จบ เทียบเต็มช่วงกับช่วงก่อนหน้าไม่ได้
                  หน้าจอวาดแท่งนี้เป็นแบบจาง แล้วเขียนกำกับ ไม่ใช่ปล่อยให้อ่านว่าตกฮวบ */
               'partial', a.key = date_trunc(v_unit, v_today::timestamp)::date
             ) order by a.key)
        from agg a
    ), '[]'::jsonb)
  )
  into v_out;

  return v_out;
end;
$fn$;

comment on function public.ops_volume(text) is
  'ปริมาณงานรายวัน/เดือน/ปีสำหรับกราฟหน้าภาพรวม — ช่วงสุดท้ายมี partial=true เสมอ';

/* สิทธิ์: ปิดของทุกคนก่อน แล้วเปิดให้เฉพาะคนที่ล็อกอิน — ด่านจริงคือ app.has_perm
   ข้างในฟังก์ชัน ตรงนี้แค่กันไม่ให้ anon เรียกได้ตั้งแต่แรก */
revoke all on function public.ops_today(date)  from public, anon, authenticated;
revoke all on function public.ops_volume(text) from public, anon, authenticated;
grant execute on function public.ops_today(date)  to authenticated;
grant execute on function public.ops_volume(text) to authenticated;
