import { cors, json, callerClient } from '../_shared/http.ts'
import { r2Put } from '../_shared/r2.ts'

/* อัปรูปหลักฐาน POD เข้า R2
 *
 * ฝั่งเว็บส่ง multipart: order_id, kind, file
 * ด่านสิทธิ์ = RPC pod_can_write (เงื่อนไขเดียวกับ save_pod)
 * ตรวจชนิด/ขนาดที่นี่ เพราะ R2 ไม่มี allowed_mime_types / file_size_limit แบบ bucket เดิม
 *
 * key = <order_id>/<uuid>.<ext>  คงรูปเดิม ตาราง pod_photos.path จึงไม่ต้องแก้อะไร
 */

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_BYTES = 15 * 1024 * 1024

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization) return json({ error: 'ต้องเข้าสู่ระบบก่อน' }, 401)

  try {
    const form = await req.formData().catch(() => null)
    const orderId = Number(form?.get('order_id'))
    const kind = String(form?.get('kind') ?? '')
    const file = form?.get('file')

    if (!Number.isFinite(orderId) || orderId <= 0) return json({ error: 'order_id ไม่ถูกต้อง' }, 400)
    if (!(file instanceof File)) return json({ error: 'ไม่มีไฟล์รูป' }, 400)

    const ext = EXT[file.type]
    if (!ext) return json({ error: `ชนิดไฟล์ไม่รองรับ: ${file.type || 'ไม่ทราบ'}` }, 415)
    if (file.size === 0) return json({ error: 'ไฟล์ว่าง' }, 400)
    if (file.size > MAX_BYTES) return json({ error: 'ไฟล์ใหญ่เกิน 15 MB' }, 413)

    const caller = callerClient(authorization)
    const { data: allowed, error } = await caller.rpc('pod_can_write', { p_order_id: orderId })
    if (error) return json({ error: error.message }, 400)
    if (!allowed) return json({ error: 'ไม่มีสิทธิ์แนบรูปเข้าหลักฐานของออเดอร์นี้ หรือออเดอร์ยังไม่ปิดงาน' }, 403)

    const key = `${orderId}/${crypto.randomUUID()}.${ext}`
    await r2Put(key, await file.arrayBuffer(), file.type)

    /* คืน kind กลับไปด้วย ฝั่งเว็บจะได้ประกอบ { path, kind } ส่งเข้า save_pod_with_photos ต่อได้เลย */
    return json({ path: key, kind })
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'unknown')
    return json({ error: 'อัปรูปไม่สำเร็จ' }, 500)
  }
})
