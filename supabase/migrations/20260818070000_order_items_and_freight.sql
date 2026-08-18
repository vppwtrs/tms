-- เก็บรายการของในใบ PL และค่าขนส่งของเที่ยว
--
-- ทั้งสองอย่างถูกดูดจาก TMS มาครบแล้ว แต่หายไปตอนแปลงเป็นงานของระบบเรา:
--  * รหัสสินค้า — import_tms_trip รวบของทั้งใบด้วย
--    string_agg(distinct coalesce(item_name, item_no)) กลายเป็นข้อความก้อนเดียว
--    coalesce ใช้ "ชื่อ" ก่อนเสมอ รหัสจึงโผล่เฉพาะ 8 แถวจาก 1,708 ที่ไม่มีชื่อ
--    และจำนวนต่อรายการหายหมด เหลือแต่ยอดรวมทั้งใบ — เช็คของครบไม่ได้
--  * ค่าขนส่ง — trips มีแต่ fuel_cost / toll_cost / other_cost
--    ไม่มีช่องค่าจ้างขนส่ง ตัวเลขจาก TMS จึงไม่มีที่ลง

-- 1) ค่าจ้างขนส่งของเที่ยว
alter table public.trips
  add column if not exists freight_cost numeric(12, 2),
  add column if not exists freight_actual_cost numeric(12, 2);

comment on column public.trips.freight_cost is
  'ค่าจ้างขนส่งตามสัญญา จาก TMS (tms_trips.cost) — null คือยังไม่มีตัวเลข ไม่ใช่ศูนย์บาท';
comment on column public.trips.freight_actual_cost is
  'ค่าจ้างที่ปิดจริงหลังจบงาน จาก TMS (tms_trips.actual_cost)';

-- 2) รายการของในใบ
create table if not exists public.order_items (
  id         bigint generated always as identity primary key,
  order_id   bigint not null references public.orders (id) on delete cascade,
  item_no    text not null,
  item_name  text,
  qty        numeric(12, 2) not null default 0,
  unit       text,
  created_at timestamptz not null default now()
);

/* ใบเดียวกันส่งรหัสเดิมซ้ำได้เมื่อของถูกแยกล็อต — รวมยอดเข้าแถวเดิมแทนที่จะเพิ่มแถว
   ไม่งั้นการนำเข้าซ้ำจะทำให้ยอดบวมขึ้นเรื่อย ๆ โดยไม่มีใครสังเกต */
create unique index if not exists order_items_order_item_uq
  on public.order_items (order_id, item_no);

alter table public.order_items enable row level security;

/* สิทธิ์เดินตามใบสั่งที่มันสังกัด — รายการของไม่ใช่ข้อมูลชั้นความลับแยกต่างหาก
   ใครเห็นใบได้ก็ต้องเห็นว่าในใบมีอะไร */
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
  for select using (app.has_perm('orders.view'));

drop policy if exists order_items_write on public.order_items;
create policy order_items_write on public.order_items
  for all using (app.has_perm('orders.write'))
  with check (app.has_perm('orders.write'));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'order_items'
  ) then
    alter publication supabase_realtime add table public.order_items;
  end if;
end;
$$;
