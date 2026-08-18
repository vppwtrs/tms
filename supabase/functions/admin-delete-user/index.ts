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
    /* ประกาศครั้งเดียว — ของเดิมประกาศ `me` ซ้ำสองครั้งในบล็อกเดียวกัน
       ซึ่งเป็น SyntaxError ทำให้ฟังก์ชันทั้งตัวบูตไม่ขึ้น การลบผู้ใช้จึงล้มทุกครั้ง
       ไม่ว่าจะเป็นใครกดหรือกดกับบัญชีไหน */
    const { data: me } = await asCaller.auth.getUser()
    const { data: actor } = me.user
      ? await asCaller.from('users').select('role').eq('auth_id', me.user.id).maybeSingle()
      : { data: null }
    if (actor?.role !== 'admin') return json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้นที่ลบบัญชีได้' }, 403)

    const body = await req.json().catch(() => ({})) as { user_id?: number }
    if (!body.user_id) return json({ error: 'ต้องระบุผู้ใช้' }, 400)

    const sb = admin()
    const { data: target } = await sb.from('users')
      .select('id, auth_id, username').eq('id', body.user_id).maybeSingle()
    if (!target) return json({ error: 'ไม่พบผู้ใช้นี้' }, 404)
    if (target.auth_id && me.user?.id === target.auth_id) {
      return json({ error: 'ไม่อนุญาตให้ลบบัญชีที่กำลังใช้งานอยู่' }, 400)
    }

    /* ตรวจตัวกันก่อนแตะ Auth เสมอ — ถ้าลบ Auth สำเร็จแล้วค่อยมาล้มตอนลบแถว
       บัญชีจะค้างครึ่งทาง (เข้าระบบไม่ได้แต่ยังมีชื่ออยู่) ซึ่งแก้ยากกว่าเดิม
       POD คือหลักฐานการส่งมอบ "ใครเป็นคนเก็บ" เป็นส่วนหนึ่งของหลักฐาน จึงลบไม่ได้
       (คอลัมน์เป็น NOT NULL ต่างจากคอลัมน์ร่องรอยอื่นที่ตั้งเป็น null ได้) */
    const { count: pods } = await sb.from('pod')
      .select('id', { count: 'exact', head: true }).eq('collected_by', target.id)
    if (pods && pods > 0) {
      return json({
        error: `ลบไม่ได้ — บัญชีนี้เก็บหลักฐานการส่งมอบไว้ ${pods} รายการ ให้ปิดบัญชีแทนการลบ`,
      }, 409)
    }

    /* ล้างสิทธิ์และการผูกคนขับ แต่คงประวัติธุรกิจไว้
       ส่วนคอลัมน์ "ใครทำ" ในตารางร่องรอยตั้งเป็น null เองผ่าน on delete set null */
    await sb.from('user_permissions').delete().eq('user_id', target.id)
    await sb.from('drivers').update({ user_id: null }).eq('user_id', target.id)

    const { error: rowError } = await sb.from('users').delete().eq('id', target.id)
    if (rowError) return json({ error: `ลบข้อมูลผู้ใช้ไม่สำเร็จ: ${rowError.message}` }, 500)

    if (target.auth_id) {
      const { error: authError } = await sb.auth.admin.deleteUser(target.auth_id)
      /* แถวถูกลบไปแล้ว ถ้า Auth ล้มก็ยังต้องบอกให้รู้ว่าเหลืออะไรค้าง
         ไม่ใช่ตอบ ok แล้วปล่อยให้บัญชีเข้าระบบได้ต่อโดยไม่มีโปรไฟล์ */
      if (authError) {
        return json({ error: `ลบโปรไฟล์แล้ว แต่ลบบัญชี Auth ไม่สำเร็จ: ${authError.message}` }, 500)
      }
    }

    return json({ ok: true })
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'unknown')
    return json({ error: 'เกิดข้อผิดพลาดภายใน' }, 500)
  }
})
