/**
 * admin-users — สร้างบัญชีผู้ใช้ / ตั้งรหัสใหม่ ให้ admin ทำจากหน้าเว็บได้
 *
 *   POST /admin-users/create           สร้างบัญชีใหม่ (+ แถว drivers ถ้าเป็นคนขับ)
 *   POST /admin-users/reset-password   ตั้งรหัสใหม่ให้บัญชีที่มีอยู่
 *   POST /admin-users/attach-driver    สร้างบัญชีให้คนขับที่มีชื่อในระบบแล้วแต่ยังเข้าแอปไม่ได้
 *
 * ทำไมต้องเป็น Edge Function ไม่ใช่ RPC ธรรมดา:
 * การสร้างบัญชีใน auth.users ต้องใช้ service_role ซึ่ง **ห้ามอยู่ใน frontend เด็ดขาด**
 * (มันข้าม RLS ทั้งหมด) ที่ของมันคือ secret ของฟังก์ชันเท่านั้น
 *
 * ===== ข้อจำกัดที่ตั้งใจใส่ ห้ามถอด =====
 *
 * 1. ตรวจสิทธิ์ด้วย token ของคนที่กดจริง (i_can('users.manage')) **ก่อน** แตะ service_role
 *    และฝั่ง SQL ตรวจซ้ำอีกรอบ (create_app_user) — ตรวจที่เดียวแปลว่าบั๊กบรรทัดเดียว
 *    ในไฟล์นี้ = ใครก็สร้าง admin ให้ตัวเองได้
 *
 * 2. **ไม่รับรหัสผ่านจาก client** ฟังก์ชันสุ่มให้แล้วคืนครั้งเดียว
 *    รหัสที่คนหนึ่งตั้งให้อีกคนจะถูกส่งต่อทางแชท/ไลน์ ซึ่งเป็นทางที่รหัสรั่วบ่อยที่สุด
 *
 * 3. **ห้าม console.log(body) และห้าม log รหัสที่สุ่มได้** log ของ Edge Function
 *    อ่านย้อนหลังได้ รหัสที่โผล่ใน log = รหัสที่ใครอ่าน log ได้ก็ใช้เข้าระบบได้
 *
 * 4. สร้างบัญชี auth แล้วแถว users ล้ม -> **ลบบัญชี auth ที่เพิ่งสร้างทิ้ง**
 *    ไม่ทำ = เหลือบัญชีที่ล็อกอินผ่านแต่ไม่มีตัวตนในระบบ ซึ่งอาการเหมือนรหัสผิด
 *    และหาสาเหตุยากที่สุดในบรรดาความพังทั้งหมดของระบบนี้
 *
 * secret: ระบบใส่ SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY ให้เองอยู่แล้ว
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

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

/** client ที่ทำงาน "ในนามของคนที่กด" — ทุก policy และ has_perm มีผลตามปกติ */
const asCaller = (authHeader: string) =>
  createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  )

/* อีเมลของบัญชีที่ออฟฟิศสร้างให้ — โดเมน tms.local ไม่มีจริง ใช้ได้เพราะ auto-confirm
   ผลข้างเคียงที่ต้องรู้: **รีเซ็ตรหัสทางอีเมลไม่ได้ตลอดไป** ต้องมาให้ admin ตั้งใหม่ที่นี่
   ถ้าวันหนึ่งอยากให้คนขับกู้รหัสเองได้ ต้องเปลี่ยนไปใช้อีเมลจริงของเขา */
const authEmail = (username: string) =>
  `${username.toLowerCase().replace(/[^a-z0-9._-]/g, '_')}@tms.local`

/* รหัสชั่วคราวที่คนต้องอ่านออกและพิมพ์ต่อได้ในรถ — ตัด 0/O/1/l/I ทิ้ง
   สุ่มจาก crypto ไม่ใช่ Math.random เพราะนี่คือรหัสจริงที่ใช้เข้าระบบได้ */
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const tempPassword = (len = 12) =>
  Array.from(crypto.getRandomValues(new Uint8Array(len)),
    b => TEMP_ALPHABET[b % TEMP_ALPHABET.length]).join('')

/** ด่านเดียวที่ทุก route ต้องผ่านก่อนแตะ service_role */
async function guard(req: Request): Promise<{ ok: true; auth: string } | { ok: false; res: Response }> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return { ok: false, res: json({ error: 'ต้องเข้าสู่ระบบก่อน' }, 401) }

  const caller = asCaller(auth)
  const { data: me } = await caller.auth.getUser()
  if (!me.user) return { ok: false, res: json({ error: 'เซสชันไม่ถูกต้อง' }, 401) }
  const { data: actor, error } = await caller.from('users').select('role').eq('auth_id', me.user.id).maybeSingle()
  if (error) return { ok: false, res: json({ error: 'ตรวจสิทธิ์ไม่สำเร็จ' }, 401) }
  if (actor?.role !== 'admin') return { ok: false, res: json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' }, 403) }

  return { ok: true, auth }
}

async function handleCreate(req: Request, callerAuth: string): Promise<Response> {
  const { username, name, role, as_driver, phone, driver_id } = await req.json().catch(() => ({}))

  if (!username || !name) return json({ error: 'ต้องมีชื่อผู้ใช้และชื่อ-นามสกุล' }, 400)
  if (!['admin', 'dispatcher', 'viewer', 'driver'].includes(role)) {
    return json({ error: 'บทบาทไม่ถูกต้อง' }, 400)
  }

  const sb = admin()
  const email = authEmail(username)
  const password = tempPassword()

  const { data: created, error: authErr } = await sb.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (authErr || !created.user) {
    /* ข้อความจาก Supabase เป็นภาษาอังกฤษและบอกไม่ตรงเรื่อง ("User already registered")
       แปลให้ตรงกับสิ่งที่คนกดต้องทำต่อ */
    const dup = /already/i.test(authErr?.message ?? '')
    return json({ error: dup ? `ชื่อผู้ใช้ ${username} ถูกใช้ไปแล้ว` : 'สร้างบัญชีไม่สำเร็จ' }, 400)
  }

  /* ฝั่งข้อมูลทำด้วย token ของคนกด — สิทธิ์และกฎธุรกิจทั้งหมดอยู่ใน SQL (0015) */
  const caller = asCaller(callerAuth)
  const { data: row, error: rowErr } = await caller.rpc('create_app_user', {
    p_auth_id: created.user.id,
    p_username: username,
    p_name: name,
    p_role: role,
    p_as_driver: !!as_driver,
    p_phone: phone ?? null,
  })

  if (rowErr) {
    /* ล้างของที่สร้างไปแล้ว — บัญชีที่ล็อกอินได้แต่ไม่มีตัวตนคือความพังที่หาสาเหตุยากที่สุด */
    await sb.auth.admin.deleteUser(created.user.id)
    return json({ error: rowErr.message || 'บันทึกข้อมูลผู้ใช้ไม่สำเร็จ' }, 400)
  }

  /* ผูกกับคนขับที่มีอยู่แล้ว (เช่นคนที่ระบบสร้างจากชื่อใน TMS) ถ้าระบุมา
     create_app_user สร้างแถว drivers ให้เองเมื่อบทบาทเป็นคนขับ ตัวใหม่นั้นจึงถือ user_id
     ไว้แล้ว การผูกซ้ำกับคนที่เลือกจึงชน unique drivers_user_id_key แล้วล้มทั้งคำขอ
     ทิ้งคนขับชื่อซ้ำที่ไม่มีเที่ยวไว้หนึ่งแถวทุกครั้งที่กด
     ถ้ามีแถวที่ถูกสร้างมาใหม่ ให้ยุบเข้ากับคนที่เลือกแทน — merge_drivers ย้าย user_id
     กับประวัติไปไว้ที่คนที่เก็บไว้แล้วลบตัวซ้ำทิ้งในทีเดียว */
  if (driver_id) {
    const newDriverId = (row as { driver_id?: number | null }).driver_id ?? null
    const { error: attErr } = newDriverId && newDriverId !== driver_id
      ? await caller.rpc('merge_drivers', { p_keep: driver_id, p_drop: newDriverId })
      : await caller.rpc('attach_user_to_driver', {
          p_user_id: (row as { user_id: number }).user_id,
          p_driver_id: driver_id,
        })
    if (attErr) {
      /* ล้มหลังบัญชีถูกสร้างไปแล้ว = ของค้างครึ่งทาง ซึ่งเป็นต้นเหตุของคนขับชื่อซ้ำ
         และบัญชีที่ล็อกอินได้แต่ไม่มีใครรู้ว่ามีอยู่ ต้องถอยให้หมดทุกชิ้นเสมอ
         ลำดับกลับด้าน: แถวคนขับที่เพิ่งสร้าง -> แถวผู้ใช้ -> บัญชี auth */
      const madeUser = (row as { user_id: number }).user_id
      if (newDriverId) await sb.from('drivers').delete().eq('id', newDriverId)
      await sb.from('user_permissions').delete().eq('user_id', madeUser)
      await sb.from('users').delete().eq('id', madeUser)
      await sb.auth.admin.deleteUser(created.user.id)
      return json({ error: attErr.message }, 400)
    }
  }

  return json({
    user: row,
    email,
    /* คืนครั้งเดียว ไม่มีที่ไหนเก็บไว้ — ปิดหน้าไปแล้วต้องตั้งใหม่ */
    password,
  })
}

async function handleReset(req: Request, callerAuth: string): Promise<Response> {
  const { user_id } = await req.json().catch(() => ({}))
  if (!user_id) return json({ error: 'ต้องระบุผู้ใช้' }, 400)

  const sb = admin()
  const { data: u } = await sb.from('users').select('id, username, auth_id, role')
    .eq('id', user_id).maybeSingle()

  if (!u) return json({ error: 'ไม่พบผู้ใช้นี้' }, 404)
  if (!u.auth_id) return json({ error: 'ผู้ใช้นี้ยังไม่มีบัญชีเข้าระบบ' }, 400)

  /* ห้ามตั้งรหัสใหม่ให้บัญชีที่ล็อกอินด้วยรหัสของบริษัท — รหัสฝั่งเราของบัญชีนั้น
     ถูกสุ่มใหม่ทุกครั้งที่ล็อกอินผ่าน TMS อยู่แล้ว (ดู tms-gateway) การตั้งรหัสให้
     จึงไม่มีผลอะไรเลย นอกจากทำให้คนเข้าใจว่าตั้งได้แล้วรอเก้อ */
  const { data: src } = await sb.from('users').select('auth_source').eq('id', user_id).maybeSingle()
  if (src?.auth_source === 'tms') {
    return json({ error: 'บัญชีนี้เข้าระบบด้วยรหัสของ TMS บริษัท ตั้งรหัสที่นี่ไม่ได้' }, 400)
  }

  const password = tempPassword()
  const { error } = await sb.auth.admin.updateUserById(u.auth_id, { password })
  if (error) return json({ error: 'ตั้งรหัสใหม่ไม่สำเร็จ' }, 500)

  return json({ username: u.username, password })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const route = new URL(req.url).pathname.split('/').pop()
  try {
    const g = await guard(req)
    if (!g.ok) return g.res

    if (route === 'create') return await handleCreate(req, g.auth)
    if (route === 'reset-password') return await handleReset(req, g.auth)
    return json({ error: 'ไม่รู้จัก route นี้' }, 404)
  } catch (e) {
    /* ข้อความ error เท่านั้น — body มีทั้งชื่อผู้ใช้และรหัสที่สุ่มได้ */
    console.error(route, e instanceof Error ? e.message : 'unknown')
    return json({ error: 'เกิดข้อผิดพลาดภายใน' }, 500)
  }
})

