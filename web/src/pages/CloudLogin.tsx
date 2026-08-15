import { useState, type FormEvent } from 'react'
import { useCloudAuth } from '../context/CloudAuthContext'
import { Button, Field, Input } from '../components/ui'

/**
 * หน้าเข้าสู่ระบบช่องเดียว
 *
 * เดิมเป็นสองแท็บให้ผู้ใช้เลือกเองว่าจะเข้าทางไหน แล้วพบว่าเลือกผิดกันจริง —
 * admin เป็นบัญชีของระบบนี้ล้วน ไม่มีตัวตนใน TMS (ตั้งใจ: admin ไม่ยุ่งกับระบบบริษัท
 * ดึงข้อมูลไม่ได้) แต่ก็ไม่ใช่คนขับ จึงไม่รู้ว่าตัวเองควรกดแท็บไหน
 *
 * ตอนนี้ระบบตัดสินให้จาก **โดเมนของสิ่งที่พิมพ์** ไม่ใช่ให้คนเลือก:
 *
 *   ไม่มี @ หรือลงท้าย @vespiario.net → บัญชีบริษัท (TMS ผ่าน gateway) — พนักงานออฟฟิศ
 *   มี @ โดเมนอื่น                     → บัญชีของระบบนี้ (Supabase Auth) — admin กับคนขับ
 *
 * **ห้ามใช้แค่ "มี @ = บัญชีระบบนี้"** เคยเขียนแบบนั้นแล้วพัง — ชื่อผู้ใช้ TMS ของที่นี่
 * เป็นรูปแบบ Laksiya.T@vespiario.net คือมี @ อยู่ในตัว พนักงานออฟฟิศทุกคนจึงถูกส่ง
 * ไปถาม Supabase แล้วเจอ "รหัสไม่ถูกต้อง" ทั้งที่รหัสถูก
 *
 * **ตัดสินก่อนส่ง ไม่ใช่ลองยิงทีละทาง** ถ้าลอง Supabase ก่อนแล้วค่อยไป TMS
 * รหัสของบริษัทจะถูกส่งขึ้นคลาวด์ทุกครั้งที่พนักงานออฟฟิศล็อกอิน ซึ่งขัดกับกติกา
 * ข้อสำคัญที่สุดของโปรเจ็คนี้ (ดู STATUS.md — รหัสบริษัทห้ามอยู่บนคลาวด์)
 * กฎ @ ตัดสินได้ตั้งแต่ก่อนมีคำขอออกไป จึงไม่มีรหัสหลงทางสักครั้งเดียว
 *
 * ข้อความใต้ฟอร์มยังเตือนเรื่องรหัสบริษัทไว้เหมือนเดิม — คนที่คุ้นกับการเห็น
 * ข้อความแบบนี้จะสังเกตออกเองเวลาเจอหน้าปลอมที่ไม่มีมัน
 */

/** โดเมนของบัญชีบริษัท — ชื่อผู้ใช้ TMS เป็นได้ทั้ง `laksiya.t` และ `Laksiya.T@vespiario.net` */
const TMS_DOMAIN = 'vespiario.net'

/** บัญชีของระบบนี้ = มี @ และไม่ใช่โดเมนบริษัท (admin@tms.local, คนขับ, อีเมลจริง) */
const isSystemAccount = (v: string): boolean =>
  v.includes('@') && !v.toLowerCase().endsWith(`@${TMS_DOMAIN}`)

export default function CloudLogin(): React.JSX.Element {
  const { loginOffice, loginDriver, pendingName } = useCloudAuth()
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const id = user.trim()
    try {
      if (isSystemAccount(id)) await loginDriver(id, password)
      else await loginOffice(id, password)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="ชื่อผู้ใช้ TMS หรืออีเมล" required>
            <Input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="เช่น Laksiya.T@vespiario.net หรือ you@tms.local"
              /* type="text" เสมอ — ใส่ type="email" ไม่ได้เพราะช่องนี้รับชื่อผู้ใช้ TMS ด้วย
                 เบราว์เซอร์จะฟ้องว่ารูปแบบผิดตั้งแต่ยังไม่ทันกดปุ่ม */
              type="text"
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
          <b>พนักงานออฟฟิศ</b> ใช้ชื่อผู้ใช้และรหัสผ่านของ <b>TMS บริษัท</b> —
          ระบบส่งไปตรวจกับ TMS ตัวจริง ไม่เก็บรหัสของคุณไว้ที่ไหนทั้งสิ้น
          เข้าครั้งแรกต้องรอผู้ดูแลอนุมัติก่อน<br />
          <b>ผู้ดูแลระบบและพนักงานขับรถ</b> ใช้อีเมลกับรหัสผ่านที่ระบบนี้ออกให้ —
          <b>ไม่ใช่รหัสของ TMS</b>
        </div>
      </form>
    </div>
  )
}
