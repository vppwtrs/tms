import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from './context/ToastContext'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/animations.css'

/**
 * มีสองปลายทาง เลือกด้วย mode ของ Vite:
 *
 *   npm run build        = ระบบเดิม — Express + SQLite บน LAN ของออฟฟิศ (ค่าเริ่มต้น)
 *   npm run build:cloud  = ระบบใหม่ — Supabase, ขึ้น GitHub Pages ให้คนขับเข้าจากบนถนน
 *
 * ใช้ MODE ที่ Vite มีให้อยู่แล้ว ไม่ตั้งตัวแปรใหม่ — ตัวแปรใหม่ต้องมีไฟล์ .env
 * ซึ่ง .gitignore กันไว้ CI จึงจะไม่เห็น แล้วจะ build ผิดตัวโดยไม่มีใครรู้
 *
 * ค่าเริ่มต้นเป็นของเดิมโดยตั้งใจ — ใครก็ตามที่ build โดยไม่ได้อ่านไฟล์นี้
 * ควรได้ระบบที่ออฟฟิศใช้อยู่ ไม่ใช่ระบบที่ยังย้ายไม่ครบ
 *
 * import แบบ dynamic ทั้งคู่ เพราะ api/supabase.ts โยน error ตั้งแต่ตอน import
 * ถ้าไม่มี env ของ Supabase — ถ้า import ตรง ๆ build ฝั่ง LAN จะพังทันที
 * ทั้งที่ไม่ได้ใช้ Supabase เลย
 */
const CLOUD = import.meta.env.MODE === 'cloud'

// PWA: เปิด service worker เฉพาะ production build (dev ไม่ cache เพื่อไม่ให้ค้าง)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* เฉยๆ — ไม่ขัดการใช้งานถ้า register ไม่สำเร็จ */
    })
  })
}

async function boot(): Promise<void> {
  const [{ default: App }, { Provider }] = await Promise.all([
    CLOUD ? import('./AppCloud') : import('./App'),
    CLOUD
      ? import('./context/CloudAuthContext').then((m) => ({ Provider: m.CloudAuthProvider }))
      : import('./context/AuthContext').then((m) => ({ Provider: m.AuthProvider })),
  ])

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
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
