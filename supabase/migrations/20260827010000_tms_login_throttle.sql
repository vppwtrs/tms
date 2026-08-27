-- ตัวนับความพยายามล็อกอิน TMS — ปิดรูที่ทำให้ tms-gateway/auth เป็นเครื่องเดารหัส
--
-- เดิม /auth ไม่เช็คอะไรเลยนอกจากมี username กับ password ครบ anon key อยู่ใน
-- bundle ของเว็บซึ่งใครก็หยิบได้ ผลคือคนนอกยิงรหัสเดาใส่บัญชีพนักงานบริษัทได้
-- ไม่จำกัดรอบ ผ่านเซิร์ฟเวอร์ของเรา — log ฝั่งบริษัทเห็นเป็น IP ของ Supabase
-- ไม่ใช่ของคนร้าย เราจึงกลายเป็นผู้ต้องสงสัยและเสี่ยงถูกตัดสิทธิ์เข้า TMS ทั้งระบบ
--
-- ตารางนี้ไม่มีข้อมูลลับ เก็บแค่ "คีย์ + จำนวนครั้ง + เริ่มนับเมื่อไหร่"
-- ไม่เก็บรหัสผ่าน ไม่เก็บ token ตามกฎข้อ 2 ที่หัวไฟล์ tms-gateway

create table if not exists public.tms_login_attempts (
  key          text        primary key,   -- 'ip:1.2.3.4' หรือ 'user:somchai'
  tries        int         not null default 0,
  window_start timestamptz not null default now()
);

-- ไม่มี policy สักอันโดยตั้งใจ — RLS เปิดแล้วไม่มี policy = ปฏิเสธทุกคน
-- เหลือทางเดียวคือ service_role ที่ Edge Function ใช้ ซึ่งข้าม RLS อยู่แล้ว
alter table public.tms_login_attempts enable row level security;

/* นับหนึ่งครั้งแล้วตอบว่าเกินโควตาหรือยัง — ทำในคำสั่งเดียวเพื่อกันการยิงพร้อมกัน
   หลายเส้นแล้วนับหลุด (read-then-write จากฝั่ง Edge Function กันไม่ได้)

   คืน true = ยังยิงต่อได้ / false = เกินแล้ว ให้ตอบ 429

   หน้าต่างเป็นแบบ fixed window ไม่ใช่ sliding — คนร้ายจึงยิงได้ 2 เท่าของโควตา
   ตรงรอยต่อหน้าต่าง ยอมรับได้ เพราะเป้าหมายคือตัดการยิงเป็นหมื่นรอบ
   ไม่ใช่ตัดให้เป๊ะ 5 รอบ และแลกกับความง่ายที่ไม่ต้องเก็บทุกครั้งที่ยิง */
create or replace function public.tms_login_gate(
  p_key    text,
  p_limit  int,
  p_window interval
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tries int;
begin
  insert into public.tms_login_attempts as a (key, tries, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set tries        = case when a.window_start < now() - p_window then 1 else a.tries + 1 end,
        window_start = case when a.window_start < now() - p_window then now() else a.window_start end
  returning a.tries into v_tries;

  return v_tries <= p_limit;
end;
$$;

/* ไม่มีหน้าจอไหนเรียกตัวนี้ มีแต่ Edge Function ที่ใช้ service_role
   ถอนจาก public ตรงนี้จึงไม่ตกไปโดน authenticated ที่หน้าเว็บใช้จริง */
revoke all on function public.tms_login_gate(text, int, interval) from public;
grant execute on function public.tms_login_gate(text, int, interval) to service_role;

/* เก็บกวาดแถวเก่า — ไม่มีใครไล่ลบ ตารางจะโตตาม IP ที่เคยแวะมาตลอดกาล
   เรียกจาก Edge Function แบบสุ่มเจอ ไม่ต้องตั้ง cron ให้เพิ่มของที่ต้องดูแล */
create or replace function public.tms_login_sweep()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.tms_login_attempts where window_start < now() - interval '1 day';
$$;

revoke all on function public.tms_login_sweep() from public;
grant execute on function public.tms_login_sweep() to service_role;
