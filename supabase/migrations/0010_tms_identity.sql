/* 0010 — ตัวตนของพนักงานออฟฟิศมาจากการล็อกอิน TMS บริษัท
 *
 * แนวคิด: ถ้าล็อกอิน TMS ผ่าน = เป็นพนักงานจริง ไม่ต้องสร้างบัญชีอีกชุดให้คนจำสองรหัส
 * แต่ "เป็นพนักงานจริง" ยังไม่เท่ากับ "ควรเห็นข้อมูลลูกค้าทุกราย"
 * บัญชีที่เกิดจากการล็อกอินครั้งแรกจึงเป็น is_active = false และไม่มีสิทธิ์อะไรเลย
 * จนกว่า admin จะอนุมัติ
 *
 * ที่ใช้ is_active เดิมแทนการเพิ่มคอลัมน์ status ใหม่ เพราะ app.current_user_id()
 * กรอง is_active อยู่แล้ว -> บัญชีรออนุมัติจึงไม่มีตัวตนในสายตา RLS ทุก policy
 * โดยไม่ต้องแก้ policy สักตัว
 *
 * ผลข้างเคียงที่ต้องแก้: คนรออนุมัติอ่านแม้แต่แถวตัวเองไม่ได้ (policy ใช้ current_user_id)
 * หน้าจอเลยไม่มีทางบอกได้ว่า "รออนุมัติอยู่" กับ "ล็อกอินพัง" ต่างกันยังไง
 * -> my_account() อ่านจาก auth.uid() ตรง ๆ ข้าม is_active
 *
 * คนขับไม่เกี่ยวกับ TMS เลย — ยังใช้อีเมล/รหัสผ่านของ Supabase เหมือนเดิม
 */

alter table public.users
  add column auth_source text not null default 'local'
    constraint users_auth_source_check check (auth_source in ('local', 'tms')),
  add column approved_at timestamptz,
  add column approved_by bigint references public.users (id),
  add column last_login_at timestamptz;

comment on column public.users.auth_source is
  'local = อีเมล/รหัสผ่านของ Supabase (คนขับ, admin คนแรก) · tms = ยืนยันตัวผ่าน TMS บริษัท';

/* admin คนแรกที่สร้างด้วยมือไว้แล้ว ถือว่าอนุมัติตัวเองมาตั้งแต่ต้น */
update public.users set approved_at = created_at where is_active;

/* ===== ฉันเป็นใคร =====
   ตัวเดียวในระบบที่ตอบได้แม้บัญชียังไม่ถูกอนุมัติ — หน้า login ใช้แยกสามกรณี:
   ไม่มีบัญชี / มีแต่รออนุมัติ / ใช้งานได้ */
create or replace function public.my_account()
returns json
language sql stable security definer set search_path = public, auth
as $$
  select coalesce(
    (select json_build_object(
       'found',     true,
       'user_id',   u.id,
       'name',      u.name,
       'username',  u.username,
       'role',      u.role,
       'is_active', u.is_active,
       'source',    u.auth_source
     )
     from public.users u where u.auth_id = auth.uid()),
    json_build_object('found', false)
  )
$$;

revoke execute on function public.my_account from public;
grant execute on function public.my_account to authenticated;

/* ===== อนุมัติพนักงาน =====
   แยกเป็นฟังก์ชันแทนที่จะให้ admin update ตรง ๆ เพราะสองอย่างต้องเกิดพร้อมกันเสมอ:
   เปิดใช้งาน + กำหนดบทบาท  ถ้าเปิดใช้งานก่อนแล้วลืมตั้งบทบาท คนนั้นจะได้ 'viewer'
   ตาม default ของคอลัมน์ ซึ่งเป็นการให้สิทธิ์โดยไม่มีใครตั้งใจ */
create or replace function public.approve_user(p_user_id bigint, p_role user_role)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_me bigint := app.current_user_id();
  v_u  public.users;
begin
  if not app.has_perm('users.manage') then
    raise exception 'ไม่มีสิทธิ์อนุมัติผู้ใช้' using errcode = '42501';
  end if;

  /* กันเผลอ: บทบาท driver ต้องมีแถวใน drivers ถึงจะใช้งานได้จริง
     อนุมัติพนักงานออฟฟิศให้เป็น driver = คนนั้นล็อกอินได้แต่เมนูว่างเปล่า */
  if p_role = 'driver' then
    raise exception 'บัญชีคนขับต้องสร้างจากหน้าพนักงานขับรถ ไม่ใช่จากการอนุมัติ'
      using errcode = '22023';
  end if;

  update public.users
     set role = p_role, is_active = true,
         approved_at = now(), approved_by = v_me
   where id = p_user_id
  returning * into v_u;

  if v_u.id is null then
    raise exception 'ไม่พบผู้ใช้' using errcode = 'P0002';
  end if;

  return json_build_object('user_id', v_u.id, 'name', v_u.name, 'role', v_u.role);
end;
$$;

/* ปฏิเสธ/ระงับ — ไม่ลบแถวทิ้ง เพราะ orders.created_by ฯลฯ อ้างถึงอยู่
   และถ้าลบ พอคนเดิมล็อกอิน TMS อีกครั้ง บัญชีก็จะเกิดใหม่วนไปเรื่อย ๆ */
create or replace function public.revoke_user(p_user_id bigint)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_me bigint := app.current_user_id();
begin
  if not app.has_perm('users.manage') then
    raise exception 'ไม่มีสิทธิ์ระงับผู้ใช้' using errcode = '42501';
  end if;
  if p_user_id = v_me then
    raise exception 'ระงับบัญชีตัวเองไม่ได้' using errcode = '22023';
  end if;

  update public.users set is_active = false where id = p_user_id;
  return json_build_object('user_id', p_user_id, 'is_active', false);
end;
$$;

revoke execute on function public.approve_user, public.revoke_user from public;
grant execute on function public.approve_user, public.revoke_user to authenticated;
