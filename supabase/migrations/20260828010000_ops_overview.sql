/* หน้าภาพรวม — สรุปทั้งหน้าด้วยการเรียกครั้งเดียว
 *
 * หน้าเว็บห้ามดึงตารางดิบมานับเอง ด้วยเหตุผลสองข้อ
 *   1. ช้า — จุดส่งหนึ่งวันเป็นหลักร้อยแถว และต้องจับกลุ่มร้านก่อนถึงจะนับได้
 *   2. จะได้เลขไม่ตรงกับหน้าอื่น — การจับกลุ่มร้านมีกติกาของมันอยู่แล้วใน
 *      web/src/utils/stops.ts (groupStops) ถ้าหน้าแรกนับด้วยกติกาของตัวเอง
 *      หน้าแรกกับจอคนขับจะบอกจำนวนจุดไม่เท่ากัน ซึ่งเป็นบั๊กที่ไม่มีใครจับได้
 *
 * app.stop_key ข้างล่างคือ storeKey() ใน stops.ts แปลเป็น SQL ตรงตัว
 * แก้ที่ไหนต้องแก้อีกที่เสมอ — มีชุดตัวอย่างเทียบสองฝั่งไว้ที่
 * supabase/tests/stop_key_parity.sql กับ web/src/utils/stops.test.ts ชุดเดียวกัน
 *
 * ===== ตัวชี้วัดที่ไม่ได้อยู่ในนี้ และห้ามใส่กลับ =====
 *
 * OTIF / ส่งตรงเวลา — orders.scheduled_at ไม่เคยถูกเทียบกับ delivered_at ที่ไหน
 *   เลยสักบรรทัดในทั้งระบบ ถูกใช้แค่เรียงลำดับกับกรองช่วงวัน และลำดับการแวะ
 *   เป็นสิ่งที่ระบบตั้งใจให้คนขับจัดเอง = จะไปวัดสิ่งที่ระบบตั้งใจไม่ควบคุม
 *   ที่ใช้แทนคือ "จบครบภายในวัน" ซึ่งเทียบ *วัน* ไม่ใช่เวลา
 *
 * เวลาเฉลี่ยต่อจุด — งานส่วนใหญ่เป็นเหมาจ่าย เวลาไม่ใช่ตัวที่ทำให้เงินคุ้มหรือไม่คุ้ม
 *   และ departed_at ถึง arrived_at คือเวลาทั้งเที่ยว ไม่ใช่เวลาที่จุด หารเฉลี่ยแล้ว
 *   ได้เลขที่ไม่มีใครสั่งการอะไรกับมันได้ ที่ใช้แทนคือ "จุดต่อเที่ยว"
 *
 * ต้นทุนต่อจุดจาก fuel + toll + other — สามค่านี้เป็นเบิกจ่ายของคนขับที่คนกรอกเอง
 *   กรอกบ้างไม่กรอกบ้าง เงินของหนึ่งเที่ยวคือก้อนเดียวจาก TMS (freight_cost /
 *   freight_actual_cost) ที่ใช้แทนคือ "ค่าเหมาต่อจุด" จากก้อนนั้นก้อนเดียว
 */

create schema if not exists app;

/* trim + lower + ยุบช่องว่างซ้ำ — norm() ใน stops.ts */
create or replace function app.norm_txt(p_text text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select regexp_replace(lower(trim(coalesce(p_text, ''))), '\s+', ' ', 'g')
$fn$;

/* คีย์ของร้าน = storeKey() ใน stops.ts — กติกาของฝั่งออฟฟิศ
 *
 * ใบที่จับคู่ลูกค้าไว้แล้วใช้ customer_id ตรง ๆ นั่นคือคำตอบที่ถูกที่สุดว่า
 * "ร้านเดียวกันไหม" ใบที่ไม่ได้จับคู่ต้องเดาจาก destination ซึ่งตอนนำเข้าถูกประกอบ
 * เป็น "ชื่อจุดส่ง · ที่อยู่ จ.จังหวัด" — ช่องที่อยู่ที่ TMS ส่งมามักเป็นชื่อกับเบอร์
 * ของคนรับ ไม่ใช่ถนน ร้านเดียวที่สั่งสามใบโดยระบุคนรับคนละคนจึงเคยกลายเป็นสามจุดแวะ
 * เทียบเฉพาะส่วนหน้าบวกจังหวัด ซึ่งเป็นตัวที่บอกว่า "รถจอดที่เดียวกันไหม" จริง ๆ
 *
 * ไม่ใช้ keyOf() ของจอคนขับ เพราะชุดข้อมูลของคนขับไม่มี customer_id มาให้
 * เลยต้องเทียบด้วยชื่อ/ที่อยู่แทน ที่นี่มี customer_id จึงใช้ของที่แม่นกว่า
 */
create or replace function app.stop_key(p_customer_id bigint, p_destination text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
           when p_customer_id is not null and p_customer_id <> 0
             then 'c' || p_customer_id
           /* shipToName(): ส่วนหน้าสุด ถ้าว่างให้ถอยไปใช้ทั้งเส้น */
           else app.norm_txt(coalesce(
                  nullif(trim(split_part(coalesce(p_destination, ''), ' · ', 1)), ''),
                  p_destination
                ))
             || '|'
             || app.norm_txt((regexp_match(coalesce(p_destination, ''), 'จ\.([^·]+)$'))[1])
         end
$fn$;

/* ==========================================================================
 * ops_overview(p_from, p_to) — ทุกก้อนของหน้าภาพรวมในการเรียกครั้งเดียว
 *
 * ไม่ส่งวันมา = วันนี้ · ส่ง p_from อย่างเดียว = ตั้งแต่วันนั้นถึงวันนี้
 *
 * สิทธิ์ไม่ถึงก้อนไหน ก้อนนั้นเป็น null ไม่ใช่หน้าพัง — กติกาเดียวกับ opsInsights
 * ตัวเลขเงิน (ค่าเหมาต่อจุด, ส่วนต่างสัญญา) ขอ dispatch.view เพิ่ม
 * เพราะเป็นราคาตามสัญญาที่ไม่ใช่ทุกคนในออฟฟิศต้องเห็น
 * ========================================================================== */
create or replace function public.ops_overview(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $fn$
declare
  v_tz    constant text := 'Asia/Bangkok';
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_to    date := coalesce(p_to, v_today);
  v_from  date := coalesce(p_from, v_to);
  v_money boolean;
  v_out   jsonb;
begin
  if not app.has_perm('dashboard.view') then
    raise exception 'ไม่มีสิทธิ์ดูหน้าภาพรวม' using errcode = '42501';
  end if;

  if v_from > v_to then
    raise exception 'ช่วงวันกลับหัว' using errcode = '22007';
  end if;
  if v_to - v_from > 366 then
    raise exception 'ช่วงวันยาวเกิน 1 ปี' using errcode = '22003';
  end if;

  v_money := app.has_perm('dispatch.view');

  with
  /* เที่ยวในช่วง — วันของเที่ยวคือวันที่ออกรถ ยังไม่ออกก็ใช้วันที่สร้าง
     เที่ยวที่ถูกยกเลิกไม่นับ ไม่มีใครวิ่ง ไม่มีค่าเหมา */
  tr as (
    select t.id,
           t.freight_cost,
           t.freight_actual_cost,
           ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date as day
      from public.trips t
     where t.status <> 'cancelled'
       and ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date
           between v_from and v_to
  ),
  ord as (
    select tr.id  as trip_id,
           tr.day as day,
           app.stop_key(o.customer_id, o.destination) as stop_key,
           o.status,
           o.delivered_at,
           o.cancel_reason
      from public.orders o
      join tr on tr.id = o.trip_id
  ),
  /* จุดส่งหนึ่งจุด = หนึ่งร้านในหนึ่งเที่ยว ไม่ใช่หนึ่งใบ */
  stop as (
    select trip_id,
           day,
           stop_key,
           bool_and(status = 'cancelled') as cancelled,
           count(*) filter (where status not in ('delivered', 'cancelled')) as pending,
           max(delivered_at) as last_delivered_at
      from ord
     group by trip_id, day, stop_key
  ),
  stop_day as (
    select s.*,
           (not s.cancelled)
             and s.pending = 0
             and (s.last_delivered_at at time zone v_tz)::date <= s.day as done_in_day
      from stop s
  ),
  /* ค่าเหมาคิดที่ระดับเที่ยว: หารด้วยจุดที่เที่ยวนั้นแวะ รวมจุดที่ยกเลิกด้วย
     เพราะรถวิ่งไปถึงแล้ว ค่าเหมาไม่ได้ลดลงตามจุดที่ส่งไม่ได้
     null ในสองช่องนี้แปลว่า "ยังไม่มีตัวเลข" ไม่ใช่ "ศูนย์บาท" (ดู comment ในฐาน)
     จึงตัดออกจากทั้งเศษและส่วน แล้วรายงานกลับไปว่าคิดจากกี่ % ของเที่ยว */
  trip_stop as (
    select tr.id,
           tr.freight_cost,
           tr.freight_actual_cost,
           coalesce(tr.freight_actual_cost, tr.freight_cost) as freight,
           count(s.stop_key) as stops
      from tr
      left join stop s on s.trip_id = tr.id
     group by tr.id, tr.freight_cost, tr.freight_actual_cost
  ),
  /* ประวัติ 28 วันย้อนหลัง สำหรับค่าเฉลี่ยเคลื่อนที่ 4 สัปดาห์แยกตามวันในสัปดาห์
     ไม่ผูกกับ p_from/p_to เพราะการคาดการณ์ต้องมองย้อนเท่ากันเสมอ */
  hist_stop as (
    select ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date as day,
           t.id as trip_id,
           app.stop_key(o.customer_id, o.destination) as stop_key
      from public.trips t
      join public.orders o on o.trip_id = t.id
     where t.status <> 'cancelled'
       and ((coalesce(t.departed_at, t.created_at)) at time zone v_tz)::date
           between v_today - 27 and v_today
     group by 1, 2, 3
  ),
  hist_day as (
    select day, count(*) as stops from hist_stop group by day
  ),
  /* ยืนยันแล้ว = TMS วางแผนวันส่งไว้จริง มองเห็นล่วงหน้าได้ 2-3 วัน
     นับเป็นร้าน ไม่ใช่ใบเบิก ให้เข้ากติกาเดียวกับจุดส่ง */
  planned as (
    select s.plan_delivery_date::date as day,
           count(distinct (app.norm_txt(s.ship_to_name) || '|'
                        || app.norm_txt(s.ship_to_province))) as stops
      from public.tms_shipments s
     where s.plan_delivery_date is not null
       and s.plan_delivery_date::date > v_today
       and s.plan_delivery_date::date <= v_today + 7
     group by 1
  ),
  future as (
    select d::date as day
      from generate_series(v_today + 1, v_today + 7, interval '1 day') d
  ),
  /* ประมาณการ = ค่าเฉลี่ยของวันเดียวกันในสัปดาห์ 4 ครั้งหลังสุด
     ขีดคร่อมคือช่วงที่เคยแกว่งจริง (ต่ำสุด-สูงสุด) ไม่ใช่ช่วงความเชื่อมั่นทางสถิติ
     ต้องเขียนกำกับบนหน้าจอแบบนั้นด้วย */
  est as (
    select f.day,
           round(avg(h.stops))::int as stops,
           min(h.stops)::int as low,
           max(h.stops)::int as high,
           count(h.stops)::int as samples
      from future f
      left join hist_day h
        on extract(dow from h.day) = extract(dow from f.day)
     group by f.day
  ),
  /* กำลังรับงานสูงสุด = รถที่ใช้ได้ x จุดเฉลี่ยต่อคันต่อวันของ 28 วันล่าสุด
     จำกัดด้วยจำนวนคนขับที่มีด้วย รถไม่มีคนขับก็วิ่งไม่ได้ */
  fleet as (
    select (select count(*) from public.vehicles
             where status in ('available', 'on_trip')) as vehicles,
           (select count(*) from public.drivers
             where status in ('available', 'on_trip')) as drivers
  ),
  per_vehicle as (
    select case when count(distinct h.day) = 0 then 0
                else count(*)::numeric
                     / count(distinct h.day)
                     / greatest((select vehicles from fleet), 1)
           end as stops_per_day
      from hist_stop h
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to, 'today', v_today),

    /* ไทล์หลัก — ความคืบหน้าของวันสุดท้ายในช่วง (ปกติคือวันนี้) */
    'progress', (
      select jsonb_build_object(
               'stops_done',      count(*) filter (where pending = 0 and not cancelled),
               'stops_total',     count(*) filter (where not cancelled),
               'stops_cancelled', count(*) filter (where cancelled)
             )
        from stop_day where day = v_to
    ),

    'kpis', jsonb_build_object(
      /* จบครบภายในวัน — เทียบวัน ไม่ใช่เวลา จุดที่ยกเลิกไม่นับทั้งเศษและส่วน
         เพราะไม่ใช่งานที่ทำพลาด สาเหตุไปอยู่ที่ cancel_reasons */
      'same_day', (
        select case when count(*) filter (where not cancelled) = 0 then null
               else jsonb_build_object(
                 'pct',  round(100.0 * count(*) filter (where done_in_day)
                               / count(*) filter (where not cancelled), 1),
                 'base', count(*) filter (where not cancelled))
               end
          from stop_day
      ),
      /* จุดต่อเที่ยว — ตัวที่ทำให้ค่าเหมาคุ้มหรือไม่คุ้ม ยิ่งกวาดได้มาก ยิ่งถูกต่อจุด */
      'stops_per_trip', (
        select case when count(*) = 0 then null
               else jsonb_build_object(
                 'value', round(avg(stops), 2),
                 'trips', count(*))
               end
          from trip_stop where stops > 0
      ),
      'cost_per_stop', case when not v_money then null else (
        select case when coalesce(sum(stops) filter (where freight is not null), 0) = 0
                    then null
               else jsonb_build_object(
                 'value', round(sum(freight) filter (where freight is not null)
                                / sum(stops) filter (where freight is not null)),
                 'coverage_pct', round(100.0 * count(*) filter (where freight is not null)
                                       / nullif(count(*), 0)),
                 'trips', count(*) filter (where freight is not null))
               end
          from trip_stop where stops > 0
      ) end,
      /* ส่วนต่างสัญญากับที่ปิดจริง — ไม่ต้องพึ่งใครกรอก นับเฉพาะเที่ยวที่มีครบสองค่า
         เพราะ null คือ "ยังไม่ปิดตัวเลข" ถ้านับเป็นศูนย์ ส่วนต่างจะเด้งตาม
         ความขยันของคนปิดงาน ไม่ใช่ตามของจริง */
      'cost_variance', case when not v_money then null else (
        select case when count(*) = 0 then null
               else jsonb_build_object(
                 'total',    round(sum(freight_actual_cost - freight_cost)),
                 'per_trip', round(avg(freight_actual_cost - freight_cost)),
                 'coverage_pct', round(100.0 * count(*)
                                       / nullif((select count(*) from trip_stop), 0)),
                 'trips', count(*))
               end
          from trip_stop
         where freight_cost is not null and freight_actual_cost is not null
      ) end
    ),

    /* แผนภูมิเดียวคร่อมอดีตกับอนาคต เส้นแบ่ง "วันนี้" อยู่ตรงกลาง
       แยกสีตามความมั่นใจของข้อมูล ไม่ใช่ตามค่า */
    'chart', jsonb_build_object(
      'actual', coalesce((
        select jsonb_agg(jsonb_build_object('day', day, 'stops', stops) order by day)
          from hist_day
         where day between greatest(v_from, v_today - 27) and least(v_to, v_today)
      ), '[]'::jsonb),
      'planned', coalesce((
        select jsonb_agg(jsonb_build_object('day', day, 'stops', stops) order by day)
          from planned
      ), '[]'::jsonb),
      'estimate', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'day', day, 'stops', stops,
                 'low', low, 'high', high, 'samples', samples) order by day)
          from est where stops is not null
      ), '[]'::jsonb)
    ),

    /* เส้นแดงบนแผนภูมิ */
    'capacity', (
      select jsonb_build_object(
               'vehicles', f.vehicles,
               'drivers',  f.drivers,
               'stops_per_vehicle_day', round(p.stops_per_day, 2),
               'max_stops_per_day', round(least(f.vehicles, f.drivers) * p.stops_per_day)
             )
        from fleet f, per_vehicle p
    ),

    /* แผงสาเหตุ — ใช้ค่าที่มีจริงใน CANCEL_STOP_REASONS ไม่ใช่หมวดที่คิดเอง
       ได้ของแถมคือทุกแถวมีเจ้าของชัด ร้านปิด = ฝ่ายขาย ของไม่ครบ = คลัง */
    'cancel_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason', reason, 'orders', n) order by n desc)
        from (select coalesce(nullif(trim(cancel_reason), ''), 'ไม่ระบุ') as reason,
                     count(*) as n
                from ord where status = 'cancelled'
               group by 1) r
    ), '[]'::jsonb)
  )
  into v_out;

  return v_out;
end;
$fn$;

comment on function public.ops_overview(date, date) is
  'สรุปหน้าภาพรวมทั้งหน้าในการเรียกครั้งเดียว - นับจุดส่งด้วยกติกาเดียวกับ groupStops';

/* ปิดตามกฎที่เสียค่าโง่มาแล้ว: revoke from public อย่างเดียวไม่พอ
   Supabase ให้สิทธิ์ anon กับ authenticated ตรงตัวผ่าน default privileges
   ไม่ได้ผ่าน PUBLIC ต้องเพิกถอนทั้งสามแล้วค่อยให้คืนเฉพาะคนที่ล็อกอินแล้ว */
revoke all on function public.ops_overview(date, date) from public, anon, authenticated;
grant execute on function public.ops_overview(date, date) to authenticated;
revoke all on function app.stop_key(bigint, text)  from public, anon, authenticated;
revoke all on function app.norm_txt(text)              from public, anon, authenticated;
