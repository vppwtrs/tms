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
export function podPhotoPath(orderId: number): string {
  return `${orderId}/${crypto.randomUUID()}.jpg`
}

export async function uploadPodPhoto(orderId: number, file: Blob): Promise<string> {
  const path = podPhotoPath(orderId)
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: 'image/jpeg',
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
