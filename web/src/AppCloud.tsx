import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useCloudAuth } from './context/CloudAuthContext'

/**
 * แอปฉบับคลาวด์ — คู่ขนานกับ App.tsx ที่ยังคุยกับ Express บน LAN
 *
 * ทำไมเป็นสองแอป ไม่ใช่สับสวิตช์ทีเดียว:
 * ออฟฟิศทำงานกับระบบเดิมทุกวัน การสับทีเดียวแปลว่าถ้าพลาด งานหยุดทั้งออฟฟิศกลางสัปดาห์
 * แบบนี้ของเดิมยังรันบน LAN ไม่ถูกแตะเลย ย้ายคนไปทีละกลุ่ม แล้วค่อยเลิกใช้ของเดิม
 * เมื่อมั่นใจ ราคาที่จ่ายคือมีโค้ดสองชุดอยู่พักหนึ่ง ซึ่งถูกกว่าออฟฟิศหยุดทำงานหนึ่งวัน
 *
 * เลือก build ด้วย VITE_TARGET=cloud (ดู main.tsx)
 *
 * หน้าที่ยังไม่มีในนี้ (ออเดอร์ ลูกค้า รถ ใบเสนอราคา รายงาน) ตั้งใจยังไม่ใส่ —
 * ตัวเชื่อมใน api/ เขียนเสร็จแล้วทุกตัว แต่หน้าจอยังต้องแปลงทีละหน้า
 * ใส่ route ที่พาไปหน้าซึ่งยังไม่ได้แปลง = ผู้ใช้เจอหน้าพังโดยไม่รู้ว่าเพราะอะไร
 */

const CloudLogin = lazy(() => import('./pages/CloudLogin'))
const CloudMyJobs = lazy(() => import('./pages/CloudMyJobs'))
const CloudUsers = lazy(() => import('./pages/CloudUsers'))
const TmsPull = lazy(() => import('./pages/TmsPull'))
const NotFound = lazy(() => import('./pages/NotFound'))

function Splash(): React.JSX.Element {
  return (
    <div className="login-page">
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🚛</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>กำลังโหลดระบบ...</div>
      </div>
    </div>
  )
}

function Protected({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user, loading } = useCloudAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** หน้าแรกขึ้นกับสิทธิ์ — คนขับไม่มีสิทธิ์ฝั่งออฟฟิศ พาไปหน้าออฟฟิศคือส่งไปเจอหน้าว่าง */
function Home(): React.JSX.Element {
  const { can } = useCloudAuth()
  if (can('myjobs.view')) return <Navigate to="/my-jobs" replace />
  if (can('orders.write')) return <Navigate to="/tms-pull" replace />
  if (can('users.manage')) return <Navigate to="/users" replace />
  return <Navigate to="/login" replace />
}

function PublicOnly(): React.JSX.Element {
  const { user, pendingName } = useCloudAuth()
  /* pendingName ยังต้องเห็นหน้า login ได้ เพราะหน้านั้นเป็นตัวบอกว่า "รออนุมัติอยู่"
     ถ้าเด้งออกไปหน้าอื่น ผู้ใช้จะไม่มีทางรู้เลยว่าเกิดอะไรขึ้น */
  if (user && !pendingName) return <Navigate to="/" replace />
  return <CloudLogin />
}

export default function AppCloud(): React.JSX.Element {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/login" element={<PublicOnly />} />
        <Route path="/" element={<Protected><Home /></Protected>} />
        <Route path="/my-jobs" element={<Protected><CloudMyJobs /></Protected>} />
        <Route path="/tms-pull" element={<Protected><TmsPull /></Protected>} />
        <Route path="/users" element={<Protected><CloudUsers /></Protected>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
