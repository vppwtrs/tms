/* ผิว Design C ของจอคนขับ — โหลดไฟล์ครั้งเดียวแล้วเปิดปิดด้วยคลาสที่ <html>
 *
 * เดิมผิวนี้ติดเฉพาะตอนรันในแอป iOS หรือเปิดด้วย ?native=1 แต่แอป iOS ยังสร้าง
 * ไม่ได้ (ไม่มีเครื่อง Mac) แปลว่าดีไซน์นี้ยังไม่มีคนขับคนไหนได้ใช้จริงสักคน
 * ทั้งที่คนขับเปิดจากเบราว์เซอร์บนมือถืออยู่ทุกวัน
 *
 * เปิดตามหน้า ไม่ใช่เปิดทั้งเว็บ — ผิวนี้ทับสี ระยะ และขนาดปุ่มทั้งชุด
 * ถ้าติดค้างไว้ที่ <html> หน้าออฟฟิศจะโดนไปด้วยทันทีที่คนวางแผนกดออกจากจอคนขับ
 */

let loading: Promise<void> | null = null

/** โหลด CSS ของผิว — เรียกซ้ำได้ ครั้งที่สองได้ promise เดิม ไม่โหลดใหม่ */
export function loadDriverSkin(): Promise<void> {
  loading ??= (async () => {
    await import('./ios-app.css')
    await import('./ios-motion.css')
    await import('./ios-skins.css')
    await import('./ios-premium.css')
    /* Design C "Soft Operator" — ท้ายสุด ทับโทนของผิวเดิมทั้งหมด */
    await import('./ios-softop.css')
  })()
  return loading
}

/** เลือกสกิน — ของจริงคือ softop ที่เหลือเก็บไว้เปิดตรวจย้อนหลังด้วย ?skin= */
export function applySkinChoice(): void {
  const flag = new URLSearchParams(window.location.search).get('skin')
  const skins = ['softop', 'route', 'focus', 'sheet', 'timeline']
  if (flag && skins.includes(flag)) localStorage.setItem('preview-skin', flag)
  document.documentElement.dataset.skin = localStorage.getItem('preview-skin') ?? 'softop'
}

/** เปิดหรือปิดผิวที่ <html> — เปิดครั้งแรกรอ CSS โหลดก่อน ไม่งั้นจอกะพริบ
 *  ระหว่างเฟรมที่คลาสติดแล้วแต่ไฟล์ยังมาไม่ถึง */
export async function setDriverSkin(on: boolean): Promise<void> {
  const root = document.documentElement
  if (!on) {
    root.classList.remove('is-native-app')
    return
  }
  applySkinChoice()
  await loadDriverSkin()
  root.classList.add('is-native-app')
}
