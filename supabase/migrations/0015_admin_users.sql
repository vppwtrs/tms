/* 0015 — admin สร้างบัญชีผู้ใช้จากหน้าเว็บได้
 *
 * แบ่งงานเป็นสองฝั่งชัด ๆ อย่ายุบรวม:
 *   ฝั่ง auth (สร้างบัญชี / ตั้งรหัส)  ต้องใช้ service_role -> อยู่ใน Edge Function เท่านั้น
 *   ฝั่งข้อมูล (users / drivers / สิทธิ์) อยู่ในไฟล์นี้ ตรวจสิทธิ์ด้วย token ของคนที่กดจริง
 *
 * ทำไมต้องตรวจสองรอบ (ฟังก์ชันตรวจ แล้ว SQL ตรวจอีก):
 * Edge Function ถือ service_role ซึ่งข้าม RLS ทั้งหมด ถ้าตรรกะสิทธิ์อยู่ในนั้นที่เดียว
 * บั๊กบรรทัดเดียวในฟังก์ชัน = ใครก็สร้าง admin ให้ตัวเองได้ การให้ SQL ตรวจซ้ำ
 * ด้วย token ของคนกดจริง ทำให้ service_role ทำได้แค่ "แตะ auth.users" ไม่ใช่ "ทำอะไรก็ได้"
 *
 * ทำไมไม่ให้ admin พิมพ์รหัสให้คนอื่น: รหัสที่คนหนึ่งตั้งให้อีกคนจะถูกส่งต่อทางแชท/ไลน์
 * ซึ่งเป็นทางที่รหัสรั่วบ่อยที่สุด — ฟังก์ชันสุ่มให้ โชว์ครั้งเดียว แล้วไม่เก็บไว้ที่ไหน
 */

/* ===== ถามสิทธิ์ของตัวเองจากหน้าจอ/Edge Function ได้ =====
   `authenticated` ไม่มี usage บน schema app (ตั้งใจ) จึงเรียก app.has_perm ตรง ๆ ไม่ได้
   ตัวนี้เป็นประตูบานเดียวที่เปิดให้ถาม โดยถามได้แค่ "ฉันมีสิทธิ์นี้ไหม" ไม่ใช่ของคนอื่น */
create or replace function public.i_can(p_permission text)
returns boolean
language sql security definer set search_path = public, auth
as $$
  select coalesce(app.has_perm(p_permission), false)
$$;

comment on function public.i_can is
  'ถามสิทธิ์ของ "คนที่ถือ token นี้" เท่านั้น — ถามแทนคนอื่นไม่ได้';

/* ===== สร้างแถวผู้ใช้ (หลังจาก Edge Function สร้างบัญชี auth แล้ว) =====
 *
 * p_auth_id มาจาก sb.auth.admin.createUser() ในฟังก์ชัน
 * ถ้าขั้นนี้ล้ม ฟังก์ชันต้องลบบัญชี auth ที่เพิ่งสร้างทิ้ง ไม่งั้นจะเหลือบัญชีที่ล็อกอินได้
 * แต่ไม่มีตัวตนในระบบ (อาการ: เข้าได้แต่ไม่เห็นอะไรเลย ซึ่งหาสาเหตุยากที่สุด)
 *
 * บัญชีที่ admin สร้างเองเป็น is_active = true ทันที — ต่างจากบัญชีที่เกิดจากการล็อกอิน TMS
 * ครั้งแรก (0010) ที่ต้องรออนุมัติ เพราะกรณีนี้คนที่มีสิทธิ์เป็นคนกดสร้างเองอยู่แล้ว
 */
create or replace function public.create_app_user(
  p_auth_id   uuid,
  p_username  text,
  p_name      text,
  p_role      user_role,
  p_as_driver boolean default false,
  p_phone     text default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_id     bigint;
  v_drv    bigint;
  v_myrole user_role;
begin
  if not app.has_perm('users.manage') then
    raise exception 'ไม่มีสิทธิ์จัดการผู้ใช้' using errcode = '42501';
  end if;

  if coalesce(trim(p_username), '') = '' or coalesce(trim(p_name), '') = '' then
    raise exception 'ต้องมีชื่อผู้ใช้และชื่อ-นามสกุล' using errcode = 'P0001';
  end if;

  /* **คนที่ไม่ใช่ admin สร้าง admin ไม่ได้** สิทธิ์ users.manage ให้ผู้วางแผนงานก็ได้
     ถ้าไม่กันข้อนี้ คนที่ได้สิทธิ์จัดการผู้ใช้จะยกตัวเองเป็น admin ได้ผ่านการสร้างบัญชีที่สอง */
  select role into v_myrole from public.users where id = app.current_user_id();
  if p_role = 'admin' and v_myrole <> 'admin' then
    raise exception 'มีแต่ผู้ดูแลระบบที่สร้างบัญชีผู้ดูแลได้' using errcode = '42501';
  end if;

  insert into public.users (auth_id, username, name, role, is_active, auth_source)
  values (p_auth_id, trim(p_username), trim(p_name), p_role, true, 'local')
  returning id into v_id;

  /* คนขับต้องมีแถวใน drivers และแถวนั้นต้องผูก user_id
     ไม่ผูก = ล็อกอินได้แต่หน้างานว่างเปล่า เพราะ RLS ฝั่งคนขับแขวนอยู่กับ drivers.user_id
     ผูกให้ตรงนี้เลยจึงไม่ต้องหวังว่าจะมีคนจำไปกดผูกทีหลัง */
  if p_as_driver or p_role = 'driver' then
    select id into v_drv from public.drivers where user_id = v_id;
    if v_drv is null then
      insert into public.drivers (name, phone, user_id)
      values (trim(p_name), nullif(trim(coalesce(p_phone, '')), ''), v_id)
      returning id into v_drv;
    end if;
  end if;

  return json_build_object('user_id', v_id, 'driver_id', v_drv);
end;
$$;

/* ===== ผูกบัญชี auth ที่มีอยู่แล้วเข้ากับคนขับที่ถูกสร้างจาก TMS =====
   คนขับที่เกิดจาก create_driver_from_tms (0013) ไม่มี user_id จึงยังเข้าแอปไม่ได้
   ตัวนี้ให้ Edge Function เรียกต่อ หลังสร้างบัญชี auth ให้คนขับที่มีอยู่แล้ว */
create or replace function public.attach_user_to_driver(p_user_id bigint, p_driver_id bigint)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_taken bigint;
begin
  if not app.has_perm('users.manage') then
    raise exception 'ไม่มีสิทธิ์จัดการผู้ใช้' using errcode = '42501';
  end if;

  /* คนขับหนึ่งคน = บัญชีหนึ่งบัญชี ถ้าปล่อยให้ผูกซ้ำ สองคนจะเห็นงานของกันและกัน
     ซึ่งขัดกับกฎข้อแรกของฝั่งคนขับ (เห็นเฉพาะเที่ยวของตัวเอง) */
  select user_id into v_taken from public.drivers where id = p_driver_id;
  if v_taken is not null and v_taken <> p_user_id then
    raise exception 'พนักงานขับคนนี้ผูกกับบัญชีอื่นอยู่แล้ว' using errcode = 'P0001';
  end if;

  update public.drivers set user_id = p_user_id where id = p_driver_id;
  return json_build_object('driver_id', p_driver_id, 'user_id', p_user_id);
end;
$$;

/* ===== รายชื่อคนขับที่ยังไม่มีบัญชีเข้าแอป =====
   หน้าผู้ใช้ต้องตอบคำถามนี้ได้ ไม่งั้นคนขับที่ระบบสร้างจาก TMS จะค้างอยู่แบบ
   "มีชื่อในระบบแต่เข้าแอปไม่ได้" โดยไม่มีใครเห็นว่ามีอยู่ */
create or replace function public.drivers_without_account()
returns json
language sql security definer set search_path = public
as $$
  select coalesce(json_agg(json_build_object('driver_id', d.id, 'name', d.name, 'phone', d.phone)
                           order by d.name), '[]'::json)
    from public.drivers d
   where d.user_id is null
     and app.has_perm('users.manage')
$$;

revoke execute on function public.i_can, public.create_app_user,
  public.attach_user_to_driver, public.drivers_without_account from public;
grant execute on function public.i_can, public.create_app_user,
  public.attach_user_to_driver, public.drivers_without_account to authenticated;
