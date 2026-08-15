import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { useAuth } from './context/AuthContext'

const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Dispatch = lazy(() => import('./pages/Dispatch'))
const Orders = lazy(() => import('./pages/Orders'))
const Vehicles = lazy(() => import('./pages/Vehicles'))
const Drivers = lazy(() => import('./pages/Drivers'))
const Customers = lazy(() => import('./pages/Customers'))
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'))
const Quotes = lazy(() => import('./pages/Quotes'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const Data = lazy(() => import('./pages/Data'))
const Users = lazy(() => import('./pages/Users'))
const MyJobs = lazy(() => import('./pages/MyJobs'))
const NotFound = lazy(() => import('./pages/NotFound'))

function AppSplash(): React.JSX.Element {
  return (
    <div className="login-page">
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🚛</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>กำลังโหลดระบบ...</div>
      </div>
    </div>
  )
}

function Protected(): React.JSX.Element {
  const { user, loading } = useAuth()
  if (loading) return <AppSplash />
  if (!user) return <Navigate to="/login" replace />
  return <Layout />
}

/** หน้าแรกขึ้นกับสิทธิ์ — คนขับไม่มี dashboard.view ถ้าพาไปหน้าภาพรวมจะเจอ 403 เปล่า ๆ */
function Home(): React.JSX.Element {
  const { can } = useAuth()
  if (can('dashboard.view')) return <Dashboard />
  if (can('myjobs.view')) return <Navigate to="/my-jobs" replace />
  return <Navigate to="/settings" replace />
}

function PublicOnly(): React.JSX.Element {
  const { user } = useAuth()
  if (user) return <Navigate to="/" replace />
  return <Login />
}

export default function App(): React.JSX.Element {
  return (
    <Suspense fallback={<AppSplash />}>
      <Routes>
        <Route path="/login" element={<PublicOnly />} />
        <Route element={<Protected />}>
          <Route path="/" element={<Home />} />
          <Route path="/my-jobs" element={<MyJobs />} />
          <Route path="/dispatch" element={<Dispatch />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/vehicles" element={<Vehicles />} />
          <Route path="/drivers" element={<Drivers />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/quotes" element={<Quotes />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/data" element={<Data />} />
          <Route path="/users" element={<Users />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
