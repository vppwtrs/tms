import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { Button, Field, Input } from '../components/ui'

export default function Login(): React.JSX.Element {
  const { login } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username, password)
      push('success', 'เข้าสู่ระบบสำเร็จ')
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="logo-big">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h11v10H3z" />
            <path d="M14 10h4l3 3v3h-7z" />
            <circle cx="7" cy="17.5" r="1.8" />
            <circle cx="17" cy="17.5" r="1.8" />
          </svg>
        </div>
        <h1>ระบบบริหารจัดการขนส่ง</h1>
        <p className="login-sub">Transport Management System</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="ชื่อผู้ใช้" required>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoFocus autoComplete="username" />
          </Field>
          <Field label="รหัสผ่าน" required>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </Field>
          {error && (
            <div style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-bg)', borderRadius: 8, padding: '10px 12px', fontSize: 13 }}>
              {error}
            </div>
          )}
          <Button type="submit" loading={loading} size="lg" style={{ marginTop: 4 }}>
            เข้าสู่ระบบ
          </Button>
        </div>

        <div className="login-hint">
          <b>บัญชีทดลอง:</b> admin / admin123 (ผู้ดูแล) · dispatcher / dispatch123 (วางแผน) · viewer / viewer123 (ดูอย่างเดียว)
        </div>
      </form>
    </div>
  )
}
