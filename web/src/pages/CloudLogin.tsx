import { useEffect, useState, type FormEvent } from 'react'
import { useCloudAuth } from '../context/CloudAuthContext'
import { Button, Field, Input } from '../components/ui'
import { IconPin, IconRoute, IconShield } from '../components/icons'
import { takeSignedOutReason } from '../api/tmsAuth'

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
  const { loginOffice, loginDriver, logout, pendingName } = useCloudAuth()
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  /* อ่านครั้งเดียวตอน mount แล้วค่าถูกลบทิ้ง — ไม่งั้นข้อความค้างข้ามการล็อกอินรอบถัดไป
     แล้วคนอ่านจะคิดว่าเพิ่งโดนเด้งออกอีกครั้งทั้งที่ไม่ได้เกิดอะไรขึ้น */
  const [signedOutReason] = useState(() => takeSignedOutReason())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  /* สถานะรออนุมัติเป็นเพียงข้อความแจ้งเตือน ไม่ควรค้าง session บริษัทไว้บนหน้านี้
     หลังแสดงผลสั้น ๆ ให้ออกจากระบบและกลับมาที่ฟอร์ม login พร้อมใช้งาน */
  useEffect(() => {
    if (!pendingName) return
    const timer = window.setTimeout(() => { void logout() }, 4000)
    return () => window.clearTimeout(timer)
  }, [pendingName])

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const id = user.trim()
    try {
      if (isSystemAccount(id)) {
        await loginDriver(id, password)
      } else {
        /* ไม่มี @ = เดาว่าเป็นบัญชี TMS บริษัท แต่เดาผิดได้ — ชื่อผู้ใช้ที่ระบบนี้ออกให้
           ก็ไม่มี @ เหมือนกัน (ระบบเก็บเป็น <ชื่อ>@tms.local แล้วตัดโดเมนตอนแสดงผล)
           คนขับที่พิมพ์ชื่อตามที่หน้าจอบอกจึงถูกส่งไปตรวจกับ TMS แล้วไม่ผ่านตลอด
           ลองทางบริษัทก่อนตามเดิม ไม่ผ่านค่อยลองเป็นบัญชีของระบบนี้ */
        try {
          await loginOffice(id, password)
        } catch (officeError) {
          try {
            await loginDriver(id, password)
          } catch {
            throw officeError
          }
        }
      }
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
            แจ้งหัวหน้าให้เข้าไปอนุมัติที่หน้าผู้ใช้ ระบบจะกลับไปหน้าเข้าสู่ระบบภายในไม่กี่วินาที
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="ops-login">
      {/* แผงซ้าย — ตกแต่งล้วน ไม่มีของที่ต้องกด บนจอแคบเหลือแค่หัวเรื่อง (ops.css) */}
      <aside className="ops-login-art ops-dark">
        <div className="ops-login-brand">
          <img src={`${import.meta.env.BASE_URL}login-logo.png`} alt="" width={34} height={34} style={{ borderRadius: 10, objectFit: 'cover' }} />
          ทรานส์พลัส TMS
        </div>
        <div className="ops-login-lead">
          <h2>ศูนย์ควบคุมงานขนส่ง<br />ในหน้าจอเดียว</h2>
          <p>วางแผนเที่ยว จ่ายงานให้คนขับ ติดตามรถตามเวลาจริง และเก็บหลักฐานการส่งครบทุกจุด</p>
          <ul className="ops-login-points">
            <li><IconRoute size={16} /> วางแผนและจ่ายงานจากกระดานเดียว</li>
            <li><IconPin size={16} /> ติดตามตำแหน่งรถระหว่างวิ่ง</li>
            <li><IconShield size={16} /> หลักฐานการส่งพร้อมลายเซ็นและรูป</li>
          </ul>
        </div>
        <div className="ops-login-foot">ทรานส์พลัส TMS · คลาวด์</div>
      </aside>

      <div className="ops-login-form">
      <form className="login-card" onSubmit={submit}>
        <div className="logo-big">
          {/* โลโก้จริงของแอป — รถบรรทุกขนส่ง (วงกลม ขอบขาวทำใน CSS) */}
          <img src={`${import.meta.env.BASE_URL}login-logo.png`} alt="" width={72} height={72} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
        <h1>ระบบบริหารจัดการขนส่ง</h1>
        <p className="login-sub">Transport Management System</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* คนที่มาถึงหน้านี้เพราะถูกพาออกมา ไม่ได้ตั้งใจมาเอง เขาเพิ่งพิมพ์รหัสไปเมื่อกี้
              ถ้าไม่บอกเหตุผล สิ่งที่เขาสรุปคือระบบพัง ไม่ใช่ token หมดอายุตามกำหนด */}
          {signedOutReason && !error && (
            <div className="login-notice" role="status">{signedOutReason}</div>
          )}
          <Field label="ชื่อผู้ใช้ TMS หรืออีเมล" required>
            <Input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="เช่น ชื่อผู้ใช้ TMS, @vespiario.net หรืออีเมลระบบ"
              /* type="text" เสมอ — ใส่ type="email" ไม่ได้เพราะช่องนี้รับชื่อผู้ใช้ TMS ด้วย
                 เบราว์เซอร์จะฟ้องว่ารูปแบบผิดตั้งแต่ยังไม่ทันกดปุ่ม */
              type="text"
              autoFocus
              autoComplete="username"
            />
          </Field>
          <Field label="รหัสผ่าน" required>
            {/* คนขับพิมพ์รหัสบนจอมือถือกลางแดด พิมพ์ผิดแล้วไม่มีทางรู้จนกว่าจะโดนปฏิเสธ
                แล้วต้องพิมพ์ใหม่ทั้งชุด ปุ่มดูรหัสเป็นทางเดียวที่ตรวจเองได้ก่อนกดส่ง
                ค่าเริ่มต้นยังปิดไว้ — คนที่ยืนอยู่ข้างหลังไม่ควรเห็นโดยที่เจ้าตัวไม่ได้เลือก */}
            <div className="pw-field">
              <Input type={showPw ? 'text' : 'password'} value={password}
                     onChange={(e) => setPassword(e.target.value)}
                     placeholder="••••••••" autoComplete="current-password" />
              <button type="button" className="pw-toggle" onClick={() => setShowPw((v) => !v)}
                      aria-pressed={showPw} aria-label={showPw ? 'ซ่อนรหัสผ่าน' : 'ดูรหัสผ่าน'}>
                {showPw ? 'ซ่อน' : 'ดู'}
              </button>
            </div>
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
    </div>
  )
}
