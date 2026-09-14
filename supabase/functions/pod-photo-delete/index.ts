import { cors, json, callerClient } from '../_shared/http.ts'
import { r2Delete } from '../_shared/r2.ts'

/* ลบไฟล์รูปที่กำพร้าออกจาก R2
 *
 * ฝั่งเว็บส่ง json: { paths: string[] } — path ที่ force_delete คืนมาว่าไม่มีใบไหนอ้างถึงแล้ว
 * ด่านสิทธิ์ = RPC pod_photo_admin (ถือ pod.write) กลุ่มเดียวกับที่ลบเที่ยวถาวรได้
 *
 * ถือ pod.write อย่างเดียวไม่พอ — role นั้นเห็น path ของรูปที่ยัง active ได้ตามปกติ
 * (ผ่าน pod_of_order) เอา path มายิงตรงนี้ได้เหมือนกัน จึงต้องให้ฐานเป็นคนยืนยัน
 * อีกชั้นว่า path ไหนกำพร้าจริง (ไม่มีแถวไหนใน pod_photos/pod อ้างถึงแล้ว) ผ่าน
 * pod_orphan_paths — ลบเฉพาะที่ผ่านด่านนี้เท่านั้น ต่อให้ผู้เรียกส่ง path ของรูป
 * ที่ยังใช้งานอยู่มาด้วยก็ไม่ถูกลบ
 *
 * ล้มบางไฟล์ไม่ throw — ของในฐานถูกลบไปแล้ว ที่เหลือคือไฟล์กำพร้าเท่าเดิม
 * คืนจำนวนที่ลบสำเร็จ ให้ฝั่งเว็บแสดงผลตามจริง
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization) return json({ error: 'ต้องเข้าสู่ระบบก่อน' }, 401)

  try {
    const body = await req.json().catch(() => ({})) as { paths?: unknown }
    const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === 'string' && p.length > 0) : []
    if (paths.length === 0) return json({ deleted: 0 })

    const caller = callerClient(authorization)
    const { data: allowed, error } = await caller.rpc('pod_photo_admin')
    if (error) return json({ error: error.message }, 400)
    if (!allowed) return json({ error: 'ไม่มีสิทธิ์ลบรูปหลักฐาน' }, 403)

    /* ฐานเป็นคนตัดสินว่า path ไหนกำพร้าจริง ไม่เชื่อคำขอของผู้เรียกตรง ๆ —
       path ที่ยังมีใบอ้างถึงอยู่จะไม่ถูกส่งกลับมา แล้วจะไม่ถูกลบ */
    const { data: orphans, error: orphanErr } = await caller.rpc('pod_orphan_paths', { p_paths: paths })
    if (orphanErr) return json({ error: orphanErr.message }, 400)
    const safePaths = Array.isArray(orphans) ? orphans as string[] : []

    let deleted = 0
    for (const key of safePaths) {
      try {
        await r2Delete(key)
        deleted += 1
      } catch (e) {
        console.error(`delete ${key}: ${e instanceof Error ? e.message : 'unknown'}`)
      }
    }
    return json({ deleted })
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'unknown')
    return json({ error: 'ลบรูปไม่สำเร็จ' }, 500)
  }
})
