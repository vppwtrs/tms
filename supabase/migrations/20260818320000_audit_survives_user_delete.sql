-- ลบบัญชีถาวรล้มทุกครั้งด้วย 500 — ตัวที่กันไว้คือ log ของการลบเอง
--
-- ทริกเกอร์ users_security_audit เป็น AFTER DELETE แล้วเขียนแถว log ด้วย
-- target_user_id = old.id ซึ่งตอนนั้นแถวใน public.users ถูกลบไปแล้ว
-- FK permission_audit_log_target_user_id_fkey จึงตีกลับ ทั้งธุรกรรมถูกม้วนกลับ
-- อาการที่หน้าเว็บคือกดลบแล้วหมุน จบแล้วทุกอย่างเหมือนเดิม
--
-- แก้ที่ตัว log: การลบบัญชีไม่มีบัญชีให้ชี้อยู่แล้วโดยธรรมชาติ เก็บ target เป็น null
-- แล้วคงตัวตนไว้ในเนื้อ log — ชื่อผู้ใช้อยู่ใน before_value และเลข id อยู่ใน reason
-- ร่องรอยยังครบ ("ใครลบใคร เมื่อไหร่") โดยไม่ต้องพึ่งแถวที่ถูกลบไปแล้ว

create or replace function public.audit_user_security_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_actor_id bigint;
begin
  select id into v_actor_id from public.users where auth_id = auth.uid();
  if tg_op = 'UPDATE' and old.role is distinct from new.role then
    insert into public.permission_audit_log(actor_user_id,target_user_id,action,before_value,after_value)
    values (v_actor_id,new.id,'user_role_changed',old.role::text,new.role::text);
  elsif tg_op = 'UPDATE' and old.is_active is distinct from new.is_active then
    insert into public.permission_audit_log(actor_user_id,target_user_id,action,before_value,after_value)
    values (v_actor_id,new.id,case when new.is_active then 'user_activated' else 'user_revoked' end,old.is_active::text,new.is_active::text);
  elsif tg_op = 'DELETE' then
    insert into public.permission_audit_log(actor_user_id,target_user_id,action,before_value,reason)
    values (v_actor_id,null,'user_deleted',old.username,'user id ' || old.id);
  end if;
  return coalesce(new, old);
end;
$$;

comment on function public.audit_user_security_change() is
  'log การเปลี่ยนบทบาท/สถานะ/การลบบัญชี — กรณีลบเก็บ target เป็น null เพราะแถวปลายทางไม่มีแล้ว';
