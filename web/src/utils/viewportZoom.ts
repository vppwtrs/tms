/* ล็อกการซูมของทั้งหน้า — จอคนขับเป็นแอปที่กดด้วยนิ้วในรถ นิ้วโป้งที่ปัดพลาดแล้ว
 * หน้าขยายค้าง คือปุ่มหลักหลุดจอและคนขับหาทางกลับไม่เจอ
 * ที่เดียวที่ยังซูมได้คือรูปที่เปิดดูเต็มจอ (PhotoViewer) ซึ่งปลดล็อกชั่วคราวแล้วคืนเมื่อปิด
 *
 * นับเป็นชั้น ไม่ใช่ true/false — ถ้าวันหนึ่งมีสองที่ขอปลด (รูปซ้อนรูป) ปิดอันแรก
 * ต้องไม่ล็อกกลับทั้งที่อีกอันยังเปิดอยู่ */

/* ย่อทุกหน้าตามรุ่นมือถือ — แบบออกที่จอ 390x844 จอมือถือที่เล็กกว่าย่อทั้งหน้าเท่ากัน
 * จอใหญ่กว่า แท็บเล็ต และเดสก์ท็อปใช้ขนาดจริง วัดครั้งเดียวก่อนแก้ meta (หลังแก้ค่าจะเป็นหน่วยใหม่) */
const DESIGN_W = 390
const DESIGN_H = 844
const fit = (() => {
  const w = window.innerWidth
  const h = window.innerHeight
  const phone = Math.min(screen.width, screen.height) < 600 && !!window.matchMedia?.('(pointer: coarse)').matches
  const s = phone ? Math.min(1, w / DESIGN_W, h / DESIGN_H) : 1
  return s >= 0.999 ? { phone, width: 'device-width', scale: '1.0' } : { phone, width: String(Math.round(w / s)), scale: s.toFixed(3) }
})()
const LOCKED = `width=${fit.width}, initial-scale=${fit.scale}, maximum-scale=${fit.scale}, user-scalable=no, viewport-fit=cover`
const FREE = `width=${fit.width}, initial-scale=${fit.scale}, viewport-fit=cover`

let locked = false
let unlockDepth = 0

function apply(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) return
  /* มือถือล็อกทุกหน้า รวมหน้า login — เดสก์ท็อป/แท็บเล็ตล็อกเฉพาะตอนเปิดผิวคนขับ */
  meta.content = (locked || fit.phone) && unlockDepth === 0 ? LOCKED : FREE
  document.documentElement.classList.toggle('is-phone', fit.phone)
}

/** เปิดหรือปิดการล็อกซูมของทั้งหน้า — จอคนขับเปิด จอออฟฟิศปิด */
/** เรียกครั้งเดียวตอนเปิดแอป ให้ทุกหน้าย่อตามจอ */
export function fitToScreen(): void {
  apply()
  if (!fit.phone) return
  /* iOS ซูมเข้าเองตอนแตะช่องกรอกที่ตัวอักษรเล็กกว่า 16px บนจอจริง แล้วค้างซูมไว้
     หลัง login — ตั้งขนาดช่องกรอกให้ ≥16px หลังย่อ และเมื่อออกจากช่องกรอกหรือเปลี่ยนหน้า
     เขียน meta ใหม่ให้ iOS ดีดกลับสเกลเดิม */
  document.documentElement.style.setProperty('--fit-scale', fit.scale)
  const reset = (): void => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (!meta) return
    meta.content = FREE
    requestAnimationFrame(() => apply())
  }
  document.addEventListener('focusout', (e) => {
    if ((e.target as HTMLElement)?.matches?.('input, textarea, select')) setTimeout(reset, 50)
  })
  window.addEventListener('popstate', reset)
  const push = history.pushState.bind(history)
  history.pushState = (...a: Parameters<History['pushState']>) => { push(...a); reset() }
  const rep = history.replaceState.bind(history)
  history.replaceState = (...a: Parameters<History['replaceState']>) => { rep(...a); reset() }
}

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
