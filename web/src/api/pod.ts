import { supabase, toDataError } from './supabase.js'
import { podPhotoUrl } from './storage.js'

/**
 * อ่านหลักฐานการส่งมอบ — คู่กับ savePodWithPhotos ที่เขียนเข้าไป
 *
 * ลายเซ็นไม่ได้อยู่ใน Storage เหมือนรูป แต่เป็น data URL ของ canvas ที่เก็บเป็นข้อความ
 * ในคอลัมน์ signature_data ตรง ๆ จึงเอาไปใส่ <img src> ได้ทันทีโดยไม่ต้องขอ signed URL
 * ส่วนรูปอยู่ในถังที่เป็น private ต้องขอลิงก์ที่มีอายุจำกัดทีละใบเสมอ
 */

export interface PodPhotoView {
  path: string
  kind: string
  /** ลิงก์ที่มีอายุจำกัด ขอทีหลังเพราะถังเป็น private — ว่าง = ขอลิงก์ไม่ผ่าน
   *  รูปยังอยู่ในถัง แค่เปิดไม่ได้ตอนนี้ ซึ่งคนละเรื่องกับ "ไม่มีรูปมุมนี้" */
  url: string
}

export interface PodView {
  id: number
  order_id: number
  recipient_name: string
  signature_data: string
  notes: string | null
  status: 'collected' | 'verified'
  lat: number | null
  lng: number | null
  collected_at: string
  updated_at: string
  collected_by_name: string | null
  photos: PodPhotoView[]
}

interface PodRaw extends Omit<PodView, 'photos'> {
  photos: { path: string; kind: string }[]
}

/** null = ใบนี้ยังไม่มีหลักฐาน หรือคนที่ถามไม่มีสิทธิ์ดู — ทั้งสองกรณีหน้าจอบอกเหมือนกัน
 *  แยกให้เห็นว่า "มีอยู่แต่คุณดูไม่ได้" คือบอกใบ้ว่ามีอะไรอยู่ ซึ่งไม่ใช่หน้าที่ของหน้านี้ */
export async function podOfOrder(orderId: number): Promise<PodView | null> {
  const { data, error } = await supabase.rpc('pod_of_order', { p_order_id: orderId })
  if (error) throw toDataError(error)
  const raw = data as unknown as PodRaw | null
  if (!raw) return null

  /* รูปที่ขอลิงก์ไม่ผ่านให้ตกไปทีละใบ ไม่ล้มทั้งหน้าต่าง — ลายเซ็นกับชื่อผู้รับ
     คือส่วนที่ตอบข้อโต้แย้งได้จริง รูปหายหนึ่งมุมไม่ควรทำให้ดูอย่างอื่นไม่ได้เลย

     แต่เก็บใบที่พลาดไว้ในรายการด้วย url ว่าง ไม่ทิ้งเงียบ ๆ — ของเดิมทิ้งไปเลย
     หน้าจอกับใบส่งของจึงบอกว่ามีรูป 3 ใบทั้งที่คนขับถ่ายไว้ 4 ซึ่งอ่านได้ว่า
     คนขับถ่ายไม่ครบ ทั้งที่ความจริงคือลิงก์ของเราขอไม่ผ่าน */
  const photos: PodPhotoView[] = []
  for (const p of raw.photos) {
    try {
      photos.push({ ...p, url: await podPhotoUrl(raw.order_id, p.path) })
    } catch {
      photos.push({ ...p, url: '' })
    }
  }
  return { ...raw, photos }
}

/** ยืนยันหลักฐาน — ปิดใบไม่ให้แก้อีก
 *
 * ก่อนหน้านี้สแตกคลาวด์ไม่มีทางเรียกใช้เลย ปุ่มเดียวที่เคยมีอยู่ใน PodModal ฝั่ง LAN
 * ซึ่งยิง PATCH /pod/:id/verify ของ Express ที่ production ไม่มี ผลคือทุกใบค้างที่
 * 'collected' ตลอดกาล และกฎ "ยืนยันแล้วแก้ไม่ได้" ใน save_pod ไม่เคยมีผลกับใบไหนเลย
 *
 * ยืนยันซ้ำไม่ถือเป็นข้อผิดพลาด — ฐานคืน already: true กลับมาแทนการโยน error
 */
export async function verifyPod(podId: number): Promise<{ id: number; status: 'verified'; already: boolean }> {
  const { data, error } = await supabase.rpc('verify_pod', { p_pod_id: podId })
  if (error) throw toDataError(error)
  return data as unknown as { id: number; status: 'verified'; already: boolean }
}

/** ยกเลิกการยืนยัน — ทางออกฉุกเฉินเมื่อต้องลบเที่ยวที่ยืนยันไปแล้วจริง ๆ
 *
 * แยกจากปุ่มลบโดยตั้งใจ ถ้าเอาไปรวมเป็นธง "ลบทั้งที่ยืนยันแล้ว" สุดท้ายทุกคน
 * จะติ๊กมันทุกครั้งจนกฎไม่เหลือความหมาย และบันทึกที่ได้ก็ไม่บอกว่าใครเป็นคน
 * ตัดสินใจว่าหลักฐานใบนั้นไม่ต้องเก็บแล้ว
 *
 * เหตุผลบังคับ ฐานปฏิเสธถ้าเว้นว่าง
 */
export async function unverifyPod(podId: number, reason: string): Promise<{ id: number; status: string; already: boolean }> {
  const { data, error } = await supabase.rpc('unverify_pod', { p_pod_id: podId, p_reason: reason })
  if (error) throw toDataError(error)
  return data as unknown as { id: number; status: string; already: boolean }
}
