import { createClient } from 'jsr:@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
const caller = (auth: string) => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { autoRefreshToken: false, persistSession: false } })
const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })

const dispatcher = new Set(['customers.view', 'customers.write', 'orders.view', 'orders.write', 'dispatch.view', 'dispatch.write', 'drivers.view', 'drivers.write', 'vehicles.view', 'vehicles.write', 'myjobs.view'])
const driver = new Set(['myjobs.view', 'pod.insert', 'pod.update'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ error: 'ต้องเข้าสู่ระบบก่อน' }, 401)
  try {
    const c = caller(auth)
    const { data: me } = await c.auth.getUser()
    if (!me.user) return json({ error: 'เซสชันไม่ถูกต้อง' }, 401)
    const { data: actor } = await c.from('users').select('role').eq('auth_id', me.user.id).maybeSingle()
    if (actor?.role !== 'admin') return json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' }, 403)

    const sb = admin()
    const { data: catalog, error: catalogError } = await sb.from('permissions').select('permission')
    if (catalogError) return json({ error: 'โหลดรายการสิทธิ์ไม่สำเร็จ' }, 500)
    const all = (catalog ?? []).map((p) => p.permission)
    const presets: Record<string, string[]> = {
      admin: all,
      dispatcher: all.filter((p) => dispatcher.has(p)),
      viewer: all.filter((p) => p.endsWith('.view') || p === 'dashboard.view'),
      driver: all.filter((p) => driver.has(p)),
    }
    for (const [role, permissions] of Object.entries(presets)) {
      await sb.from('role_permissions').delete().eq('role', role)
      if (permissions.length) {
        const { error } = await sb.from('role_permissions').insert(permissions.map((permission) => ({ role, permission })))
        if (error) return json({ error: 'บันทึกกลุ่มสิทธิ์ไม่สำเร็จ' }, 500)
      }
    }
    return json({ ok: true, groups: Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, v.length])) })
  } catch { return json({ error: 'เกิดข้อผิดพลาดภายใน' }, 500) }
})
