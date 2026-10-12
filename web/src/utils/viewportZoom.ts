/* ล็อกการซูมของทั้งหน้า — จอคนขับเป็นแอปที่กดด้วยนิ้วในรถ นิ้วโป้งที่ปัดพลาดแล้ว
 * หน้าขยายค้าง คือปุ่มหลักหลุดจอและคนขับหาทางกลับไม่เจอ
 * ที่เดียวที่ยังซูมได้คือรูปที่เปิดดูเต็มจอ (PhotoViewer) ซึ่งปลดล็อกชั่วคราวแล้วคืนเมื่อปิด
 *
 * นับเป็นชั้น ไม่ใช่ true/false — ถ้าวันหนึ่งมีสองที่ขอปลด (รูปซ้อนรูป) ปิดอันแรก
 * ต้องไม่ล็อกกลับทั้งที่อีกอันยังเปิดอยู่ */

const LOCKED = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
const FREE = 'width=device-width, initial-scale=1.0, viewport-fit=cover'

let locked = false
let unlockDepth = 0

function apply(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) return
  meta.content = locked && unlockDepth === 0 ? LOCKED : FREE
}

/** เปิดหรือปิดการล็อกซูมของทั้งหน้า — จอคนขับเปิด จอออฟฟิศปิด */
export function setZoomLock(on: boolean): void {
  locked = on
  apply()
}

/** ปลดล็อกชั่วคราว คืนฟังก์ชันสำหรับล็อกกลับ — ล็อกกลับแล้ว iOS ดีดสเกลคืน 1 เอง */
export function allowZoomWhileOpen(): () => void {
  unlockDepth += 1
  apply()
  let released = false
  return () => {
    if (released) return
    released = true
    unlockDepth -= 1
    apply()
  }
}
