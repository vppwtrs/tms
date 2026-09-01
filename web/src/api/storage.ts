import { supabase, DataError } from './supabase.js'

/**
 * รูปหลักฐาน POD — เก็บบน Cloudflare R2
 *
 * เดิมอยู่ใน Supabase Storage (bucket pod-photos) อ่าน/เขียนตรงจากเบราว์เซอร์
 * ตอนนี้ไปผ่าน Edge Function ที่ถือ R2 credential เป็น secret:
 *   - อัป   -> pod-photo-upload   (proxy ไฟล์เข้า R2, เช็ค pod_can_write + ชนิด/ขนาด)
 *   - อ่าน  -> pod-photo-url      (เซ็น GET URL อายุ 10 นาที, เช็คผ่าน pod_of_order)
 *   - ลบ    -> pod-photo-delete   (เฉพาะ pod.write, ใช้ตอนลบเที่ยวถาวร)
 *
 * รูปพวกนี้มีลายเซ็นลูกค้าและหน้าร้าน — R2 bucket ต้องไม่เปิด public
 * การอ่านจึงผ่าน signed URL อายุจำกัดเสมอ เหมือนเดิมทุกอย่าง แค่ย้ายที่เก็บ
 *
 * object key คงรูปเดิม  <orderId>/<uuid>.<ext>  (ฝั่ง Edge Function เป็นคนตั้ง)
 */

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1`
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

async function callFn<T>(name: string, init: { body: BodyInit; contentType?: string }): Promise<T> {
  const { data: s } = await supabase.auth.getSession()
  const token = s.session?.access_token
  if (!token) throw new DataError('401', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')

  const headers: Record<string, string> = { apikey: ANON, Authorization: `Bearer ${token}` }
  if (init.contentType) headers['Content-Type'] = init.contentType

  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, { method: 'POST', headers, body: init.body })
  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { /* ปล่อยเป็น null */ }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? 'เรียกบริการรูปไม่สำเร็จ'
    throw new DataError(String(res.status), `${msg} (${res.status})`)
  }
  return data as T
}

/** อัปรูปขึ้น R2 ผ่าน Edge Function — คืน object key ที่เก็บลง pod_photos.path
 *  ชนิดกับนามสกุลมาจากตัวบีบรูป ไม่เดาเอง เครื่องที่เข้ารหัส WebP ได้จะได้ไฟล์เล็กกว่ามาก */
export async function uploadPodPhoto(
  orderId: number,
  file: Blob,
  kind: { ext: string; type: string } = { ext: 'jpg', type: 'image/jpeg' },
): Promise<string> {
  const form = new FormData()
  form.append('order_id', String(orderId))
  /* kind ที่ส่งไปเป็นชื่อมุม (goods/shopfront/document/other) — Edge Function ส่งกลับมาเฉย ๆ
     ไม่ได้ใช้ในชื่อไฟล์ ผู้เรียกเป็นคนจับคู่ path กับ kind เอง */
  form.append('kind', kind.ext)
  form.append('file', new Blob([file], { type: kind.type }), `photo.${kind.ext}`)
  const out = await callFn<{ path: string }>('pod-photo-upload', { body: form })
  return out.path
}

/** ขอลิงก์อ่านรูป — ต้องมี orderId ด้วย เพราะฝั่ง Edge Function เช็คสิทธิ์ผ่าน pod_of_order */
export async function podPhotoUrl(orderId: number, path: string): Promise<string> {
  const out = await callFn<{ url: string }>('pod-photo-url', {
    body: JSON.stringify({ order_id: orderId, path }),
    contentType: 'application/json',
  })
  return out.url
}

/** ลบรูปที่ไม่มีหลักฐานใบไหนอ้างถึงแล้ว — คืนจำนวนที่ลบสำเร็จ
 *
 * ล้มแล้วไม่โยนต่อ: ของในฐานถูกลบไปเรียบร้อยแล้วตั้งแต่ก่อนถึงบรรทัดนี้ การขึ้น error
 * ตรงนี้จะอ่านได้ว่า "ลบเที่ยวไม่สำเร็จ" ทั้งที่มันสำเร็จไปแล้ว สิ่งที่เหลือคือไฟล์
 * กำพร้าเท่าเดิม ซึ่งเป็นสภาพก่อนหน้านี้อยู่แล้ว
 */
export async function removePodPhotos(paths: string[]): Promise<number> {
  if (paths.length === 0) return 0
  try {
    const out = await callFn<{ deleted: number }>('pod-photo-delete', {
      body: JSON.stringify({ paths }),
      contentType: 'application/json',
    })
    return out.deleted ?? 0
  } catch {
    return 0
  }
}
