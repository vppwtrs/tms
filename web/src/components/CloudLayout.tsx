import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useCloudAuth } from '../context/CloudAuthContext'
import { ROLE_LABEL } from '../utils/constants'
import { fmtDate, fmtLongToday, initials } from '../utils/format'
import { applyTheme, currentTheme, type Theme } from '../utils/theme'
import { IconBox, IconBuilding, IconRoute, IconKey, IconLogout, IconMenu, IconMoon, IconPanelLeft, IconPin, IconChart, IconDashboard, IconShield, IconSun, IconTable, IconTruckBig, IconUsers } from './icons'
import { ChangePasswordModal } from './ChangePasswordModal'
import { OpsSearch } from './ops/OpsSearch'

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
   *  ตัวกันจริงคือ RLS ในฐานข้อมูล ไม่ใช่บรรทัดนี้
   *
   *  ไม่ใส่ = เห็นได้ทุกคนที่เข้าถึงเมนูนี้ ใช้กับหน้าแรกซึ่งเลือกเนื้อหาตามสิทธิ์
   *  ด้วยตัวเองอยู่แล้ว (ดู Home ใน AppCloud.tsx) จะผูกกับสิทธิ์ตัวไหนตัวหนึ่ง
   *  ก็ผิดทั้งคู่ — คนที่ไม่มีสิทธิ์นั้นก็ยังต้องมีทางกลับหน้าแรก */
  perm?: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

/* แบ่งกลุ่มตามจังหวะที่คนเปิดใช้ ไม่ใช่ตามชนิดของข้อมูล:
   งานที่แตะทุกวันอยู่บนสุด ข้อมูลหลักแก้เป็นครั้งคราว ระบบแทบไม่แตะเลย
   รายการ ปลายทาง และสิทธิ์ของทุกบรรทัดเท่าเดิม — จัดกลุ่มอย่างเดียว */
const NAV: NavGroup[] = [
  {
    label: 'ปฏิบัติการ',
    items: [
      /* หน้าแรกต้องมีบรรทัดของตัวเองในเมนู — ตอนที่มันเป็นแค่แผงลิงก์ การไม่มีทางกลับ
         ยังพอทน เพราะกลับไปก็ไม่มีอะไร ตอนนี้มันคือสรุปของทั้งวัน ทางกลับจึงต้องมี */
      { to: '/', label: 'ภาพรวมวันนี้', icon: IconDashboard },
      { to: '/my-jobs', label: 'งานของฉัน', icon: IconTruckBig, perm: 'myjobs.view' },
      /* หน้าเดียวจบ — รอบดึงข้อมูลเดินอยู่บนหน้านี้เอง แยกเป็นสองหน้าแล้วรอบดึงจะหยุด
         ทันทีที่คนสลับมาดูเที่ยว ซึ่งเป็นสิ่งที่เกิดตลอดวัน */
      { to: '/tms-trips', label: 'งานจาก TMS', icon: IconRoute, perm: 'dispatch.view' },
      { to: '/orders', label: 'ออเดอร์', icon: IconBox, perm: 'orders.view' },
      { to: '/dispatch', label: 'แผนงานขนส่ง', icon: IconRoute, perm: 'dispatch.view' },
      { to: '/tracking', label: 'ติดตามรถ', icon: IconPin, perm: 'myjobs.view' },
    ],
  },
  {
    label: 'ข้อมูลหลัก',
    items: [
      { to: '/customers', label: 'ลูกค้า', icon: IconBuilding, perm: 'customers.view' },
      { to: '/vehicles', label: 'รถยนต์', icon: IconTruckBig, perm: 'vehicles.view' },
      { to: '/drivers', label: 'พนักงานขับ', icon: IconUsers, perm: 'drivers.view' },
    ],
  },
  {
    label: 'ระบบ',
    items: [
      { to: '/users', label: 'ผู้ใช้และสิทธิ์', icon: IconShield, perm: 'users.manage' },
      { to: '/permission-groups', label: 'กลุ่มสิทธิ์', icon: IconShield, perm: 'users.manage' },
      { to: '/data', label: 'ข้อมูลระบบ', icon: IconTable, perm: 'users.manage' },
      { to: '/usage', label: 'การใช้งานระบบ', icon: IconChart, perm: 'users.manage' },
    ],
  },
]

const RAIL_KEY = 'ops-rail-collapsed'

export function CloudLayout(): React.JSX.Element {
  const { user, logout, can } = useCloudAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => currentTheme())
  /* ทางเข้าเปลี่ยนรหัสผ่านอยู่ตรงนี้ ไม่ใช่ในหน้าผู้ใช้และสิทธิ์ เพราะหน้านั้นต้องมี
     users.manage คนขับกับผู้วางแผนงานจึงไม่มีทางเข้าถึงรหัสของตัวเองเลย */
  const [passwordOpen, setPasswordOpen] = useState(false)
  /* ย่อเมนูแล้วต้องค้าง — คนที่ย่อคือคนที่อยากได้พื้นที่ตาราง ไม่ใช่คนที่อยากกดทุกเช้า */
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(RAIL_KEY) === '1')

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  const handleLogout = async (): Promise<void> => {
    await logout()
    navigate('/login', { replace: true })
  }

  /* กลุ่มที่ไม่เหลือรายการเลยต้องหายไปทั้งกลุ่ม ไม่ใช่เหลือหัวข้อลอย ๆ */
  const groups = NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(i.perm)) }))
    .filter((g) => g.items.length > 0)

  /* คนขับได้จอเปล่า ไม่มีแถบบน ไม่มีเมนูข้าง — หน้าเขามีเมนูล่างจอของตัวเองแล้ว
     แถบบนกินที่หนึ่งแถวเต็มบนมือถือเพื่อของที่เขาไม่ได้ใช้: วันที่ ปุ่มธีม ชื่อบัญชี
     ทั้งสามอย่างย้ายไปอยู่ในแท็บ "ฉัน" ซึ่งเป็นที่ของมันจริง ๆ */
  if (user?.role === 'driver') {
    return (
      <div className="app-shell is-driver">
        <main className="content driver-content" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    )
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
            <div className="brand-name">ระบบขนส่ง</div>
            <div className="brand-sub">TMS · ระบบบริหารจัดการขนส่ง</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="nav-section">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  /* "/" ตรงกับทุกเส้นทางถ้าไม่ใส่ end — ไม่งั้นหน้าแรกจะขึ้นเป็นเมนู
                     ที่เลือกอยู่ตลอดเวลา พร้อมกับหน้าที่เปิดอยู่จริง */
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                  onClick={() => setMenuOpen(false)}
                >
                  <item.icon size={18} />
                  <span className="nav-label">{item.label}</span>
                  {/* ตอนย่อเมนูป้ายชื่อถูกซ่อน อันนี้โผล่มาแทนตอนเอาเมาส์ชี้ */}
                  <span className="nav-tip">{item.label}</span>
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
            aria-pressed={collapsed}
            title={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
          >
            <IconPanelLeft size={17} />
            <span className="nav-label">ย่อเมนู</span>
          </button>
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
            <OpsSearch />
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
            {/* บัญชีที่ยืนยันตัวด้วยรหัสของ TMS บริษัท ตั้งรหัสที่นี่ไม่มีผล —
                gateway สุ่มรหัสฝั่งเราใหม่ทุกครั้งที่ล็อกอิน ซ่อนปุ่มดีกว่าให้กดแล้วรอเก้อ */}
            {user?.authSource !== 'tms' && (
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setPasswordOpen(true)}
              title="เปลี่ยนรหัสผ่านของฉัน"
              aria-label="เปลี่ยนรหัสผ่านของฉัน"
            >
              <IconKey size={17} />
            </button>
            )}
            <button className="btn btn-ghost btn-icon" onClick={() => void handleLogout()} title="ออกจากระบบ" aria-label="ออกจากระบบ">
              <IconLogout size={17} />
            </button>
          </div>
        </header>

        <main className="content page-enter" key={location.pathname}>
          <Outlet />
        </main>

        <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      </div>
    </div>
  )
}
