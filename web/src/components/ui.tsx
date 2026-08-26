import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { useCountUp } from '../hooks/useCountUp'
import { IconAlert, IconX } from './icons'

/* ---------- Button ---------- */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'accent' | 'outline' | 'ghost' | 'danger' | 'success'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', loading, icon, children, className = '', disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : ''} ${className}`}
      disabled={disabled || loading}
      /* แยก "กำลังทำงาน" ออกจาก "ใช้ไม่ได้" — ปุ่มที่รอผลยังคงสีเดิม จางน้อยกว่า
         ปุ่มที่ถูกปิด และ screen reader จะประกาศว่ากำลังประมวลผล ไม่ใช่ปุ่มตาย */
      data-loading={loading ? '' : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spin" aria-hidden="true">⟳</span> : icon}
      {children}
    </button>
  )
}

/* ---------- Tabs ----------
   ใช้ตอนหน้าเดียวตอบคำถามหลายมุมของเรื่องเดียวกัน ไม่ใช่ตอนอยากยัดสองหน้าเข้าด้วยกัน

   ค่าที่เลือกอยู่ควรอยู่ใน URL — คนส่งลิงก์หากันแล้วต้องเปิดมาตรงแท็บเดิม และปุ่มย้อนกลับ
   ต้องพากลับมาแท็บก่อนหน้า ไม่ใช่เด้งออกจากหน้าไปเลย ตัวเลือกจึงรับค่ามาจากข้างนอก */
export function Tabs({ items, value, onChange, idPrefix }: {
  items: { key: string; label: string; badge?: string }[]
  value: string
  onChange: (key: string) => void
  idPrefix: string
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => {
        const on = it.key === value
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${it.key}`}
            aria-selected={on}
            aria-controls={`${idPrefix}-panel-${it.key}`}
            className={`tab${on ? ' is-on' : ''}`}
            onClick={() => onChange(it.key)}
          >
            {it.label}
            {it.badge && <span className="tab-badge">{it.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({ tabKey, value, idPrefix, children }: {
  tabKey: string
  value: string
  idPrefix: string
  children: ReactNode
}) {
  if (tabKey !== value) return null
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${tabKey}`}
      aria-labelledby={`${idPrefix}-tab-${tabKey}`}
      tabIndex={0}
    >
      {children}
    </div>
  )
}

/* ---------- MoreMenu ----------
   เมนูสำหรับงานที่ทำแล้วย้อนยาก — ยกเลิกเที่ยว ลบถาวร

   ปุ่มพวกนี้เคยวางเรียงอยู่บนหัวการ์ดปนกับปุ่มที่ใช้ทุกวัน การ์ดใบหนึ่งจึงมีปุ่มได้ถึงห้าปุ่ม
   และปุ่มที่ลบของจริงอยู่ห่างจากปุ่มที่กดทุกชั่วโมงแค่ไม่กี่พิกเซล พับเข้าเมนูแล้วสองอย่างนี้
   ไม่ได้อยู่ในระยะนิ้วเดียวกันอีก ส่วนตัวเลือกข้างในยังเขียนเต็มว่าทำอะไร ไม่ใช่ไอคอนถังขยะ */
export function MoreMenu({ label = 'อื่น ๆ', items }: {
  label?: string
  items: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[]
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  /* เมนูวาดที่ <body> ไม่ใช่ในเซลล์ตาราง — กรอบการ์ดกับ .table-wrap ตัดของที่ล้นออกนอกตัวเอง
     เมนูของแถวสุดท้ายจึงโผล่พ้นขอบการ์ดหรือโดนตัดหาย วางเป็น fixed แล้วคำนวณตำแหน่ง
     จากปุ่มเอง ทำให้มันไม่ขึ้นกับกรอบไหนเลย และพลิกขึ้นบนเมื่อที่ข้างล่างไม่พอ */
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = (): void => {
      const t = wrapRef.current?.getBoundingClientRect()
      if (!t) return
      const h = popRef.current?.offsetHeight ?? 0
      const below = window.innerHeight - t.bottom
      const up = h > 0 && below < h + 12 && t.top > h + 12
      setPos({ top: up ? t.top - h - 4 : t.bottom + 4, right: window.innerWidth - t.right })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, items.length])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const n = e.target as Node
      if (!wrapRef.current?.contains(n) && !popRef.current?.contains(n)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div className="more-menu" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ghost btn-sm more-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className={`store-caret${open ? ' is-open' : ''}`} aria-hidden="true">›</span>
      </button>
      {open && createPortal(
        <div
          className="more-menu-pop"
          role="menu"
          ref={popRef}
          /* ก่อนวัดความสูงจริงได้ ซ่อนไว้ก่อน ไม่งั้นเฟรมแรกจะกระพริบที่มุมซ้ายบน */
          style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`more-menu-item${it.danger ? ' is-danger' : ''}`}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick() }}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

/* ---------- Badge ---------- */
export function Badge({ label, tone, dot }: { label: string; tone?: string; dot?: boolean }) {
  /* ป้ายสถานะได้แถบสีซ้าย ป้ายนับจำนวนไม่ได้ — แถบข้างตัวเลขอ่านเป็นขีดเกิน
     ไม่ใช่สถานะ และตัวเลขไม่ได้ต้องการมิติที่สองอยู่แล้ว เพราะมันเทียบกันเองได้
     ป้ายที่มีจุดอยู่แล้วก็ไม่เอาซ้ำ จุดทำหน้าที่เดียวกัน */
  const isCount = /^\d[\d,.\s]*$/.test(label)
  const status = !dot && !isCount
  return (
    <span className={`badge badge-${tone ?? 'pending'}${status ? ' badge-status' : ''}`}>
      {dot && <span className="dot" />}
      {label}
    </span>
  )
}

/* ---------- Form fields ---------- */
export function Field({ label, required, error, children, hint }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  // ผูก label ↔ control ผ่าน id ที่สร้างเอง — ช่วย screen reader (WCAG 1.3.1)
  const controlId = useId()
  const msgId = `${controlId}-msg`
  /* ผูก control เข้ากับข้อความ error/hint ด้วย aria-describedby + aria-invalid
     ไม่งั้นคนใช้ screen reader จะได้ยินแค่ชื่อฟิลด์ ไม่รู้ว่ากรอกผิดตรงไหน */
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>, {
        id: controlId,
        'aria-describedby': error || hint ? msgId : undefined,
        'aria-invalid': error ? true : undefined,
      })
    : children
  return (
    <div className="field">
      <label htmlFor={controlId}>
        {label} {required && <span className="req">*</span>}
      </label>
      {control}
      {error ? (
        <span className="field-error" id={msgId}>{error}</span>
      ) : hint ? (
        <span className="text-xs text-muted" id={msgId}>{hint}</span>
      ) : null}
    </div>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select" {...props} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="textarea" {...props} />
}

/* ---------- Toggle ----------
   สวิตช์เปิด/ปิด — ใช้ <button role="switch"> ไม่ใช่ checkbox ที่ตกแต่ง
   เพราะ screen reader อ่าน "เปิด/ปิด" ตรงกับสิ่งที่เห็น และคุมขนาดปุ่มให้
   แตะได้จริงบนมือถือได้ (พื้นที่แตะ 44px ตาม WCAG 2.2 · 2.5.8) */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  tone,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
  tone?: 'warn'
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`toggle-row${checked ? ' on' : ''}${tone === 'warn' ? ' warn' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <span className="toggle-track" aria-hidden>
        <span className="toggle-knob" />
      </span>
    </button>
  )
}

/* ---------- Modal ---------- */
interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  /* sheet = แผ่นเต็มความสูงบนมือถือ หัวกับท้ายตรึงอยู่กับที่ เนื้อในเลื่อนเอง
     ใช้กับฟอร์มที่คนกรอกยืนอยู่หน้าร้าน ไม่ได้นั่งจ้องจอ — ปุ่มบันทึกต้องอยู่
     ในระยะนิ้วโป้งเสมอ ไม่ใช่ต้องเลื่อนลงไปหา */
  size?: 'md' | 'lg' | 'sheet'
  /* คลาสเสริมบนแผ่น — ใช้เปลี่ยนผิวเฉพาะแผ่น เช่นจอถ่ายรูปที่บอร์ดกำหนดให้เป็นพื้นเข้ม */
  className?: string
}

const MODAL_SIZE_CLASS: Record<'md' | 'lg' | 'sheet', string> = {
  md: '',
  lg: 'modal-lg',
  sheet: 'modal-sheet',
}

export function Modal({ open, onClose, title, children, footer, size = 'md', className = '' }: ModalProps) {
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return <></>
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-panel ${MODAL_SIZE_CLASS[size]}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <h3 className="modal-title" id={titleId}>{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="ปิด" className="btn-icon">
            <IconX size={16} />
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

/* ---------- ConfirmDialog ---------- */
interface ConfirmProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'ยืนยัน', danger, loading, onConfirm, onClose }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            ยกเลิก
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-md" style={{ lineHeight: 1.7 }}>
        {message}
      </div>
    </Modal>
  )
}

/* ---------- Skeleton ---------- */
export function Skeleton({ width = '100%', height = 16, style }: { width?: string | number; height?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width, height, ...style }} />
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i}>
                <Skeleton width={70} height={10} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <Skeleton width={40 + ((r * 7 + c * 13) % 60)} height={13} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- EmptyState ---------- */
export function EmptyState({ icon, title, desc, action }: { icon?: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="icon">{icon}</div>
      <h2>{title}</h2>
      {desc && <p className="text-sm" style={{ marginTop: 4 }}>{desc}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

/* ---------- Pagination ---------- */
export function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (p: number) => void }) {
  if (total === 0) return null
  return (
    <div className="pagination">
      <span>
        ทั้งหมด {total.toLocaleString('th-TH')} รายการ
      </span>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ก่อนหน้า
      </Button>
      <span>
        หน้า {page} / {totalPages}
      </span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        ถัดไป
      </Button>
    </div>
  )
}

/* ---------- StatCard ---------- */
export function StatCard({ label, value, symbol, icon, tone, foot, trend }: { label: string; value: number | string; symbol?: string; icon: ReactNode; tone: string; foot?: ReactNode; trend?: { dir: 'up' | 'down' | 'flat'; text: string } }) {
  /* เรียก hook ไม่มีเงื่อนไขเสมอ แล้วค่อยเลือกว่าจะใช้ผลของมันไหม
     ของเดิมเขียน `typeof value === 'number' ? useCountUp(value) : value` ซึ่งแปลว่า
     การ์ดใบเดียวกันเรียก hook บ้างไม่เรียกบ้างตามชนิดของค่าที่ส่งเข้ามา
     วันที่ค่าเปลี่ยนจากตัวเลขเป็นข้อความ (เช่น "—" ตอนโหลดไม่ได้) React จะพังทั้งหน้า */
  const counted = useCountUp(typeof value === 'number' ? value : 0)
  const shown = typeof value === 'number' ? counted : value
  const arrow = trend ? (trend.dir === 'up' ? '▲' : trend.dir === 'down' ? '▼' : '•') : ''
  const trendColor = trend ? (trend.dir === 'up' ? 'var(--success)' : trend.dir === 'down' ? 'var(--danger)' : 'var(--muted)') : undefined
  return (
    <div className="card card-hover stat-card">
      <div className="stat-icon" style={{ background: `var(--${tone}-050)`, color: `var(--${tone})` }}>
        {icon}
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {typeof shown === 'number' ? shown.toLocaleString('th-TH') : shown}
        {symbol && <span className="text-lg" style={{ color: 'var(--muted)', fontWeight: 600 }}> {symbol}</span>}
      </div>
      {trend && (
        <div className="stat-foot">
          <span style={{ color: trendColor, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{arrow}</span>
          <span style={{ color: trendColor, fontWeight: 700 }}>{trend.text}</span>
        </div>
      )}
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  )
}

/* ---------- PageHeader ---------- */
/* หัวหน้าจอ
 *
 * เดิมหัวเรื่อง คำอธิบาย และแถบตัวกรอง ต่างคนต่างกินแถวเต็มความกว้างของตัวเอง
 * บนจอ 1440 หัวเรื่องใช้ความกว้างจริงไม่ถึงหนึ่งในเจ็ดของแถว ที่เหลือว่างเปล่า
 * แล้วแถบตัวกรองซึ่งมีของอยู่สองสามชิ้นก็กินอีกแถวเต็ม ๆ รวมแล้วเสียความสูงร้อยกว่า
 * พิกเซลก่อนถึงข้อมูลจริง ทุกหน้า ทุกครั้งที่เปิด
 *
 * ตัวกรองจึงขึ้นไปอยู่แถวเดียวกับหัวเรื่อง ชิดขวา ที่ว่างที่มีอยู่แล้วถูกใช้แทนที่จะ
 * ไปเบียดความสูง จอแคบค่อยตกลงมาเป็นแถวของตัวเอง ซึ่งตอนนั้นความกว้างหมดจริง
 * ไม่ใช่การเสียของ */
export function PageHeader({ title, subtitle, actions, filters }: { title: string; subtitle?: string; actions?: ReactNode; filters?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {filters && <div className="page-head-filters">{filters}</div>}
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  )
}

/* ---------- HelpTip — อธิบายศัพท์ (native tooltip + a11y) ---------- */
export function HelpTip({ text }: { text: string }) {
  return (
    <button type="button" className="help-tip" aria-label={`คำอธิบาย: ${text}`} title={text}>
      ?
    </button>
  )
}

/* ---------- SearchInput ---------- */
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search-box">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'ค้นหา...'} />
    </div>
  )
}

/* ---------- ErrorBox ----------
 *
 * เดิมเป็นการ์ดสูงสี่สิบพิกเซลจัดกลางพร้อม emoji ⚠️ ซึ่งมีปัญหาสองชั้น
 *
 * ชั้นแรก emoji ถูกวาดโดยฟอนต์ของระบบปฏิบัติการ หน้าตาจึงไม่เหมือนกันสักเครื่อง
 * และไม่เข้ากับไอคอนเส้นชุดที่ใช้ทั้งระบบ ที่หนักกว่าคือโปรแกรมอ่านหน้าจอจะอ่าน
 * ออกเสียงว่า "สัญลักษณ์เตือน" ก่อนถึงข้อความจริงทุกครั้ง
 *
 * ชั้นที่สอง ของที่พังมักพังแค่ส่วนเดียวของหน้า ไม่ใช่ทั้งหน้า การจัดกลางในกล่องสูง ๆ
 * ทำให้มันกินพื้นที่เท่าเนื้อหาหลักและผลักของที่ยังใช้ได้ตกจอ กลายเป็นแถบแนวนอน
 * อ่านจากซ้ายไปขวาเหมือนประโยค: มีอะไรผิด แล้วทำอะไรต่อ */
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <IconAlert size={18} aria-hidden="true" />
      <span>{message}</span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>ลองใหม่</Button>
      )}
    </div>
  )
}
