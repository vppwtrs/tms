-- บันทึกว่ารอบดึงข้อมูลแต่ละรอบ ใครกด และครอบคลุมคลังไหนบ้าง
--
-- tms-gateway ใช้ token ของคนที่ล็อกอิน แต่ละบัญชี TMS จึงเห็นคลังไม่เท่ากัน
-- คนหนึ่งกดแล้วได้ 8 เที่ยว อีกคนกดได้ 12 แล้วทั้งคู่คิดว่าเห็นครบ
-- ไม่ได้แยกข้อมูลตามคน — งานขนส่งเป็นของบริษัท ไม่ใช่ของคนกดปุ่ม
-- สิ่งที่ต้องมีคือ "รอบนี้ครอบคลุมแค่ไหน" ให้เห็นบนหน้าจอ
--
-- ต่างจาก tms_sync_log ตรงที่แถวนี้ถูกเขียน **ทุกรอบ** แม้ไม่มีเที่ยวของกองรถเราเลย
-- ซึ่งเป็นกรณีที่ต้องรู้ที่สุด: ดึงแล้วไม่ได้อะไร แปลว่าคลังนั้นไม่ได้ถูกครอบคลุมจริง
-- ส่วน tms_sync_log เขียนเฉพาะตอนมีของ push จริง จึงตอบคำถามนี้ไม่ได้

create table if not exists public.tms_pull_runs (
  id           bigserial primary key,
  ran_at       timestamptz not null default now(),
  /* ลบบัญชีแล้วประวัติต้องไม่หายและต้องไม่บล็อกการลบ (ดู 20260818300000) */
  ran_by       bigint references public.users(id) on delete set null,
  ran_by_name  text,
  mode         text not null check (mode in ('poll', 'range')),
  date_from    date not null,
  date_to      date not null,
  /* รหัสคลังที่รอบนี้ยิงถามจริง ไม่ใช่รายการที่ตั้งใจจะถาม */
  warehouses   text[] not null default '{}',
  trips_seen   int not null default 0,
  trips_ours   int not null default 0,
  rows_changed int not null default 0,
  ok           boolean not null default true,
  error        text
);

create index if not exists tms_pull_runs_ran_at_idx on public.tms_pull_runs (ran_at desc);

/* ชื่อคนถูกคัดลอกลงแถวด้วย ไม่ใช่ join อย่างเดียว — ประวัติต้องอ่านออกหลังบัญชีถูกลบ */

alter table public.tms_pull_runs enable row level security;

create policy tms_pull_runs_read on public.tms_pull_runs
  for select to authenticated
  using (app.has_perm('dispatch.view') or app.has_perm('orders.write'));

/* เขียนผ่านฟังก์ชันเท่านั้น ไม่เปิด insert ตรง — ชื่อคนกดต้องมาจาก session
   ไม่ใช่จากสิ่งที่หน้าจอส่งมา */
create or replace function public.log_tms_pull_run(
  p_mode         text,
  p_date_from    date,
  p_date_to      date,
  p_warehouses   text[],
  p_trips_seen   int default 0,
  p_trips_ours   int default 0,
  p_rows_changed int default 0,
  p_ok           boolean default true,
  p_error        text default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user bigint := app.current_user_id();
  v_name text;
  v_id   bigint;
begin
  if not (app.has_perm('orders.write') or app.has_perm('dispatch.write')) then
    raise exception 'ไม่มีสิทธิ์ดึงข้อมูลจาก TMS';
  end if;

  select name into v_name from public.users where id = v_user;

  insert into public.tms_pull_runs (ran_by, ran_by_name, mode, date_from, date_to,
                                    warehouses, trips_seen, trips_ours, rows_changed, ok, error)
  values (v_user, v_name, p_mode, p_date_from, p_date_to,
          coalesce(p_warehouses, '{}'), coalesce(p_trips_seen, 0), coalesce(p_trips_ours, 0),
          coalesce(p_rows_changed, 0), coalesce(p_ok, true), p_error)
  returning id into v_id;

  /* เก็บ 90 วันพอ — นี่เป็นบันทึกไว้ตอบว่า "ตอนนั้นเห็นครบไหม" ไม่ใช่ข้อมูลธุรกิจ
     ล้างแบบสุ่ม 2% เพราะฐานนี้ไม่มี pg_cron (วิธีเดียวกับ trip_locations) */
  if random() < 0.02 then
    delete from public.tms_pull_runs where ran_at < now() - interval '90 days';
  end if;

  return v_id;
end;
$$;

revoke all on function public.log_tms_pull_run(text, date, date, text[], int, int, int, boolean, text) from public;
grant execute on function public.log_tms_pull_run(text, date, date, text[], int, int, int, boolean, text) to authenticated;
grant select on public.tms_pull_runs to authenticated;

/* สรุปความครอบคลุมของ 24 ชั่วโมงล่าสุด — หน้าจอถามคำถามเดียว:
   "วันนี้มีใครดึงบ้าง และรวมกันแล้วครอบคลุมคลังไหน" */
create or replace function public.tms_pull_coverage(p_hours int default 24)
returns json
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_hours int := greatest(coalesce(p_hours, 24), 1);
  v_out   json;
begin
  /* security definer ข้าม RLS ของ tms_pull_runs จึงต้องตรวจสิทธิ์เองตรงนี้
     ไม่ตรวจ = คนขับเรียก RPC ตรงแล้วได้ชื่อคนวางแผนกับรหัสคลังทั้งบริษัท
     คืน null ไม่ raise เพราะการ์ดนี้เป็นข้อมูลเสริม หน้าจอซ่อนไปเฉย ๆ ได้ */
  if not (app.has_perm('dispatch.view') or app.has_perm('orders.write')) then
    return null;
  end if;

  with recent as (
    select * from public.tms_pull_runs
     where ran_at >= now() - make_interval(hours => v_hours)
  )
  select json_build_object(
    'hours', v_hours,
    'runs', (select count(*) from recent),
    'warehouses', (
      select coalesce(json_agg(w order by w), '[]'::json)
        from (select distinct unnest(warehouses) as w from recent) x
    ),
    'people', (
      select coalesce(json_agg(json_build_object(
               'name', p.name, 'runs', p.runs, 'warehouses', p.whs, 'last_at', p.last_at
             ) order by p.last_at desc), '[]'::json)
        from (
          /* unnest ทำให้หนึ่งรอบกลายเป็นหลายแถว จึงต้องนับด้วย distinct id
             ไม่ใช่ count(*) ไม่งั้นคนที่ดึง 2 คลังจะถูกนับเป็นดึงสองรอบ */
          select t.name,
                 count(distinct t.id)::int as runs,
                 array_agg(distinct t.w) filter (where t.w is not null) as whs,
                 max(t.ran_at) as last_at
            from (
              select r.id, r.ran_at,
                     coalesce(r.ran_by_name, 'ไม่ทราบชื่อ') as name,
                     w
                from recent r
                left join lateral unnest(r.warehouses) as w on true
            ) t
           group by t.name
        ) p
    ),
    'last_run', (
      select json_build_object('at', ran_at, 'by', ran_by_name, 'mode', mode,
                               'warehouses', warehouses, 'ok', ok, 'error', error)
        from recent order by ran_at desc limit 1
    )
  ) into v_out;

  return v_out;
end;
$fn$;

revoke all on function public.tms_pull_coverage(int) from public;
grant execute on function public.tms_pull_coverage(int) to authenticated;
