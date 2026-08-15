import { Link } from 'react-router-dom'

export default function NotFound(): React.JSX.Element {
  return (
    <div className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 52, fontWeight: 800, color: 'var(--accent)' }}>404</div>
        <h1 style={{ margin: '8px 0 4px' }}>ไม่พบหน้านี้</h1>
        <p className="login-sub">หน้าที่คุณค้นหาไม่มีอยู่ในระบบ หรือ URL ไม่ถูกต้อง</p>
        <Link to="/">
          <button className="btn btn-primary">กลับหน้าแรก</button>
        </Link>
      </div>
    </div>
  )
}
