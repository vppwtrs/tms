import { createClient } from 'jsr:@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })
const caller = (auth: string) => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { autoRefreshToken: false, persistSession: false } })
const key = '__admin_test_dataset'

type Registry = { customers: number[]; drivers: number[]; vehicles: number[] }
const empty: Registry = { customers: [], drivers: [], vehicles: [] }

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
    const body = await req.json().catch(() => ({})) as { action?: 'seed' | 'clear' }
    const { data: setting } = await sb.from('settings').select('value').eq('key', key).maybeSingle()
    const registry: Registry = setting?.value ? JSON.parse(setting.value) as Registry : empty

    if (body.action === 'seed') {
      const stamp = Date.now()
      const { data: customer, error: customerError } = await sb.from('customers').insert({ name: `[TEST] ลูกค้าทดสอบ ${stamp}`, contact_person: 'ชุดข้อมูลทดสอบ', phone: null, email: null, address: 'ข้อมูลทดสอบเท่านั้น', segment: 'B', tax_id: null, credit_terms: null, tags: 'test-dataset', price_note: null }).select('id').single()
      if (customerError) return json({ error: 'สร้างชุดข้อมูลทดสอบไม่สำเร็จ' }, 500)
      const { data: vehicle, error: vehicleError } = await sb.from('vehicles').insert({ plate_no: `TEST-${String(stamp).slice(-6)}`, brand: 'TEST', model: 'TEST', vehicle_type: 'van', capacity_kg: 100, status: 'inactive' }).select('id').single()
      if (vehicleError) { await sb.from('customers').delete().eq('id', customer.id); return json({ error: 'สร้างชุดข้อมูลทดสอบไม่สำเร็จ' }, 500) }
      const { data: driver, error: driverError } = await sb.from('drivers').insert({ name: `[TEST] คนขับทดสอบ ${stamp}`, phone: null, license_no: null, license_type: null, status: 'off_duty', joined_at: null, user_id: null }).select('id').single()
      if (driverError) { await sb.from('vehicles').delete().eq('id', vehicle.id); await sb.from('customers').delete().eq('id', customer.id); return json({ error: 'สร้างชุดข้อมูลทดสอบไม่สำเร็จ' }, 500) }
      const next = { customers: [...registry.customers, customer.id], drivers: [...registry.drivers, driver.id], vehicles: [...registry.vehicles, vehicle.id] }
      await sb.from('settings').upsert({ key, value: JSON.stringify(next) })
      return json({ ok: true, created: { customers: 1, drivers: 1, vehicles: 1 } })
    }

    if (body.action === 'clear') {
      if (registry.drivers.length) await sb.from('drivers').delete().in('id', registry.drivers)
      if (registry.vehicles.length) await sb.from('vehicles').delete().in('id', registry.vehicles)
      if (registry.customers.length) await sb.from('customers').delete().in('id', registry.customers)
      await sb.from('settings').delete().eq('key', key)
      return json({ ok: true, cleared: registry })
    }
    return json({ error: 'คำสั่งไม่ถูกต้อง' }, 400)
  } catch { return json({ error: 'เกิดข้อผิดพลาดภายใน' }, 500) }
})
