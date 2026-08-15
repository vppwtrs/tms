import { useState, type FormEvent } from 'react'
import { useCloudAuth } from '../context/CloudAuthContext'
import { Button, Field, Input } from '../components/ui'

/**
 * หน้าเข้าสู่ระบบแบบสองทาง
 *
 * แยกเป็นสองแท็บ ไม่ใช่ช่องเดียวแล้วเดาเอง — เพราะเดาผิดแล้วผู้ใช้ไม่มีทางรู้ว่าผิดตรงไหน
 * พนักงานออฟฟิศที่พิมพ์รหัส TMS ลงช่องของคนขับจะเจอ "รหัสผิด" ทั้งที่รหัสถูก
 *
 * ฝั่งออฟฟิศเตือนให้ชัดว่ากำลังจะพิมพ์รหัสของบริษัท ไม่ใช่รหัสของเรา
 * คนที่คุ้นกับการเห็นข้อความแบบนี้จะสังเกตออกเองเวลาเจอหน้าปลอมที่ไม่มีมัน
 */

type Tab = 'office' | 'driver'

export default function CloudLogin(): React.JSX.Element {
  const { loginOffice, loginDriver, pendingName } = useCloudAuth()
  const [tab, setTab] = useState<Tab>('office')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (tab === 'office') await loginOffice(user.trim(), password)
      else await loginDriver(user.trim(), password)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  const switchTab = (t: Tab): void => {
    setTab(t)
    setError(null)
    setPassword('')
  }

  if (pendingName) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>รอการอนุมัติ</h1>
          <p className="login-sub">
            ยืนยันตัวตนกับ TMS สำเร็จแล้วในชื่อ <b>{pendingName}</b>
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--muted)' }}>
            บัญชีของคุณถูกสร้างไว้แล้ว แต่ผู้ดูแลระบบยังไม่ได้กำหนดสิทธิ์ให้
            แจ้งหัวหน้าให้เข้าไปอนุมัติที่หน้าผู้ใช้ แล้วรีเฟรชหน้านี้อีกครั้ง
          </p>
        </div>
      </div>
    )
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

        <div className="login-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'office'}
                  className={tab === 'office' ? 'on' : ''} onClick={() => switchTab('office')}>
            พนักงานออฟฟิศ
          </button>
          <button type="button" role="tab" aria-selected={tab === 'driver'}
                  className={tab === 'driver' ? 'on' : ''} onClick={() => switchTab('driver')}>
            พนักงานขับรถ
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label={tab === 'office' ? 'ชื่อผู้ใช้ TMS' : 'อีเมล'} required>
            <Input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder={tab === 'office' ? 'ชื่อผู้ใช้ที่ใช้เข้า TMS' : 'you@example.com'}
              type={tab === 'office' ? 'text' : 'email'}
              autoFocus
              autoComplete="username"
            />
          </Field>
          <Field label="รหัสผ่าน" required>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                   placeholder="••••••••" autoComplete="current-password" />
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
          {tab === 'office' ? (
            <>
              ใช้ <b>ชื่อผู้ใช้และรหัสผ่านของ TMS บริษัท</b> — ระบบส่งไปตรวจกับ TMS ตัวจริง
              ไม่เก็บรหัสของคุณไว้ที่ไหนทั้งสิ้น<br />
              เข้าครั้งแรกต้องรอผู้ดูแลอนุมัติก่อนถึงจะใช้งานได้
            </>
          ) : (
            <>
              ใช้อีเมลและรหัสผ่านที่ออฟฟิศสร้างให้ — <b>ไม่ใช่รหัสของ TMS</b><br />
              ลืมรหัสผ่านให้แจ้งออฟฟิศตั้งใหม่ให้
            </>
          )}
        </div>
      </form>
    </div>
  )
}
