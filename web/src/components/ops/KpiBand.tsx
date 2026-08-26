import { fmtNum } from '../../utils/format'

/**
 * แถบตัวเลขประจำวัน
 *
 * ต่างจาก StatCard ใน ui.tsx ตรงที่ตัวนี้ไม่มีไอคอนและไม่นับเลขวิ่ง — แถบนี้อยู่บนสุด
 * ของหน้าและโหลดใหม่ทุกนาที เลขที่วิ่งทุกรอบทำให้สายตาถูกดึงกลับมาที่เดิมตลอดเวลา
 * ทั้งที่ตัวเลขไม่ได้เปลี่ยน
 */

export interface KpiCell {
  label: string
  value: number
  unit?: string
  foot?: string
  tone?: 'warn' | 'danger' | 'success'
}

export function KpiBand({ cells }: { cells: KpiCell[] }): React.JSX.Element {
  return (
    <div className="ops-kpis">
      {cells.map((c) => (
        /* ศูนย์แปลว่าไม่มีอะไรต้องทำกับช่องนี้ ตัวเลขจึงต้องถอยให้ช่องที่มีของ
           ไม่ใช่ดังเท่ากันแล้วให้คนอ่านไล่ทีละใบว่าใบไหนไม่ใช่ศูนย์ */
        <div key={c.label} className={`ops-kpi${c.tone ? ` is-${c.tone}` : ''}`} data-zero={c.value === 0 ? '' : undefined}>
          <div className="ops-kpi-label">{c.label}</div>
          <div className="ops-kpi-value">
            {fmtNum(c.value)}
            {c.unit && <span className="ops-kpi-unit">{c.unit}</span>}
          </div>
          {c.foot && <div className={`ops-kpi-foot${c.tone ? ` is-${c.tone}` : ''}`}>{c.foot}</div>}
        </div>
      ))}
    </div>
  )
}
