import { fmtNum } from '../../utils/format'

/**
 * ชิ้นส่วนที่ทุกแท็บของหน้ารายงานใช้ร่วมกัน
 *
 * อยู่ที่นี่เพราะสี่แท็บต้องแสดงตัวเลขและออกไฟล์ด้วยกติกาเดียวกัน แท็บที่เขียน
 * ตัวช่วยของตัวเองจะเริ่มต่างกันทีละนิดจนคนอ่านสองแท็บเทียบกันไม่ได้
 */

/** null = ยังไม่มีตัวเลข ไม่ใช่ศูนย์ — กติกาเดียวกันทั้งหน้ารายงาน */
export function Money({ value }: { value: number | null }): React.JSX.Element {
  if (value === null) return <span className="text-muted">—</span>
  return <>{fmtNum(value)}</>
}

export function Stat({ label, value, foot }: {
  label: string
  value: React.ReactNode
  foot?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="text-xs text-muted" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      {foot && <div className="text-xs text-muted" style={{ marginTop: 6 }}>{foot}</div>}
    </div>
  )
}

export const statGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
  marginBottom: 16,
}

/* ไฟล์ออกมาเปิดด้วย Excel ไทยแล้วต้องไม่เป็นตัวยึกยือ — Excel เดาว่าเป็น ANSI
   ถ้าไม่มี BOM นำหน้า ซึ่งเป็นสิ่งแรกที่คนบ่นทุกครั้งที่ทำ CSV ภาษาไทย */
export function downloadCsv(name: string, rows: (string | number)[][]): void {
  const esc = (v: string | number): string => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const body = rows.map((r) => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
