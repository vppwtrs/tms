import { supabase, toDataError } from './supabase.js'

/**
 * รูปหลักฐาน POD — แทน server/data/pod ที่เคยเก็บบนดิสก์ของเครื่อง server
 *
 * bucket ตั้งเป็น private ห้ามเปลี่ยนเป็น public เด็ดขาด
 * รูปพวกนี้มีลายเซ็นลูกค้า หน้าร้าน และบางทีติดหน้าคน — public เมื่อไหร่คือหลุดถาวร
 * เพราะ URL ของ bucket สาธารณะเดาได้จากชื่อไฟล์ ไม่ต้องมี key อะไรเลย
 *
 * การอ่านจึงต้องผ่าน signed URL ที่มีอายุจำกัดเสมอ
 */

const BUCKET = 'pod-photos'

/** อายุ signed URL — สั้นพอที่ลิงก์หลุดไปแล้วหมดอายุก่อนใครเอาไปใช้ต่อ
 *  แต่ยาวพอให้เปิดดูรูปในหน้ารายการโดยไม่ต้องขอใหม่ทุกครั้งที่ scroll */
const SIGNED_URL_TTL = 60 * 10

/** path ในถัง — แยกโฟลเดอร์ตามออเดอร์ ไม่ใช้ชื่อไฟล์ที่ผู้ใช้ตั้งเอง
 *  เพราะชื่อไฟล์จากมือถือมีอักขระแปลก ๆ และเดาชื่อกันได้ง่าย */
export function podPhotoPath(orderId: number, ext = 'jpg'): string {
  return `${orderId}/${crypto.randomUUID()}.${ext}`
}

/** นามสกุลกับชนิดต้องมาจากตัวบีบรูป ไม่ใช่เดาเอง — เครื่องที่เข้ารหัส WebP ได้จะได้
 *  ไฟล์เล็กกว่ามาก ส่วนเครื่องที่ไม่ได้ตกมาเป็น JPEG เขียนตายตัวว่า jpeg ทั้งคู่แล้ว
 *  ไฟล์ WebP จะถูกป้ายชนิดผิด ซึ่งเบราว์เซอร์บางตัวไม่ยอมแสดงตอนเปิดดูย้อนหลัง */
export async function uploadPodPhoto(
  orderId: number,
  file: Blob,
  kind: { ext: string; type: string } = { ext: 'jpg', type: 'image/jpeg' },
): Promise<string> {
  const path = podPhotoPath(orderId, kind.ext)
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: kind.type,
    /* ห้าม upsert — หลักฐานเดิมต้องไม่ถูกเขียนทับด้วยรูปใหม่เงียบ ๆ */
    upsert: false,
  })
  if (error) throw toDataError(error)
  return path
}

export async function podPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
  if (error) throw toDataError(error)
  return data.signedUrl
}

/** ลบรูปที่ไม่มีหลักฐานใบไหนอ้างถึงแล้ว
 *
 * แถวใน pod_photos หายตาม pod แบบ cascade อยู่แล้ว แต่ไฟล์จริงในถังไม่หายตาม
 * และไม่มีอะไรในระบบเคยลบมันเลย รูปหน้าร้าน ใบเซ็นรับ และของลูกค้าจึงค้างสะสม
 * อยู่ในถังไปเรื่อย ๆ โดยไม่มีใครรู้ว่ามีอะไรอยู่บ้าง
 *
 * ลบจากฝั่ง SQL ไม่ได้ผล — แถวใน storage.objects หายแต่ไฟล์ไม่หาย ต้องสั่งผ่าน
 * storage API ด้วย session ของผู้ใช้เท่านั้น
 *
 * ล้มแล้วไม่โยนต่อ: ของในฐานถูกลบไปเรียบร้อยแล้วตั้งแต่ก่อนถึงบรรทัดนี้ การขึ้น
 * error ตรงนี้จะอ่านได้ว่า "ลบเที่ยวไม่สำเร็จ" ทั้งที่มันสำเร็จไปแล้ว สิ่งที่เหลือ
 * คือไฟล์กำพร้าเท่าเดิม ซึ่งเป็นสภาพก่อนหน้านี้อยู่แล้ว
 */
export async function removePodPhotos(paths: string[]): Promise<number> {
  if (paths.length === 0) return 0
  const { data, error } = await supabase.storage.from(BUCKET).remove(paths)
  if (error) return 0
  return data?.length ?? 0
}
