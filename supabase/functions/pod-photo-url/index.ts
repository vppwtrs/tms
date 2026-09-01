import { cors, json, callerClient } from '../_shared/http.ts'
import { r2SignGet } from '../_shared/r2.ts'

/* ขอลิงก์อ่านรูปหลักฐาน POD (มีอายุ 10 นาที)
 *
 * ฝั่งเว็บส่ง json: { order_id, path }
 * ด่านสิทธิ์ = RPC pod_of_order — ตัวเดียวกับที่หน้า POD ใช้ดึงหลักฐาน
 *   คืน null ถ้าไม่มีสิทธิ์ดู  แล้วเช็คว่า path ที่ขอเป็นของใบนั้นจริง
 *   กันคนที่ดูใบ A ได้ เอา path ของใบ B มาขอลิงก์
 */

const TTL = 60 * 10

interface PodShape {
  photos?: { path: string }[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization) return json({ error: 'ต้องเข้าสู่ระบบก่อน' }, 401)

  try {
    const body = await req.json().catch(() => ({})) as { order_id?: number; path?: string }
    const orderId = Number(body.order_id)
    const path = String(body.path ?? '')
    if (!Number.isFinite(orderId) || orderId <= 0 || !path) return json({ error: 'พารามิเตอร์ไม่ครบ' }, 400)

    const caller = callerClient(authorization)
    const { data, error } = await caller.rpc('pod_of_order', { p_order_id: orderId })
    if (error) return json({ error: error.message }, 400)

    const pod = data as PodShape | null
    if (!pod) return json({ error: 'ไม่พบหลักฐาน หรือไม่มีสิทธิ์ดู' }, 403)
    if (!(pod.photos ?? []).some((p) => p.path === path)) {
      return json({ error: 'รูปนี้ไม่ได้อยู่ในหลักฐานใบนี้' }, 403)
    }

    return json({ url: await r2SignGet(path, TTL) })
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'unknown')
    return json({ error: 'ขอลิงก์รูปไม่สำเร็จ' }, 500)
  }
})
