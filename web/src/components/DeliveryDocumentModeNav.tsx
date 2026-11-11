import { NavLink } from 'react-router-dom'

const tabs = [
  { to: '/delivery-documents', label: 'ก่อนรถออกจากคลัง', end: true },
  { to: '/delivery-documents/archive', label: 'พิมพ์ย้อนหลัง', end: false },
] as const

export function DeliveryDocumentModeNav(): React.JSX.Element {
  return (
    <nav aria-label="รูปแบบการพิมพ์ใบส่งสินค้า" style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--line)', marginBottom: 16 }}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          style={({ isActive }) => ({
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 40,
            padding: '8px 14px',
            borderBottom: `2px solid ${isActive ? 'var(--blue-600)' : 'transparent'}`,
            color: isActive ? 'var(--blue-700)' : 'var(--muted)',
            fontWeight: isActive ? 700 : 500,
            textDecoration: 'none',
          })}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
