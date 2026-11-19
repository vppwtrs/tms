-- พิกัดจุดเช็ก (one-shot GPS) + การพัก + เติมน้ำมัน ของคนขับ
-- คนขับ insert/select ได้เฉพาะเที่ยวที่ตัวเองอยู่ใน trip_drivers; ฝั่ง ops อ่านด้วย dispatch.view
-- แอปส่ง trip_id เป็น string — PostgREST แปลงเป็น bigint ให้เอง

create table if not exists public.trip_checkpoints (
  id          bigint generated always as identity primary key,
  trip_id     bigint not null references public.trips (id) on delete cascade,
  driver_id   bigint references public.drivers (id) on delete set null default app.current_driver_id(),
  kind        text not null check (kind in ('trip_start','arrive','delivered','break_start','break_end','fuel','trip_end','issue')),
  lat         double precision,
  lng         double precision,
  accuracy_m  integer,
  recorded_at timestamptz not null default now(),
  extra       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists trip_checkpoints_trip_idx on public.trip_checkpoints (trip_id, recorded_at);

create table if not exists public.trip_breaks (
  id         bigint generated always as identity primary key,
  trip_id    bigint not null references public.trips (id) on delete cascade,
  driver_id  bigint references public.drivers (id) on delete set null default app.current_driver_id(),
  reason     text not null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists trip_breaks_trip_idx on public.trip_breaks (trip_id);

create table if not exists public.trip_fuel_logs (
  id            bigint generated always as identity primary key,
  trip_id       bigint not null references public.trips (id) on delete cascade,
  driver_id     bigint references public.drivers (id) on delete set null default app.current_driver_id(),
  liters        numeric(8,2) not null check (liters > 0),
  amount_baht   numeric(10,2) not null check (amount_baht >= 0),
  odometer_km   integer check (odometer_km >= 0),
  receipt_path  text,
  receipt_paths text[] not null default '{}',
  lat           double precision,
  lng           double precision,
  recorded_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists trip_fuel_logs_trip_idx on public.trip_fuel_logs (trip_id);

do $$
declare t text;
begin
  foreach t in array array['trip_checkpoints','trip_breaks','trip_fuel_logs'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select using (
        app.has_perm('dispatch.view')
        or exists (select 1 from public.trip_drivers td
                   where td.trip_id = %I.trip_id and td.driver_id = app.current_driver_id())
      )$p$, t || '_select', t, t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($p$create policy %I on public.%I for insert with check (
        exists (select 1 from public.trip_drivers td
                where td.trip_id = %I.trip_id and td.driver_id = app.current_driver_id())
      )$p$, t || '_insert', t, t);
  end loop;
end $$;

-- ปิดการพัก: คนขับ update ended_at ของแถวตัวเองได้
drop policy if exists trip_breaks_update on public.trip_breaks;
create policy trip_breaks_update on public.trip_breaks for update
  using (driver_id = app.current_driver_id())
  with check (driver_id = app.current_driver_id());

grant select, insert on public.trip_checkpoints, public.trip_breaks, public.trip_fuel_logs to authenticated;
grant update (ended_at) on public.trip_breaks to authenticated;

-- รูประดับเที่ยว (ใบเสร็จน้ำมัน / หน้าปัดเลขไมล์ / แจ้งปัญหา) ขึ้น R2 ผ่าน Edge Function pod-photo-upload
-- key = <fuel|odometer|issue>/<trip_id>/<uuid>.<ext> เก็บ path ลง trip_checkpoints.extra
-- ด่านสิทธิ์: คนขับที่อยู่ใน trip_drivers ของเที่ยวนั้น (เงื่อนไขเดียวกับ insert policy ข้างบน)
create or replace function public.trip_photo_can_write(p_trip_id bigint)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.trip_drivers td
    where td.trip_id = p_trip_id and td.driver_id = app.current_driver_id()
  )
$$;
revoke all on function public.trip_photo_can_write(bigint) from public;
grant execute on function public.trip_photo_can_write(bigint) to authenticated;
