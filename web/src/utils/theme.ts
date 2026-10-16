/** โหมดสว่าง/มืด — เก็บที่ localStorage, ค่าเริ่มต้นคือโหมดสว่าง
 *
 *  เคยตามการตั้งค่าเครื่อง ซึ่งแปลว่ามือถือที่ตั้งโหมดมืดไว้ (ซึ่งเป็นค่าเริ่มต้น
 *  ของเครื่องจำนวนมาก) เปิดแอปครั้งแรกมาเจอจอมืดทันที ทั้งที่คนส่วนใหญ่ที่นี่
 *  ทำงานกลางวันและคาดหวังจอสว่างแบบเอกสาร — ปุ่มสลับยังอยู่ครบ ใครชอบมืดกดครั้งเดียว
 *  แล้วระบบจำไว้ตลอด */

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

/** ธีมตั้งต้นสำหรับคนที่ยังไม่เคยเลือกเอง */
export function defaultTheme(): Theme {
  return 'light'
}

/** ค่าที่ใช้อยู่จริง
 *  อ่านจาก <html data-theme> ก่อนเสมอ — สคริปต์ใน index.html ทาไว้ตั้งแต่ก่อนวาดเฟรมแรก
 *  ถ้าคำนวณใหม่ตรงนี้จะกลายเป็นแหล่งความจริง 2 ที่ แล้วโหลดแรกจะกระพริบสลับโหมด */
export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'light' || attr === 'dark') return attr
  return getStoredTheme() ?? defaultTheme()
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

/** ค่าที่ผู้ใช้เลือก รวม "ตามเครื่อง" — ค่าเริ่มต้นยังเป็นสว่าง ต้องเลือก auto เอง */
export type ThemePref = Theme | 'auto'

export function getThemePref(): ThemePref {
  try {
    if (localStorage.getItem(KEY) === 'auto') return 'auto'
  } catch { /* ไม่มี localStorage */ }
  return currentTheme()
}

const systemDark = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches

let unwatch: (() => void) | null = null

/** ทาธีมตามที่เลือก — auto ทาตามเครื่องแล้วตามต่อเมื่อเครื่องสลับโหมด */
export function applyThemePref(pref: ThemePref): void {
  unwatch?.()
  unwatch = null
  if (pref !== 'auto') { applyTheme(pref); return }
  applyTheme(systemDark() ? 'dark' : 'light')
  try { localStorage.setItem(KEY, 'auto') } catch { /* ไม่ถูกจำ */ }
  if (typeof window.matchMedia !== 'function') return
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const on = (): void => {
    applyTheme(mq.matches ? 'dark' : 'light')
    try { localStorage.setItem(KEY, 'auto') } catch { /* ไม่ถูกจำ */ }
  }
  mq.addEventListener('change', on)
  unwatch = () => mq.removeEventListener('change', on)
}
