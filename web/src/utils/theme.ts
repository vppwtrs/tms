/** โหมดสว่าง/มืด — เก็บที่ localStorage, ค่าเริ่มต้นตามการตั้งค่าเครื่อง */

export type Theme = 'light' | 'dark'

const KEY = 'tms-theme'

/* ทั้งสองฟังก์ชันต้องกันสภาพแวดล้อมที่ไม่ใช่เบราว์เซอร์จริง —
   jsdom (เทส/ตัวส่งออกไฟล์ static) ไม่มี matchMedia และบางเบราว์เซอร์
   ปิด localStorage ในโหมดส่วนตัว */
export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

export function systemTheme(): Theme {
  if (typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** ค่าที่ใช้อยู่จริง
 *  อ่านจาก <html data-theme> ก่อนเสมอ — สคริปต์ใน index.html ทาไว้ตั้งแต่ก่อนวาดเฟรมแรก
 *  ถ้าคำนวณใหม่ตรงนี้จะกลายเป็นแหล่งความจริง 2 ที่ แล้วโหลดแรกจะกระพริบสลับโหมด */
export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'light' || attr === 'dark') return attr
  return getStoredTheme() ?? systemTheme()
}

/** ทาธีมลง <html> + ปรับ theme-color ของเบราว์เซอร์ (แถบ address บนมือถือ) */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* localStorage ถูกปิด — ธีมยังใช้ได้ แค่ไม่ถูกจำไว้รอบหน้า */
  }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#14111f' : '#faf9fd')
}
