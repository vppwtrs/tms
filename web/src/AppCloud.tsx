import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useCloudAuth } from './context/CloudAuthContext'
import { CloudLayout } from './components/CloudLayout'

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
 * หน้าที่ยังไม่มีในนี้ (ออเดอร์ จัดเที่ยว ใบเสนอราคา รายงาน แดชบอร์ด ตั้งค่า) ตั้งใจยังไม่ใส่ —
 * ตัวเชื่อมใน api/ เขียนเสร็จแล้วทุกตัว แต่หน้าจอยังต้องแปลงทีละหน้า
 * ใส่ route ที่พาไปหน้าซึ่งยังไม่ได้แปลง = ผู้ใช้เจอหน้าพังโดยไม่รู้ว่าเพราะอะไร
 */

const CloudLogin = lazy(() => import('./pages/CloudLogin'))
const CloudHome = lazy(() => import('./pages/CloudHome'))
const CloudMyJobs = lazy(() => import('./pages/CloudMyJobs'))
const CloudUsers = lazy(() => import('./pages/CloudUsers'))
const CloudData = lazy(() => import('./pages/CloudData'))
const CloudCustomers = lazy(() => import('./pages/CloudCustomers'))
const TmsPull = lazy(() => import('./pages/TmsPull'))
const CloudTmsImport = lazy(() => import('./pages/CloudTmsImport'))
const CloudTmsTrips = lazy(() => import('./pages/CloudTmsTrips'))
const CloudVehicles = lazy(() => import('./pages/CloudVehicles'))
const CloudDrivers = lazy(() => import('./pages/CloudDrivers'))
const CloudOrders = lazy(() => import('./pages/CloudOrders'))
const CloudDispatch = lazy(() => import('./pages/CloudDispatch'))
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

/** ด่านล็อกอิน + โครงหน้าจอ (เมนู/แถบบน) — หน้าที่อยู่ข้างในไม่ต้องรู้เรื่องทั้งสองอย่าง */
function Protected(): React.JSX.Element {
  const { user, loading } = useCloudAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  return <CloudLayout />
}

/** หน้าแรกขึ้นกับสิทธิ์ — คนขับไม่มีสิทธิ์ฝั่งออฟฟิศ พาไปหน้าออฟฟิศคือส่งไปเจอหน้าว่าง */
function Home(): React.JSX.Element {
  const { can } = useCloudAuth()
  if (can('myjobs.view')) return <Navigate to="/my-jobs" replace />
  if (can('customers.view') || can('orders.write') || can('dispatch.view')) return <CloudHome />
  if (can('users.manage')) return <Navigate to="/users" replace />
  /* ไม่เข้าเงื่อนไขไหนเลย = ล็อกอินได้แต่ไม่มีสิทธิ์เปิดหน้าไหนได้เลย
     ห้ามเด้งไป /login เด็ดขาด — PublicOnly จะเห็นว่ามี user แล้วเด้งกลับมาที่นี่ วนไม่จบ
     และผู้ใช้จะเห็นแค่หน้าล็อกอินค้างอยู่ เหมือนรหัสผิดทั้งที่เข้าระบบได้แล้ว */
  return (
    <div className="card" style={{ margin: 24, padding: 24, textAlign: 'center' }}>
      <h2 style={{ marginBottom: 8 }}>บัญชีนี้ยังไม่มีสิทธิ์เปิดหน้าใดได้</h2>
      <p className="text-muted">แจ้งผู้ดูแลระบบให้กำหนดสิทธิ์ให้ที่หน้าผู้ใช้และสิทธิ์</p>
    </div>
  )
}

function PublicOnly(): React.JSX.Element {
  const { user, pendingName } = useCloudAuth()
  /* pendingName ยังต้องเห็นหน้า login ได้ เพราะหน้านั้นเป็นตัวบอกว่า "รออนุมัติอยู่"
     ถ้าเด้งออกไปหน้าอื่น ผู้ใช้จะไม่มีทางรู้เลยว่าเกิดอะไรขึ้น */
  if (user && !pendingName) return <Navigate to="/" replace />
  return <CloudLogin />
}

function RequirePermission({ permission, children }: { permission: string; children: React.ReactNode }): React.JSX.Element {
  const { can } = useCloudAuth()
  if (!can(permission)) {
    return <div className="card" style={{ margin: 24, padding: 24, textAlign: 'center' }}>
      <h2 style={{ marginBottom: 8 }}>ไม่มีสิทธิ์เปิดหน้านี้</h2>
      <p className="text-muted">แจ้งผู้ดูแลระบบให้เพิ่มสิทธิ์ให้บัญชีของคุณ</p>
    </div>
  }
  return <>{children}</>
}

export default function AppCloud(): React.JSX.Element {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/login" element={<PublicOnly />} />
        <Route element={<Protected />}>
          <Route path="/" element={<Home />} />
          <Route path="/my-jobs" element={<RequirePermission permission="myjobs.view"><CloudMyJobs /></RequirePermission>} />
          <Route path="/tms-pull" element={<RequirePermission permission="orders.write"><TmsPull /></RequirePermission>} />
          <Route path="/tms-import" element={<RequirePermission permission="orders.write"><CloudTmsImport /></RequirePermission>} />
          <Route path="/tms-trips" element={<RequirePermission permission="dispatch.view"><CloudTmsTrips /></RequirePermission>} />
          <Route path="/orders" element={<RequirePermission permission="orders.view"><CloudOrders /></RequirePermission>} />
          <Route path="/dispatch" element={<RequirePermission permission="dispatch.view"><CloudDispatch /></RequirePermission>} />
          <Route path="/vehicles" element={<RequirePermission permission="vehicles.view"><CloudVehicles /></RequirePermission>} />
          <Route path="/drivers" element={<RequirePermission permission="drivers.view"><CloudDrivers /></RequirePermission>} />
          <Route path="/customers" element={<RequirePermission permission="customers.view"><CloudCustomers /></RequirePermission>} />
          <Route path="/users" element={<RequirePermission permission="users.manage"><CloudUsers /></RequirePermission>} />
          <Route path="/data" element={<RequirePermission permission="users.manage"><CloudData /></RequirePermission>} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
