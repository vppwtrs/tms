import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from './context/ToastContext'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
/* ชั้นของจอออฟฟิศ — ต้องมาหลัง components.css เพราะ .ops-table เกาะทับ .table เดิม
   ผิวของคนขับโหลดแยกตอนเข้าหน้าคนขับ (styles/driverSkin.ts) ไม่เกี่ยวกับไฟล์นี้ */
import './styles/ops.css'
import './styles/animations.css'
/* ชั้นมิติ — แสง เงา และฟิสิกส์การเคลื่อนที่ ต้องมาหลังทุกไฟล์ที่นิยาม
   box-shadow/transition ไว้ ไม่งั้นเงาเดิมที่ตั้งมือทับบันไดความสูงกลับ */
import './styles/depth.css'
/* ชั้นของแต่ละหน้า — ปรับเฉพาะหน้าที่รู้บริบทของมันจริง ต้องมาหลังชั้นมิติ
   เพราะบางหน้าจำเป็นต้องทับบันไดกลาง เช่น การ์ดเที่ยวที่ต้องพกสีของช่องติดตัว */
import './styles/pages.css'

/**
 * มีสองโหมด ต่างกันแค่ "ข้อมูลมาจากไหน" ไม่ใช่คนละแอป:
 *
 *   npm run build:cloud  = Supabase ของจริง ขึ้น GitHub Pages
 *   npm run build:demo   = สลับชั้น api ไปหาข้อมูลปลอม ไม่ยิงออกเน็ตเลย (ดู vite.config.ts)
 *
 * เคยมีโหมดที่สามคือระบบเดิมบน Express + SQLite ใน LAN ของออฟฟิศ ซึ่งเป็นค่าเริ่มต้น
 * ถอดออกวันที่ 27 ส.ค. 69 — ไม่มีใครใช้มาตั้งแต่ย้ายขึ้นคลาวด์ และ Vite ก็ตัดมันทิ้ง
 * ตอน build อยู่แล้วเพราะ MODE ถูกแทนเป็นค่าคงที่ ของที่เหลือจึงเป็นแค่ไฟล์ที่คนใหม่
 * เปิดเจอแล้วไม่รู้ว่าอันไหนของจริง (pages/Orders.tsx กับ pages/CloudOrders.tsx)
 * ประวัติ git เก็บไว้ให้แล้วถ้าวันหนึ่งต้องย้อนดู
 *
 * import แบบ dynamic เพราะ api/supabase.ts โยน error ตั้งแต่ตอน import ถ้าไม่มี env
 * ของ Supabase — ให้ error โผล่ตอนแอปเริ่ม ไม่ใช่ตอนโหลดโมดูลแรกสุดซึ่งได้จอขาวเปล่า
 */

/* กรอบพรีวิวใน editor กดอนุญาตตำแหน่งไม่ได้ และจอคนขับไม่ให้กดรับงานถ้าไม่มีตำแหน่ง
   โหมดสาธิตจึงใส่ตัวปลอมทับก่อนแอปขึ้น import แบบมีเงื่อนไข build ปกติจึงไม่มีไฟล์นี้ */
if (import.meta.env.MODE === 'demo') {
  void import('./demo/geo').then(({ installDemoGeolocation }) => installDemoGeolocation())
}

/* ผิวของแอป iOS — ติดคลาสที่ <html> แล้วชั้น ios-*.css ค่อยทับสีและระยะให้
   (ของจริงคือ Design C ใน ios-softop.css ที่โหลดท้ายสุด ดู styles/driverSkin.ts)
   ไม่แตะ JSX สักบรรทัด ลำดับล็อกอินและเส้นทางของงานจึงเหมือนเดิมทั้งหมด

   ?native=1 มีไว้ดูตัวอย่างผิวนี้บนเดสก์ท็อป — ของจริงมาจาก Capacitor
   ซึ่งตอบ true เฉพาะตอนรันอยู่ในแอปเท่านั้น */
/* ไม่ใช้ top-level await ตรงนี้ — เป้าหมายของ build เป็น es2019 และ WebView
   ของ iOS รุ่นเก่ายังไม่รองรับ ผิวที่มาช้าไปหนึ่งเฟรมยอมรับได้ จอขาวเพราะ
   สคริปต์พังทั้งก้อนยอมไม่ได้ */
/* ที่เก็บของ ?native=1 — sessionStorage เพราะเป็นของสำหรับ "ดูตัวอย่าง" ไม่ใช่
   การตั้งค่า ปิดแท็บแล้วต้องหลุดเอง

   เดิมเก็บใน localStorage ซึ่งจำไว้ตลอดไป ใครเผลอเปิดลิงก์ที่มี ?native=1
   หนึ่งครั้งจะติดผิวจอคนขับทุกหน้ารวมหน้าออฟฟิศ แคบอยู่กลางจอ และไม่มีอะไร
   บนจอบอกว่าต้องเปิด ?native=0 เพื่อออก — เสียเวลาไล่หากันมาแล้วหนึ่งวัน

   ทุกครั้งที่อ่านเขียนต้องกันพลาด Safari โหมดส่วนตัวโยน error ตรงนี้ ซึ่งจะทำให้
   ผิวของคนขับไม่โหลดเลย แล้วคนขับได้จอออฟฟิศบนมือถือ */
const PREVIEW_KEY = 'preview-native'

function readPreviewFlag(): boolean {
  try {
    return sessionStorage.getItem(PREVIEW_KEY) === '1'
  } catch {
    return false
  }
}

function writePreviewFlag(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(PREVIEW_KEY, '1')
    else sessionStorage.removeItem(PREVIEW_KEY)
  } catch {
    /* เฉย ๆ — ไม่มีที่เก็บก็แค่ดูตัวอย่างข้ามหน้าไม่ได้ ไม่ใช่เรื่องที่ต้องหยุดแอป */
  }
}

/** ค่าเก่าที่ค้างจากตอนเก็บใน localStorage — ล้างทุกครั้งที่บูต เครื่องที่ติดอยู่
 *  จึงหลุดเองโดยไม่ต้องรู้จัก ?native=0 */
function clearLegacyPreviewFlag(): void {
  try {
    localStorage.removeItem(PREVIEW_KEY)
  } catch {
    /* เฉย ๆ */
  }
}

async function applyNativeSkin(): Promise<void> {
  /* จำไว้ทั้งแท็บ เพราะ ?native=1 หลุดทันทีที่ router เปลี่ยนหน้า
     แล้วผิวจะหายไปกลางทาง ทำให้ดูตัวอย่างไม่ได้จริง (?native=0 เพื่อเลิกดู) */
  clearLegacyPreviewFlag()
  const flag = new URLSearchParams(window.location.search).get('native')
  if (flag === '1') writePreviewFlag(true)
  if (flag === '0') writePreviewFlag(false)
  const forced = readPreviewFlag()
  const { Capacitor } = await import('@capacitor/core')
  /* ในแอปจริงหรือตอนบังคับดูตัวอย่าง ผิวติดทั้งเว็บตั้งแต่บูต เพราะทุกหน้าที่
     เปิดในแอปคือหน้าของคนขับอยู่แล้ว นอกจากนั้นปล่อยให้ useDriverSkin
     เปิดปิดตามหน้า ไม่งั้นหน้าออฟฟิศโดนผิวของจอคนขับทับ */
  if (!forced && !Capacitor.isNativePlatform()) return
  /* ธงให้ useDriverSkin รู้ว่าผิวถูกบังคับไว้แล้ว จะได้ไม่ถอดออกตอนเปลี่ยนหน้า */
  document.documentElement.dataset.nativeShell = '1'
  const { setDriverSkin } = await import('./styles/driverSkin')
  await setDriverSkin(true)
}

void applyNativeSkin()

/* GitHub Pages เสิร์ฟที่ <user>.github.io/<repo>/ ไม่ใช่ราก
   ทั้ง router และ service worker ต้องรู้ base เดียวกัน ไม่งั้นเปิดแล้วจอขาว
   BASE_URL ลงท้ายด้วย / เสมอ ส่วน basename ของ router ต้องไม่มี — ตัดทิ้งตรงนี้ที่เดียว */
const BASE = import.meta.env.BASE_URL
const ROUTER_BASE = BASE.replace(/\/$/, '')

// PWA: เปิด service worker เฉพาะ production build (dev ไม่ cache เพื่อไม่ให้ค้าง)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${BASE}sw.js`)
      /* บังคับเช็ครุ่นใหม่ทุกครั้งที่เปิดแอป — เบราว์เซอร์เช็คให้เองก็จริง แต่ไม่ทุกครั้ง
         และรุ่นที่ค้างอยู่คือรุ่นที่ถือแคชเก่าไว้ ซึ่งเป็นต้นเหตุของ manifest เก่าค้างเครื่อง */
      .then((reg) => reg.update())
      .catch(() => {
        /* เฉยๆ — ไม่ขัดการใช้งานถ้า register ไม่สำเร็จ */
      })
  })
}

async function boot(): Promise<void> {
  const [{ default: App }, { CloudAuthProvider: Provider }] = await Promise.all([
    import('./AppCloud'),
    import('./context/CloudAuthContext'),
  ])

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter basename={ROUTER_BASE}>
        <Provider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </Provider>
      </BrowserRouter>
    </StrictMode>,
  )
}

void boot()
