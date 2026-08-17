import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useCloudAuth } from '../context/CloudAuthContext'
import { ROLE_LABEL } from '../utils/constants'
import { fmtDate, fmtLongToday, initials } from '../utils/format'
import { applyTheme, currentTheme, type Theme } from '../utils/theme'
import { IconBox, IconBuilding, IconRoute, IconLogout, IconMenu, IconMoon, IconShield, IconSun, IconTable, IconTruckBig, IconUsers } from './icons'

/**
 * โครงหน้าจอฉบับคลาวด์ — คู่ขนานกับ Layout.tsx ที่ยังคุยกับ Express
 *
 * ก่อนหน้านี้แอปคลาวด์ไม่มีเมนูเลย ทุกหน้าเข้าถึงได้ทางเดียวคือพิมพ์ URL เอง
 * ตอนมีสองหน้ายังพอไหว พอเริ่มแปลงหน้าออฟฟิศเข้ามาก็กลายเป็นของที่ไม่มีใครกดถึง
 *
 * **เมนูมีเฉพาะหน้าที่แปลงมาแล้วจริง ๆ** ไม่ได้ก๊อป NAV ทั้งชุดจากของเดิมมาแล้วรอเติม —
 * เมนูที่กดแล้วเจอ 404 แย่กว่าไม่มีเมนู เพราะผู้ใช้แยกไม่ออกว่าระบบพังหรือยังไม่ได้ทำ
 * เพิ่มหน้าไหนเสร็จค่อยเพิ่มบรรทัดในนี้พร้อม route ใน AppCloud.tsx
 *
 * ไม่ยิง /settings เหมือนของเดิมเพราะยังไม่ได้แปลงหน้าตั้งค่า ชื่อองค์กรจึงตายตัวไว้ก่อน
 */

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ size?: number }>
  /** ต้องมีสิทธิ์นี้ถึงจะเห็น — ซ่อนเมนูเป็นแค่การไม่ชี้ทางไปหน้าที่กดแล้วว่างเปล่า
   *  ตัวกันจริงคือ RLS ในฐานข้อมูล ไม่ใช่บรรทัดนี้ */
  perm: string
}

const NAV: NavItem[] = [
  { to: '/my-jobs', label: 'งานของฉัน', icon: IconTruckBig, perm: 'myjobs.view' },
  { to: '/customers', label: 'ลูกค้า', icon: IconBuilding, perm: 'customers.view' },
  { to: '/tms-pull', label: 'รับงานจาก TMS', icon: IconTable, perm: 'orders.write' },
  { to: '/tms-trips', label: 'ตรวจเที่ยวจาก TMS', icon: IconRoute, perm: 'dispatch.view' },
  { to: '/orders', label: 'ออเดอร์', icon: IconBox, perm: 'orders.view' },
  { to: '/dispatch', label: 'แผนงานขนส่ง', icon: IconRoute, perm: 'dispatch.view' },
  { to: '/vehicles', label: 'รถยนต์', icon: IconTruckBig, perm: 'vehicles.view' },
  { to: '/drivers', label: 'พนักงานขับ', icon: IconUsers, perm: 'drivers.view' },
  { to: '/users', label: 'ผู้ใช้และสิทธิ์', icon: IconShield, perm: 'users.manage' },
  { to: '/data', label: 'ข้อมูลระบบ', icon: IconTable, perm: 'users.manage' },
]

export function CloudLayout(): React.JSX.Element {
  const { user, logout, can } = useCloudAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => currentTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const handleLogout = async (): Promise<void> => {
    await logout()
    navigate('/login', { replace: true })
  }

  const items = NAV.filter((i) => can(i.perm))

  return (
    <div className="app-shell">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h11v10H3z" />
              <path d="M14 10h4l3 3v3h-7z" />
              <circle cx="7" cy="17.5" r="1.8" />
              <circle cx="17" cy="17.5" r="1.8" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-name">ระบบขนส่ง</div>
            <div className="brand-sub">TMS · ระบบบริหารจัดการขนส่ง</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              <item.icon size={18} />
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="nav-label sidebar-version">ทรานส์พลัส TMS · คลาวด์</div>
        </div>
      </aside>

      {menuOpen && <div className="modal-overlay" style={{ zIndex: 45 }} onMouseDown={() => setMenuOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button className="burger" onClick={() => setMenuOpen(true)} aria-label="เปิดเมนู">
              <IconMenu size={22} />
            </button>
            <div className="date-tag" style={{ fontSize: 14, fontWeight: 600 }}>
              <span className="date-long">{fmtLongToday()}</span>
              <span className="date-short">{fmtDate(new Date().toISOString())}</span>
            </div>
          </div>
          <div className="topbar-right">
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
              aria-label={theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
              aria-pressed={theme === 'dark'}
            >
              {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
            </button>
            {user && (
              <div className="user-chip">
                <div className="user-avatar">{initials(user.name)}</div>
                <div className="user-meta">
                  <div className="name">{user.name}</div>
                  <div className="role">{ROLE_LABEL[user.role]}</div>
                </div>
              </div>
            )}
            <button className="btn btn-ghost btn-icon" onClick={() => void handleLogout()} title="ออกจากระบบ" aria-label="ออกจากระบบ">
              <IconLogout size={17} />
            </button>
          </div>
        </header>

        <main className="content page-enter" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
