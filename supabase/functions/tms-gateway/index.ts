/**
 * tms-gateway — ประตูเดียวระหว่างเว็บของเรากับ TMS บริษัท
 *
 * ทำสองอย่าง:
 *   POST /tms-gateway/auth   ยืนยันตัวกับ TMS แล้วออก session ของ Supabase ให้
 *   POST /tms-gateway/call   ส่งต่อคำขออ่านข้อมูลไปยัง TMS (แก้ CORS)
 *
 * ทำไมต้องมีตัวนี้:
 * เบราว์เซอร์ยิงหา pdi.vespiario.net จากโดเมนอื่นไม่ได้ (CORS) เดิมแก้ด้วย server.js
 * บนเครื่องออฟฟิศ ซึ่งบังคับให้ตัวดึงเป็นโปรแกรมแยกตลอดกาล ย้ายตัวกลางมาไว้ตรงนี้
 * แอปจึงเหลือตัวเดียว เปิดจากที่ไหนก็ได้
 *
 * ===== ข้อจำกัดที่ตั้งใจใส่ ห้ามถอด =====
 *
 * 1. อ่านอย่างเดียว — ALLOW คือรายการ path ที่ยิงได้ทั้งหมด ไม่มี endpoint ไหน
 *    ที่เขียนกลับเข้า TMS บริษัท ข้อตกลงกับบริษัทคือ "ไม่แก้ข้อมูลภายใน"
 *    เติม path ใหม่ได้ แต่ต้องเป็น search/report/profile เท่านั้น
 *
 * 2. ไม่เก็บ ไม่ log รหัสผ่าน — รหัสถูกใช้แลก token ครั้งเดียวแล้วหลุดจากหน่วยความจำ
 *    ห้ามใส่ console.log(body) เด็ดขาด log ของ Edge Function เก็บไว้อ่านย้อนหลังได้
 *
 * 3. ยิงได้ที่เดียวคือ TMS_BASE_URL — ไม่รับ URL จาก client
 *    ถ้ารับ ตัวนี้จะกลายเป็น open proxy ให้คนทั้งอินเทอร์เน็ตยิงอะไรก็ได้ผ่านเรา
 *
 * 4. ฟังก์ชันนี้ไม่มีรหัสของบริษัทเก็บไว้เลยสักตัว ต่างจากแผนเดิม (tms-sync)
 *    ที่ต้องเก็บ service account ไว้ใน secret — คนที่ยึด secret ไปได้ ก็ยังล็อกอิน TMS ไม่ได้
 *
 * secret ที่ต้องตั้ง: TMS_BASE_URL เท่านั้น (เช่น https://pdi.vespiario.net/tms-api/api)
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ระบบใส่ให้เองอยู่แล้ว
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const TMS_BASE = Deno.env.get('TMS_BASE_URL') ?? ''

/* path ที่ยอมให้ส่งต่อ — อ่านล้วน ตรวจด้วย regex ไม่ใช่ startsWith
   เพราะ startsWith('/v1/') จะเปิดให้ทั้ง API ผ่านหมด */
const ALLOW: RegExp[] = [
  /^\/personal\/profile$/,
  /^\/personal\/warehouses$/,
  /^\/v1\/warehouses\/search$/,
  /^\/v1\/reports\/actualshipment$/,
  /^\/v1\/pickinglistheaders\/[^/]+\/search$/,
]

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

const admin = () =>
  createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

/* อีเมลปลอมที่ผูกกับ username ของ TMS — Supabase Auth บังคับให้มีอีเมล
   ใช้โดเมน .invalid ตาม RFC 2606 เพื่อให้ชัดว่าส่งเมลไปไม่ถึงแน่นอน
   ไม่ใช้อีเมลจริงจาก TMS เพราะถ้าวันหนึ่งเขาเปลี่ยนอีเมลพนักงาน บัญชีเราจะหลุดจากกัน */
const authEmail = (username: string) =>
  `${username.toLowerCase().replace(/[^a-z0-9._-]/g, '_')}@tms.invalid`

/* รหัสผ่านฝั่ง Supabase ไม่มีใครต้องรู้ รวมทั้งเจ้าตัว — ตั้งใหม่ทุกครั้งที่ล็อกอิน
   แล้วใช้ทันทีในฟังก์ชันนี้ ไม่เคยถูกส่งออกไปไหน
   ผลคือใครขโมยฐาน auth ไปก็ crack ไม่ได้ประโยชน์ เพราะรหัสเปลี่ยนทุกครั้งอยู่แล้ว */
const throwaway = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')

async function handleAuth(req: Request): Promise<Response> {
  const { username, password, tenant } = await req.json().catch(() => ({}))
  if (!username || !password) return json({ error: 'ต้องมี username และ password' }, 400)

  /* ---- 1. ถาม TMS ว่าคนนี้เป็นพนักงานจริงมั้ย ---- */
  let tmsToken: string | null = null
  // ยืนยันแล้วว่า build นี้ใช้ userName แต่เผื่อ build อื่นที่รับ email ไว้ด้วย
  for (const shape of [{ userName: username, password }, { email: username, password }]) {
    const r = await fetch(`${TMS_BASE}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json', tenant: tenant || 'root' },
      body: JSON.stringify(shape),
    })
    if (r.ok) {
      const d = await r.json()
      tmsToken = d.token
      break
    }
    if (r.status === 401) break   // รหัสผิดจริง ไม่ต้องลองรูปแบบอื่น
  }
  if (!tmsToken) return json({ error: 'เข้าสู่ระบบ TMS ไม่สำเร็จ' }, 401)

  /* ---- 2. หา/สร้างบัญชีฝั่งเรา ---- */
  const sb = admin()
  const email = authEmail(username)
  const pw = throwaway()

  // ชื่อจริงเอาจาก TMS ไม่ให้ผู้ใช้พิมพ์เอง — จะได้ตรงกับที่ออฟฟิศเรียกกันจริง
  let displayName = username
  try {
    const p = await fetch(`${TMS_BASE}/personal/profile`, {
      headers: { authorization: `Bearer ${tmsToken}`, accept: 'application/json' },
    })
    if (p.ok) {
      const d = await p.json()
      displayName = [d.firstName, d.lastName].filter(Boolean).join(' ') || d.userName || username
    }
  } catch { /* ชื่อไม่ใช่เรื่องคอขาดบาดตาย */ }

  const { data: existing } = await sb.from('users').select('id, auth_id, is_active, role')
    .eq('username', username).maybeSingle()

  let authId = existing?.auth_id ?? null

  if (authId) {
    // ตั้งรหัสใหม่ทุกครั้ง เพื่อจะ signIn ต่อได้โดยไม่ต้องจำรหัสเดิมไว้ที่ไหน
    const { error } = await sb.auth.admin.updateUserById(authId, { password: pw })
    if (error) return json({ error: 'ออก session ไม่สำเร็จ' }, 500)
  } else {
    const { data: created, error } = await sb.auth.admin.createUser({
      email, password: pw, email_confirm: true,
    })
    if (error || !created.user) return json({ error: 'สร้างบัญชีไม่สำเร็จ' }, 500)
    authId = created.user.id

    if (existing) {
      await sb.from('users').update({ auth_id: authId, auth_source: 'tms' }).eq('id', existing.id)
    } else {
      /* เกิดใหม่แบบยังไม่มีสิทธิ์อะไรเลย — is_active = false ทำให้
         app.current_user_id() คืน null ทุก policy จึงมองไม่เห็นคนนี้
         admin ต้องกดอนุมัติก่อน (approve_user) */
      await sb.from('users').insert({
        auth_id: authId, username, name: displayName,
        role: 'viewer', is_active: false, auth_source: 'tms',
      })
    }
  }

  const { data: session, error: signErr } =
    await sb.auth.signInWithPassword({ email, password: pw })
  if (signErr || !session.session) return json({ error: 'ออก session ไม่สำเร็จ' }, 500)

  await sb.from('users').update({ last_login_at: new Date().toISOString() }).eq('auth_id', authId)

  const { data: me } = await sb.from('users')
    .select('id, name, role, is_active').eq('auth_id', authId).maybeSingle()

  return json({
    session: {
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
    },
    tms_token: tmsToken,
    account: me ?? null,
    pending: !me?.is_active,
  })
}

async function handleCall(req: Request): Promise<Response> {
  const { path, method, body, token } = await req.json().catch(() => ({}))
  if (!token) return json({ error: 'ไม่มี token ของ TMS' }, 401)
  if (typeof path !== 'string' || !ALLOW.some(re => re.test(path))) {
    return json({ error: 'path นี้ไม่อยู่ในรายการที่อนุญาต' }, 403)
  }

  const r = await fetch(TMS_BASE + path, {
    method: method === 'GET' ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })

  const text = await r.text()
  return new Response(text, {
    status: r.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!TMS_BASE) return json({ error: 'ยังไม่ได้ตั้ง TMS_BASE_URL' }, 500)

  const route = new URL(req.url).pathname.split('/').pop()
  try {
    if (route === 'auth') return await handleAuth(req)
    if (route === 'call') return await handleCall(req)
    return json({ error: 'ไม่รู้จัก route นี้' }, 404)
  } catch (e) {
    // ข้อความ error เท่านั้น ห้าม log request body — มีรหัสผ่านอยู่ในนั้น
    console.error(route, e instanceof Error ? e.message : 'unknown')
    return json({ error: 'เกิดข้อผิดพลาดภายใน' }, 500)
  }
})
