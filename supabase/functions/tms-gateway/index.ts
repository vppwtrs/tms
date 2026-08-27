/**
 * tms-gateway — ประตูเดียวระหว่างเว็บของเรากับ TMS บริษัท
 *
 * ทำสองอย่าง:
 *   POST /tms-gateway/auth   ยืนยันตัวกับ TMS แล้วออก session ของ Supabase ให้
 *   POST /tms-gateway/call   ส่งต่อคำขออ่านข้อมูลไปยัง TMS (แก้ CORS)
 *   POST /tms-gateway/disconnect  ลบการเชื่อมต่อ TMS ของคนที่ล็อกอินอยู่ (ตอนล็อกเอาต์)
 *
 * ทำไมต้องมีตัวนี้:
 * เบราว์เซอร์ยิงหา TMS จากโดเมนอื่นไม่ได้ (CORS) เดิมแก้ด้วย server.js
 * บนเครื่องออฟฟิศ ซึ่งบังคับให้ตัวดึงเป็นโปรแกรมแยกตลอดกาล ย้ายตัวกลางมาไว้ตรงนี้
 * แอปจึงเหลือตัวเดียว เปิดจากที่ไหนก็ได้
 *
 * ===== ข้อจำกัดที่ตั้งใจใส่ ห้ามถอด =====
 *
 * 1. อ่านอย่างเดียว — OPS คือรายการงานที่ยิงได้ทั้งหมด ไม่มีตัวไหน
 *    ที่เขียนกลับเข้า TMS บริษัท ข้อตกลงกับบริษัทคือ "ไม่แก้ข้อมูลภายใน"
 *    เติมงานใหม่ได้ แต่ต้องเป็น search/report/profile เท่านั้น
 *
 * 2. ไม่เก็บ ไม่ log รหัสผ่าน — รหัสถูกใช้แลก token ครั้งเดียวแล้วหลุดจากหน่วยความจำ
 *    ห้ามใส่ console.log(body) เด็ดขาด log ของ Edge Function เก็บไว้อ่านย้อนหลังได้
 *
 * 3. ยิงได้ที่เดียวคือ TMS_BASE_URL — ไม่รับ URL จาก client
 *    ถ้ารับ ตัวนี้จะกลายเป็น open proxy ให้คนทั้งอินเทอร์เน็ตยิงอะไรก็ได้ผ่านเรา
 *
 * 4. ไม่มี "รหัสผ่าน" ของบริษัทเก็บไว้เลยสักตัว ต่างจากแผนเดิม (tms-sync)
 *    ที่ต้องเก็บ service account ไว้ใน secret — คนที่ยึด secret ไปได้ ก็ยังล็อกอิน TMS ไม่ได้
 *
 *    ข้อนี้เคยเขียนว่า "ไม่มีรหัสของบริษัทเก็บไว้เลย" แล้วแก้ถ้อยคำวันที่ 27 ส.ค. 69
 *    ตอนย้าย token ไปเก็บใน public.tms_sessions (ดูข้อ 7) — เหตุผลเต็มอยู่ในไฟล์
 *    migration 20260827020000 สรุปสั้น ๆ คือ token อายุสั้นรายคนไม่ใช่บัญชีกลาง
 *
 * 5. เส้น call ต้องมีตัวตนฝั่งเราที่ยังใช้งานอยู่ (27 ส.ค. 69)
 *    เดิมเช็คแค่ "มี token ของ TMS" ผลคือคนที่ admin กดปิดบัญชีไปแล้ว หรือบัญชีใหม่
 *    ที่ยังไม่ถูกอนุมัติ ยังดูดข้อมูลคลัง/เที่ยว/ใบสั่งของบริษัทได้ต่อจนกว่า token
 *    จะหมดอายุไปเอง ทั้งที่คอมเมนต์ในไฟล์นี้เองเขียนว่าบัญชีใหม่ "ยังไม่มีสิทธิ์อะไร"
 *
 * 6. client ไม่รู้จัก path ของ TMS (27 ส.ค. 69)
 *    เดิม client ส่ง path มาเอง แปลว่า '/v1/tripheaders/{guid}/search' และเพื่อน ๆ
 *    ถูกคอมไพล์ติดไปใน bundle ที่ใครเปิด devtools ก็อ่านได้ว่า API ภายในบริษัท
 *    หน้าตายังไง ตอนนี้ client ส่งแค่ชื่องาน (op) ตัวแปลงอยู่ที่นี่ที่เดียว
 *    ผลพลอยได้: pageSize ย้ายมาฝั่งนี้ client จึงขอเกินโควตาไม่ได้อีก
 *
 * 7. token ของ TMS ไม่เคยเดินทางถึงเบราว์เซอร์ (27 ส.ค. 69)
 *    เดิม /auth คืน token ลงไปให้หน้าเว็บเก็บใน sessionStorage — XSS จุดเดียวในเว็บเรา
 *    เท่ากับ token ที่อ่านข้อมูลภายในบริษัทได้หลุดออกไป ความเสียหายไม่จบที่ระบบเรา
 *    ตอนนี้เก็บใน public.tms_sessions ผูกกับ auth_id เส้น call หยิบเองจากคนที่
 *    ยืนยันตัวแล้ว หน้าเว็บได้รู้แค่ "เชื่อมอยู่ เหลืออีกกี่วินาที"
 *
 * secret ที่ต้องตั้ง: TMS_BASE_URL (เช่น https://host.example/tms-api/api)
 *                     WEB_ORIGINS  โดเมนเว็บเราคั่นด้วย comma (ไม่ตั้ง = ใช้ค่าเริ่มต้นล่าง)
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ระบบใส่ให้เองอยู่แล้ว
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const TMS_BASE = Deno.env.get('TMS_BASE_URL') ?? ''

/* tenant ตรึงไว้ ไม่รับจาก client — เดิมรับมาแล้วยัดใส่ header ตรง ๆ
   ซึ่งเปิดให้คนนอกไล่ยิงหา tenant อื่นของบริษัทผ่านเรา */
const TENANT = Deno.env.get('TMS_TENANT') ?? 'root'

/* ---------- CORS: เฉพาะโดเมนของเรา ----------
   เดิมเป็น '*' ซึ่งแปลว่าเว็บอะไรก็ได้ที่พนักงานเปิดค้างไว้ ยิงเส้น auth ของเรา
   จากเบราว์เซอร์ของเขาเองได้เงียบ ๆ */
const ORIGINS = (Deno.env.get('WEB_ORIGINS') ?? 'https://vppwtrs.github.io')
  .split(',').map(o => o.trim()).filter(Boolean)

/* แอปเนทีฟ (Capacitor) ไม่มีโดเมนจริง ส่ง origin เป็น capacitor:// มา
   ส่วน localhost คือตอน dev */
const originOk = (o: string): boolean =>
  ORIGINS.includes(o) ||
  /^https?:\/\/localhost(:\d+)?$/.test(o) ||
  /^(capacitor|ionic):\/\//.test(o)

const corsFor = (req: Request): Record<string, string> => {
  const o = req.headers.get('origin') ?? ''
  /* ไม่ใช่โดเมนเรา = ไม่ใส่ header ให้เลย เบราว์เซอร์บล็อกเอง
     ไม่ตอบ 403 เพราะคำขอจาก curl ไม่มี origin และไม่ควรถูกกันด้วยเหตุนี้ —
     ตัวกันจริงคือการยืนยันตัวตนข้างล่าง CORS แค่กันเว็บอื่นเรียกแทนผู้ใช้ */
  return {
    ...(originOk(o) ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

/* ---------- รายการงานที่ยิงได้ ----------
   client ส่งชื่อ op กับพารามิเตอร์เท่าที่จำเป็น ตัวสร้าง path กับ body อยู่ที่นี่
   จำนวนต่อหน้าอยู่ที่นี่ด้วย — เดิม client ส่ง pageSize มาเอง ใส่เลขเท่าไหร่ก็ได้ */
interface Op { path: string; method: 'GET' | 'POST'; body?: unknown }

const pageNo = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 && n <= 200 ? Math.floor(n) : 1
}

/* กัน path traversal: รหัสคลังกับ GUID มาจาก TMS ก็จริง แต่เดินผ่าน client มาแล้ว
   จึงต้องถือว่าเป็นของที่คนยิงกำหนดได้ '../' อันเดียวพาไปได้ทั้ง API */
const seg = (v: unknown): string => {
  const s = String(v ?? '')
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) throw new Error('bad segment')
  return encodeURIComponent(s)
}

const OPS: Record<string, (p: Record<string, unknown>) => Op> = {
  /** คลังทั้งหมดที่บัญชีนี้เห็น
   *  ชื่อพารามิเตอร์ต้องเป็น pageNumber/pageSize — เคยส่ง page/keyword ตามที่เดาเอง
   *  แล้วได้ผลว่างแบบไม่มี error ชื่อที่ถูกมาจาก extractor ที่ยิงกับของจริงมาก่อน */
  warehouses: () => ({
    path: '/v1/warehouses/search',
    method: 'POST',
    body: { pageNumber: 1, pageSize: 200 },
  }),

  /** คลังที่ผูกกับตัวบุคคล — หลายบัญชีเป็นค่าว่างทั้งที่เปิดดูได้จริงในหน้า TMS */
  myWarehouses: () => ({ path: '/personal/warehouses', method: 'GET' }),

  /** ใบสั่งของคลังหนึ่ง ทีละหน้า */
  pickingLists: p => ({
    path: `/v1/pickinglistheaders/${seg(p.warehouse)}/search`,
    method: 'POST',
    body: {
      orderBy: ['planDeliveryDate Descending'],
      pageNumber: pageNo(p.page),
      pageSize: 500,
      keyword: null,
    },
  }),

  /** เที่ยวของคลังหนึ่ง — อ้างคลังด้วย GUID ไม่ใช่รหัส ต่างจาก pickingLists ข้างบน */
  trips: p => ({
    path: `/v1/tripheaders/${seg(p.guid)}/search`,
    method: 'POST',
    body: {
      orderBy: ['orderDate Descending'],
      pageNumber: pageNo(p.page),
      pageSize: 200,
      keyword: null,
    },
  }),

  /** ใบของเที่ยวหนึ่งพร้อมรายการสินค้า — เส้น search ส่ง pickingLists มาแบบไม่มี
   *  details จำนวนต่อรุ่นจึงหายทั้งระบบ ต้องถามเส้นนี้ทีละเที่ยวถึงจะได้มา */
  tripPickingList: p => ({
    path: '/v1/tripheaders/pickingList',
    method: 'POST',
    body: { Id: seg(p.id) },
  }),
}

const admin = () =>
  createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

/* อีเมลปลอมที่ผูกกับ username ของ TMS — Supabase Auth บังคับให้มีอีเมล
   ใช้โดเมน .invalid ตาม RFC 2606 เพื่อให้ชัดว่าส่งเมลไปไม่ถึงแน่นอน
   ไม่ใช้อีเมลจริงจาก TMS เพราะถ้าวันหนึ่งเขาเปลี่ยนอีเมลพนักงาน บัญชีเราจะหลุดจากกัน

   แปลงอักขระนอกชุดเป็นรหัสฐานสิบหก ไม่ใช่ยุบเป็นขีดล่างรวด — เดิม 'a-b' กับ 'a_b'
   ได้อีเมลเดียวกัน สองคนจึงใช้บัญชีฝั่งเราร่วมกันโดยไม่มีใครรู้ */
const authEmail = (username: string) =>
  `${username.toLowerCase().replace(/[^a-z0-9._-]/g, c => `-${c.charCodeAt(0).toString(16)}-`)}@tms.invalid`

/* รหัสผ่านฝั่ง Supabase ไม่มีใครต้องรู้ รวมทั้งเจ้าตัว — ตั้งใหม่ทุกครั้งที่ล็อกอิน
   แล้วใช้ทันทีในฟังก์ชันนี้ ไม่เคยถูกส่งออกไปไหน
   ผลคือใครขโมยฐาน auth ไปก็ crack ไม่ได้ประโยชน์ เพราะรหัสเปลี่ยนทุกครั้งอยู่แล้ว */
const throwaway = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')

/* ---------- ที่เก็บ token ของ TMS ----------
   อ่านวันหมดอายุจาก payload ของ JWT ตรง ๆ ไม่ตรวจลายเซ็น — ตรงนี้ไม่ได้ใช้ตัดสิน
   สิทธิ์อะไร แค่อ่านวันหมดอายุที่ TMS ประกาศมาเอง ตัวตัดสินจริงคือ TMS ที่ตอบ 401 */
function tokenExpiry(token: string): Date | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    /* base64url ไม่ใช่ base64 — ต้องแปลง - _ กลับก่อน ไม่งั้น atob โยน error
       กับ token ที่มีอักขระสองตัวนี้ ซึ่งเจอเมื่อไหร่ก็ไม่รู้ */
    const exp = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).exp
    return typeof exp === 'number' ? new Date(exp * 1000) : null
  } catch {
    return null
  }
}

/* ---------- ตัวจำกัดรอบเดารหัส ----------
   นับสองชั้น: ต่อ IP กันคนเดียวไล่ยิงหลายบัญชี ต่อ username กันหลายเครื่องรุมบัญชีเดียว
   โควตาต่อ username ตั้งต่ำกว่า เพราะคนพิมพ์รหัสผิดจริงไม่เกินไม่กี่ครั้ง */
const IP_LIMIT = 30
const USER_LIMIT = 8
const WINDOW = '15 minutes'

async function throttle(sb: ReturnType<typeof admin>, key: string, limit: number): Promise<boolean> {
  const { data, error } = await sb.rpc('tms_login_gate', {
    p_key: key, p_limit: limit, p_window: WINDOW,
  })
  /* ตัวนับล่ม = ปล่อยผ่าน ไม่ใช่ปิดประตู — ถ้าปิด คนทั้งออฟฟิศเข้าระบบไม่ได้เพราะ
     ตารางนับมีปัญหา ซึ่งแลกไม่คุ้มกับการกันคนเดารหัสไม่กี่นาที */
  if (error) return true
  return data !== false
}

const clientIp = (req: Request): string =>
  (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'

const reply = (cors: Record<string, string>) =>
  (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

async function handleAuth(req: Request, cors: Record<string, string>): Promise<Response> {
  const json = reply(cors)

  const { username, password } = await req.json().catch(() => ({}))
  if (!username || !password) return json({ error: 'ต้องมี username และ password' }, 400)
  if (typeof username !== 'string' || username.length > 128) {
    return json({ error: 'username ไม่ถูกต้อง' }, 400)
  }

  const sb = admin()

  /* นับทั้งสองชั้นเสมอ ไม่ลัดออกตอนชั้นแรกเต็ม — ไม่งั้นคนร้ายอ่านได้จากพฤติกรรม
     ว่าโดนกันด้วยชั้นไหน และตัวนับต่อ username ก็จะหยุดเดินตอนที่ต้องการมันที่สุด */
  const okIp = await throttle(sb, `ip:${clientIp(req)}`, IP_LIMIT)
  const okUser = await throttle(sb, `user:${username.toLowerCase()}`, USER_LIMIT)
  if (!okIp || !okUser) {
    return json({ error: 'พยายามเข้าสู่ระบบบ่อยเกินไป — รอสัก 15 นาทีแล้วลองใหม่' }, 429)
  }
  /* เก็บกวาดแถวเก่าแบบสุ่มเจอ ไม่ต้องตั้ง cron ให้มีของต้องคอยดูแลเพิ่มอีกตัว */
  if (Math.random() < 0.01) await sb.rpc('tms_login_sweep')

  /* ---- 1. ถาม TMS ว่าคนนี้เป็นพนักงานจริงมั้ย ----
     ยิงรูปแบบเดียว — เดิมลอง userName แล้วต่อด้วย email ซึ่งคูณโหลดที่ยิงไปหา
     บริษัทเป็นสองเท่าทุกครั้งที่รหัสผิด ยืนยันแล้วว่า build นี้ใช้ userName */
  let tmsToken: string | null = null
  const r = await fetch(`${TMS_BASE}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json', tenant: TENANT },
    body: JSON.stringify({ userName: username, password }),
  })
  if (r.ok) tmsToken = (await r.json()).token
  if (!tmsToken) return json({ error: 'เข้าสู่ระบบ TMS ไม่สำเร็จ' }, 401)

  /* ---- 2. หา/สร้างบัญชีฝั่งเรา ---- */

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

  /* public.users อาจยังมี auth_id เก่าหลัง Auth ถูกลบจากหน้า Dashboard
     ต้องตรวจตัวจริงก่อน update ไม่เช่นนั้นผู้ใช้บริษัทจะได้ "ออก session ไม่สำเร็จ"
     และค้างอยู่ในคลังเก็บถาวรตลอดไป */
  if (authId) {
    const { data: linkedAuth } = await sb.auth.admin.getUserById(authId)
    if (!linkedAuth.user) authId = null
  }

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

  /* token ของบริษัทจบการเดินทางตรงนี้ ไม่ถูกส่งลงไปที่เบราว์เซอร์ (ข้อ 7)
     เขียนทับของเดิมเสมอ — คนหนึ่งคนมีได้ session เดียว ล็อกอินใหม่ = ของเก่าใช้ไม่ได้ */
  const expiresAt = tokenExpiry(tmsToken)
  const { error: keepErr } = await sb.from('tms_sessions').upsert({
    auth_id: authId,
    token: tmsToken,
    expires_at: expiresAt?.toISOString() ?? null,
    updated_at: new Date().toISOString(),
  })
  if (keepErr) return json({ error: 'เก็บการเชื่อมต่อ TMS ไม่สำเร็จ' }, 500)

  return json({
    session: {
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
    },
    /* บอกแค่วันหมดอายุ ไม่ใช่ตัว token — หน้าเว็บใช้ค่านี้ขึ้นป้ายเตือนก่อนหมดเวลา */
    tms_expires_at: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null,
    account: me ?? null,
    pending: !me?.is_active,
  })
}

/* ---- ตัวตนฝั่งเราต้องมาก่อนทุกเส้นที่ไม่ใช่ auth ----
   header Authorization ต้องเป็น session ของคนที่ล็อกอินอยู่จริง ไม่ใช่ anon key —
   anon key ถูกคอมไพล์ติดไปกับ bundle ใครเปิดหน้าเว็บก็หยิบไปได้ */
async function identify(
  req: Request,
  sb: ReturnType<typeof admin>,
): Promise<{ authId: string } | { error: string; status: number }> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '')
  if (!jwt) return { error: 'ต้องเข้าสู่ระบบก่อน', status: 401 }

  const { data: who } = await sb.auth.getUser(jwt)
  if (!who.user) return { error: 'ต้องเข้าสู่ระบบก่อน', status: 401 }

  return { authId: who.user.id }
}

async function handleCall(req: Request, cors: Record<string, string>): Promise<Response> {
  const json = reply(cors)

  const sb = admin()
  const id = await identify(req, sb)
  if ('error' in id) return json({ error: id.error }, id.status)

  /* บัญชีที่ยังไม่ถูกอนุมัติ หรือถูก admin ปิดไปแล้ว ต้องหมดสิทธิ์ดึงข้อมูลทันที
     ไม่ใช่รอจนกว่า token ของ TMS จะหมดอายุไปเอง */
  const { data: me } = await sb.from('users')
    .select('is_active').eq('auth_id', id.authId).maybeSingle()
  if (!me?.is_active) return json({ error: 'บัญชีนี้ยังไม่ได้รับอนุมัติให้ดึงข้อมูล' }, 403)

  /* หยิบ token ของบริษัทจากฝั่งเซิร์ฟเวอร์ ไม่ใช่รับมาจากคำขอ (ข้อ 7)
     เจ้าตัวเองก็อ่านตารางนี้ไม่ได้ — RLS เปิดแล้วไม่มี policy สักอัน */
  const { data: link } = await sb.from('tms_sessions')
    .select('token, expires_at').eq('auth_id', id.authId).maybeSingle()
  if (!link) {
    return json({ error: 'ยังไม่ได้เชื่อมกับ TMS — เข้าสู่ระบบใหม่หนึ่งครั้ง', code: 'NO_TMS_SESSION' }, 409)
  }
  /* ตัดจบก่อนยิง ถ้า exp บอกว่าหมดแล้ว — ประหยัดคำขอที่รู้ผลอยู่แล้วว่า 401
     เผื่อ 30 วินาทีให้นาฬิกาที่เดินคลาดกัน ไม่ให้ตัดก่อนเวลาจริง */
  if (link.expires_at && Date.parse(link.expires_at) < Date.now() - 30_000) {
    await sb.from('tms_sessions').delete().eq('auth_id', id.authId)
    return json({ error: 'การเข้าระบบ TMS หมดอายุ' }, 401)
  }
  const token = link.token

  const { op, params } = await req.json().catch(() => ({}))

  const build = typeof op === 'string' ? OPS[op] : undefined
  if (!build) return json({ error: 'ไม่รู้จักงานนี้' }, 403)

  let spec: Op
  try {
    spec = build((params ?? {}) as Record<string, unknown>)
  } catch {
    return json({ error: 'พารามิเตอร์ไม่ถูกต้อง' }, 400)
  }

  const r = await fetch(TMS_BASE + spec.path, {
    method: spec.method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: spec.method === 'GET' ? undefined : JSON.stringify(spec.body ?? {}),
  })

  /* TMS ปฏิเสธ token = ตัวตนฝั่งบริษัทหมดอายุจริง ไม่ใช่แค่ค่า exp ที่เราเดา
     ลบทิ้งเลย ไม่ให้ทุกคำขอถัดไปวิ่งไปเก้อที่บริษัทซ้ำ ๆ */
  if (r.status === 401) await sb.from('tms_sessions').delete().eq('auth_id', id.authId)

  const text = await r.text()
  return new Response(text, {
    status: r.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/** ตัดการเชื่อมต่อ TMS — หน้าเว็บเรียกตอนล็อกเอาต์
 *  เดิมแค่ลบ sessionStorage ฝั่งเบราว์เซอร์ก็จบ ตอนนี้ของจริงอยู่ฝั่งนี้ */
async function handleDisconnect(req: Request, cors: Record<string, string>): Promise<Response> {
  const json = reply(cors)
  const sb = admin()
  const id = await identify(req, sb)
  /* ล็อกเอาต์ตอน session หมดอายุไปแล้วเป็นเรื่องปกติ ตอบ ok ไปเลย ไม่ต้องให้หน้าเว็บ
     ขึ้น error ระหว่างพาผู้ใช้ออก — แถวที่ค้างถูกกวาดทิ้งตามอายุอยู่แล้ว */
  if ('error' in id) return json({ ok: true })
  await sb.from('tms_sessions').delete().eq('auth_id', id.authId)
  return json({ ok: true })
}

Deno.serve(async req => {
  const cors = corsFor(req)
  const json = reply(cors)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!TMS_BASE) return json({ error: 'ยังไม่ได้ตั้ง TMS_BASE_URL' }, 500)

  const route = new URL(req.url).pathname.split('/').pop()
  try {
    if (route === 'auth') return await handleAuth(req, cors)
    if (route === 'call') return await handleCall(req, cors)
    if (route === 'disconnect') return await handleDisconnect(req, cors)
    return json({ error: 'ไม่รู้จัก route นี้' }, 404)
  } catch (e) {
    // ข้อความ error เท่านั้น ห้าม log request body — มีรหัสผ่านอยู่ในนั้น
    console.error(route, e instanceof Error ? e.message : 'unknown')
    return json({ error: 'เกิดข้อผิดพลาดภายใน' }, 500)
  }
})
