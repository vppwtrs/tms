import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import type { Settings } from '../types'
import { ROLE_LABEL } from '../utils/constants'
import { fmtDate, fmtLongToday, initials } from '../utils/format'
import { applyTheme, currentTheme, type Theme } from '../utils/theme'
import { IconChart, IconClipboard, IconDashboard, IconGear, IconLogout, IconMenu, IconMoon, IconPanelLeft, IconRoute, IconShield, IconTruckBig, IconSun, IconTruck, IconUsers, IconBuilding, IconFileText, IconTable } from './icons'

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ size?: number }>
  end?: boolean
  /** ต้องมีสิทธิ์นี้ถึงจะเห็นเมนู — ไม่ระบุ = ทุกคนที่ล็อกอินเห็น
   *  ซ่อนเมนูเป็นแค่การไม่ชี้ทางไปหน้าที่กดแล้วเจอ 403 · server บังคับสิทธิ์จริงอยู่แล้ว */
  perm?: string
  /** ตรงข้ามกับ perm — ซ่อนเมนูนี้เมื่อ "มี" สิทธิ์ (ใช้กับคู่เมนูที่ชี้หน้าเดียวกันคนละชื่อ) */
  hideIfPerm?: string
}

const NAV: { section: string; items: NavItem[] }[] = [
  { section: 'หลัก', items: [
    { to: '/my-jobs', label: 'งานของฉัน', icon: IconTruckBig, perm: 'myjobs.view' },
    { to: '/', label: 'ภาพรวม', icon: IconDashboard, end: true, perm: 'dashboard.view' },
    { to: '/dispatch', label: 'แผนงานขนส่ง', icon: IconRoute, perm: 'dispatch.view' },
    { to: '/orders', label: 'ออเดอร์', icon: IconClipboard, perm: 'orders.view' },
  ]},
  { section: 'การขาย (CRM)', items: [
    { to: '/quotes', label: 'ใบเสนอราคา', icon: IconFileText, perm: 'quotes.view' },
    { to: '/customers', label: 'ลูกค้า', icon: IconBuilding, perm: 'customers.view' },
  ]},
  { section: 'ทรัพยากร', items: [
    { to: '/vehicles', label: 'รถยนต์', icon: IconTruck, perm: 'vehicles.view' },
    { to: '/drivers', label: 'พนักงานขับ', icon: IconUsers, perm: 'drivers.view' },
  ]},
  { section: 'ข้อมูล', items: [
    { to: '/reports', label: 'รายงาน', icon: IconChart, perm: 'reports.view' },
    { to: '/data', label: 'ข้อมูล CSV', icon: IconTable, perm: 'csv.view' },
  ]},
  { section: 'ผู้ดูแลระบบ', items: [
    { to: '/users', label: 'ผู้ใช้และสิทธิ์', icon: IconShield, perm: 'users.manage' },
    { to: '/settings', label: 'ตั้งค่าระบบ', icon: IconGear, perm: 'settings.manage' },
  ]},
  /* คนที่ไม่มีสิทธิ์ตั้งค่าองค์กรยังต้องเปลี่ยนรหัสผ่านตัวเองได้ —
     หน้าเดียวกัน แต่ชื่อเมนูบอกตามจริงว่ามีอะไรให้ทำ (กลุ่มนี้จะหายไปเองถ้ามีเมนูข้างบนแล้ว) */
  { section: 'บัญชี', items: [
    { to: '/settings', label: 'บัญชีของฉัน', icon: IconGear, hideIfPerm: 'settings.manage' },
  ]},
]

export function Layout(): React.JSX.Element {
  const { user, logout, can } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [theme, setTheme] = useState<Theme>(() => currentTheme())
  /* ย่อเมนู — จำไว้ข้ามการเข้าใช้ครั้งต่อไป ตารางที่คอลัมน์เยอะได้พื้นที่คืน 190px */
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('tms-sidebar') === 'collapsed')

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('tms-sidebar', collapsed ? 'collapsed' : 'open')
  }, [collapsed])

  /* Ctrl + [ ย่อ/ขยายเมนู — ปุ่มลัดเดียวกับระบบ HR */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === '[') {
        e.preventDefault()
        setCollapsed((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    api.get<Settings>('/settings').then(setSettings).catch(() => {})
    // ป้ายจำนวนออเดอร์ค้าง — ยิงเฉพาะคนที่มีสิทธิ์ ไม่งั้นคนขับจะได้ 403 ทุกครั้งที่เปิดแอป
    if (!can('dashboard.view')) return
    api
      .get<{ kpis: { pending: number } }>('/dashboard/summary')
      .then((d) => setPendingCount(d.kpis.pending))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const handleLogout = (): void => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className={`app-shell${collapsed ? ' is-collapsed' : ''}`}>
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
            <div className="brand-name">{settings?.org_name ?? 'ระบบขนส่ง'}</div>
            <div className="brand-sub">TMS · ระบบบริหารจัดการขนส่ง</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {/* กลุ่มที่ไม่เหลือเมนูให้เห็นเลยต้องหายไปทั้งกลุ่ม ไม่ใช่ทิ้งหัวข้อลอยไว้ */}
          {NAV.map((group) => ({
            ...group,
            items: group.items.filter((i) => (!i.perm || can(i.perm)) && !(i.hideIfPerm && can(i.hideIfPerm))),
          }))
            .filter((group) => group.items.length > 0)
            .map((group) => (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {group.items
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    <item.icon size={18} />
                    <span className="nav-label">{item.label}</span>
                    {/* ตอนย่อเมนู ป้ายนี้ทำหน้าที่แทนข้อความที่ถูกซ่อน */}
                    <span className="nav-tip" aria-hidden>{item.label}</span>
                    {item.to === '/orders' && pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button
            type="button"
            className="collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            title={`${collapsed ? 'ขยายเมนู' : 'ย่อเมนู'} (Ctrl + [)`}
          >
            <IconPanelLeft size={16} />
            <span className="nav-label">ย่อเมนู</span>
          </button>
          <div className="nav-label sidebar-version">ทรานส์พลัส TMS v1.0 · 2026</div>
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
            <button className="btn btn-ghost btn-icon" onClick={handleLogout} title="ออกจากระบบ" aria-label="ออกจากระบบ">
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
