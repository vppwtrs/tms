import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})
const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const caller = (authorization: string) => createClient(
  Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
  { global: { headers: { Authorization: authorization } }, auth: { autoRefreshToken: false, persistSession: false } },
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization) return json({ error: 'ต้องเข้าสู่ระบบก่อน' }, 401)
  try {
    const asCaller = caller(authorization)
    const { data: me } = await asCaller.auth.getUser()
    const { data: actor } = me.user ? await asCaller.from('users').select('role').eq('auth_id', me.user.id).maybeSingle() : { data: null }
    if (actor?.role !== 'admin') return json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' }, 403)

    const body = await req.json().catch(() => ({})) as { user_id?: number }
    if (!body.user_id) return json({ error: 'ต้องระบุผู้ใช้' }, 400)
    const sb = admin()
    const { data: target } = await sb.from('users').select('id, auth_id, username').eq('id', body.user_id).maybeSingle()
    if (!target) return json({ error: 'ไม่พบผู้ใช้นี้' }, 404)
    if (!target.auth_id) {
      const { error } = await sb.from('users').delete().eq('id', target.id)
      if (error) return json({ error: 'ลบข้อมูลผู้ใช้ไม่สำเร็จ' }, 500)
      return json({ ok: true })
    }

    const { data: me } = await asCaller.auth.getUser()
    if (me.user?.id === target.auth_id) return json({ error: 'ไม่อนุญาตให้ลบบัญชีที่กำลังใช้งานอยู่' }, 400)

    /* ล้างโปรไฟล์/สิทธิ์ที่เป็นของบัญชี แต่คงประวัติธุรกิจไว้ */
    await sb.from('user_permissions').delete().eq('user_id', target.id)
    await sb.from('drivers').update({ user_id: null }).eq('user_id', target.id)
    const { error: authError } = await sb.auth.admin.deleteUser(target.auth_id)
    if (authError) return json({ error: 'ลบบัญชี Auth ไม่สำเร็จ' }, 500)
    const { error: rowError } = await sb.from('users').delete().eq('id', target.id)
    if (rowError) return json({ error: 'ลบข้อมูลผู้ใช้ไม่สำเร็จ กรุณาตรวจ public.users' }, 500)
    return json({ ok: true })
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'unknown')
    return json({ error: 'เกิดข้อผิดพลาดภายใน' }, 500)
  }
})
