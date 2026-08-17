import { createClient } from 'jsr:@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
const client = (auth: string) => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { autoRefreshToken: false, persistSession: false } })
const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ error: 'ต้องเข้าสู่ระบบก่อน' }, 401)
  try {
    const caller = client(auth)
    const { data: me } = await caller.auth.getUser()
    if (!me.user) return json({ error: 'เซสชันไม่ถูกต้อง' }, 401)
    const { data: actor } = await caller.from('users').select('role').eq('auth_id', me.user.id).maybeSingle()
    if (actor?.role !== 'admin') return json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยนกลุ่มสิทธิ์ได้' }, 403)
    const body = await req.json().catch(() => ({})) as { user_id?: number; role?: string }
    if (!body.user_id || !['admin', 'dispatcher', 'viewer', 'driver'].includes(body.role ?? '')) return json({ error: 'ข้อมูลกลุ่มสิทธิ์ไม่ถูกต้อง' }, 400)
    const { error } = await admin().from('users').update({ role: body.role }).eq('id', body.user_id)
    if (error) return json({ error: 'เปลี่ยนกลุ่มสิทธิ์ไม่สำเร็จ' }, 500)
    return json({ ok: true })
  } catch { return json({ error: 'เกิดข้อผิดพลาดภายใน' }, 500) }
})
