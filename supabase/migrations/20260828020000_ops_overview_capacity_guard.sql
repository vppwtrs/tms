/* เส้น "กำลังรับงาน" ต้องเงียบเมื่อฐานข้อมูลยังบาง
 *
 * เจอตอนยิง ops_overview ใส่ข้อมูลจริงครั้งแรก: 30 วันล่าสุดมี 5 เที่ยว 14 จุด
 * จุดเฉลี่ยต่อคันต่อวันจึงออกมา 0.47 และเส้นแดงตกที่ 3 จุด/วัน ซึ่ง**ต่ำกว่า
 * แท่งประมาณการเกือบทุกวัน** หน้าจอจะขึ้นคำเตือน "เกินกำลังรับงาน" ทุกวัน
 * ทั้งที่ความจริงคือรถว่างทั้งอู่ — เส้นนั้นไม่ได้วัดกำลังรถ มันวัดว่าเดือนที่แล้ว
 * มีงานเข้ามาน้อย
 *
 * คำเตือนที่ดังทุกวันเท่ากับไม่มีคำเตือน วันที่มันดังเพราะเรื่องจริงจะไม่มีใครอ่าน
 *
 * ที่แก้: คืน sample_days กลับไปด้วย ให้หน้าจอเป็นคนตัดสินว่าจะวาดเส้นไหม
 * ไม่ใช่ให้ฐานเดาแทน — เกณฑ์ว่า "กี่วันถึงจะพอ" เป็นเรื่องของการนำเสนอ
 * และจะเปลี่ยนได้โดยไม่ต้องแตะฐานอีก
 */
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
    select count(distinct h.day)::int as sample_days,
           case when count(distinct h.day) = 0 then 0
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

    /* เส้นแดงบนแผนภูมิ — sample_days คือจำนวนวันที่มีงานจริงใน 28 วันล่าสุด
       หน้าจอเป็นคนตัดสินว่าฐานบางเกินจะวาดเส้นไหม */
    'capacity', (
      select jsonb_build_object(
               'vehicles', f.vehicles,
               'drivers',  f.drivers,
               'sample_days', p.sample_days,
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

/* create or replace ไม่ล้าง grant เดิม แต่เขียนซ้ำไว้ให้ไฟล์นี้อ่านจบได้ในตัวเอง
   คนที่มาอ่านทีหลังไม่ต้องไปไล่หาว่าใครเรียกฟังก์ชันนี้ได้บ้างจากอีกไฟล์ */
revoke all on function public.ops_overview(date, date) from public, anon, authenticated;
grant execute on function public.ops_overview(date, date) to authenticated;
