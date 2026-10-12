-- กันคนที่ไม่ใช่ admin แตะบัญชี admin ผ่านการแก้ตาราง users ตรง ๆ
--
-- policy users_manage_update ให้ใครก็ได้ที่ถือ users.manage แก้ทุกแถว รวมช่อง role
-- create_app_user กันการสร้าง admin ไว้แล้ว แต่ UPDATE ตรงข้ามด่านนั้นได้:
-- คนที่ได้ users.manage (เช่นตั้งรายคนให้ viewer) เลื่อนตัวเองเป็น admin หรือปิดบัญชี admin ได้
--
-- auth.uid() ว่าง = service_role / Edge Function / migration — ตัวเรียกพวกนั้นตรวจ admin เองแล้ว ปล่อยผ่าน

create or replace function public.guard_admin_accounts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role user_role;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  select role into v_actor_role from public.users where auth_id = auth.uid() and is_active;
  if v_actor_role = 'admin' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.role = 'admin' then
      raise exception 'มีแต่ผู้ดูแลระบบที่ลบบัญชีผู้ดูแลได้' using errcode = '42501';
    end if;
    return old;
  end if;

  if (old.role is distinct from new.role and 'admin' in (old.role, new.role))
     or (old.role = 'admin' and (old.is_active is distinct from new.is_active
                                 or old.auth_id is distinct from new.auth_id
                                 or old.username is distinct from new.username)) then
    raise exception 'มีแต่ผู้ดูแลระบบที่เปลี่ยนสิทธิ์หรือบัญชีของผู้ดูแลได้' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_admin_accounts() from public, anon, authenticated;

drop trigger if exists users_guard_admin on public.users;
create trigger users_guard_admin
  before update or delete on public.users
  for each row execute function public.guard_admin_accounts();
