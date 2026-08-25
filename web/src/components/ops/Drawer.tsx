import { useEffect, useId } from 'react'
import { IconX } from '../icons'

/**
 * แผงรายละเอียดที่เลื่อนเข้ามาจากขวา
 *
 * ใช้แทน modal เฉพาะกรณี "กดแถวแล้วดูรายละเอียด" เพราะคนที่เปิดดูยังต้องเห็นรายการ
 * ที่ค้างอยู่ข้างหลัง — modal ทึบตรงกลางทำให้ลืมว่ากำลังไล่ถึงแถวไหน
 * ฟอร์มทุกตัวยังเป็น modal เหมือนเดิม ตรงนั้นควรบังจอ เพราะทำงานอื่นระหว่างกรอกไม่ได้
 *
 * ยืมกลไกเดียวกับ Modal ใน ui.tsx: Esc ปิด และล็อกสกอลล์ของหน้าหลังไว้
 */

export function Drawer({
  open, onClose, title, subtitle, children, footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
}): React.JSX.Element {
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
    <>
      <div className="ops-drawer-scrim" onMouseDown={onClose} />
      <aside className="ops-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ops-drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="ops-drawer-title" id={titleId}>{title}</h2>
            {subtitle && <div className="ops-drawer-sub">{subtitle}</div>}
          </div>
          <button type="button" className="ops-drawer-close" onClick={onClose} aria-label="ปิด">
            <IconX size={16} />
          </button>
        </div>
        <div className="ops-drawer-body">{children}</div>
        {footer && <div className="ops-drawer-foot">{footer}</div>}
      </aside>
    </>
  )
}
