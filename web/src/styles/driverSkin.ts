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
    /* Design C "Soft Operator" — ผิวเดียวของจอคนขับ */
    await import('./ios-softop.css')
  })()
  return loading
}

/* สกินทดลองเก่า (route / focus / sheet / timeline) ถูกถอดทิ้งแล้ว — เหลือ Design C
   ตัวเดียว แต่ค่าที่ค้างใน localStorage ยังทำให้เครื่องที่เคยลองสกินอื่นตั้ง
   data-skin ผิดค้างไว้ ล้างทิ้งครั้งเดียวตอนเปิดผิว */
export function clearLegacySkinChoice(): void {
  /* Safari โหมดส่วนตัวโยน error ตรง localStorage — การล้างค่าเก่าพลาดได้โดยไม่มีใคร
     เดือดร้อน แต่ถ้าปล่อยให้ throw ผิวคนขับจะไม่โหลดเลย แล้วคนขับได้จอออฟฟิศ */
  try {
    localStorage.removeItem('preview-skin')
  } catch {
    /* เฉย ๆ — ไม่มีที่เก็บก็ไม่มีค่าเก่าให้ล้าง */
  }
  delete document.documentElement.dataset.skin
}

/** เปิดหรือปิดผิวที่ <html> — เปิดครั้งแรกรอ CSS โหลดก่อน ไม่งั้นจอกะพริบ
 *  ระหว่างเฟรมที่คลาสติดแล้วแต่ไฟล์ยังมาไม่ถึง */
export async function setDriverSkin(on: boolean): Promise<void> {
  const root = document.documentElement
  if (!on) {
    root.classList.remove('is-native-app')
    return
  }
  clearLegacySkinChoice()
  await loadDriverSkin()
  root.classList.add('is-native-app')
}
