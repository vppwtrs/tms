import { useState } from 'react'
import { todayIso } from '../../utils/format'

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** แสดง yyyy-mm-dd เป็น "8 ก.ย. 69" — สั้นพอให้สองช่องอยู่บรรทัดเดียวบนจอ 375 */
export function shortThai(day: string): string {
  if (!day) return '—'
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

/**
 * ปฏิทินเลือกช่วงวันแบบมือถือ (mockup "ฟิลเตอร์วันที่")
 * แตะครั้งแรก = วันเริ่ม แตะครั้งที่สอง = วันจบ (แตะย้อนไปก่อนวันเริ่ม ระบบสลับให้เอง)
 * แตะวันเดิมซ้ำ = ดูวันเดียว วันในอนาคตแตะไม่ได้ — ประวัติไม่มีของวันพรุ่งนี้
 */
export function RangeCalendar({ from, to, onChange }: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
}): React.JSX.Element {
  const today = todayIso()
  const seed = from || today
  const [view, setView] = useState(() => ({ y: Number(seed.slice(0, 4)), m: Number(seed.slice(5, 7)) - 1 }))
  const first = new Date(view.y, view.m, 1).getDay()
  const days = new Date(view.y, view.m + 1, 0).getDate()
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]

  const pick = (d: string): void => {
    if (!from || (from && to)) { onChange(d, ''); return }
    if (d < from) onChange(d, from)
    else onChange(from, d)
  }
  const shift = (n: number): void => setView((v) => {
    const m = v.m + n
    return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }
  })
  const end = to || from

  return (
    <div className="dv-cal">
      <div className="dv-cal-ends">
        <div className={!to ? 'is-active' : ''}><small>ตั้งแต่</small><b>{shortThai(from)}</b></div>
        <div className={from && !to ? 'is-active' : ''}><small>ถึง</small><b>{shortThai(to)}</b></div>
      </div>
      <div className="dv-cal-nav">
        <button type="button" className="dv-icon-btn" aria-label="เดือนก่อน" onClick={() => shift(-1)}>‹</button>
        <b>{MONTHS[view.m]} {view.y + 543}</b>
        <button type="button" className="dv-icon-btn" aria-label="เดือนถัดไป" onClick={() => shift(1)}
          disabled={iso(view.y, view.m, 1) > today}>›</button>
      </div>
      <div className="dv-cal-grid" role="grid">
        {DOW.map((d) => <span key={d} className="dv-cal-dow">{d}</span>)}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />
          const day = iso(view.y, view.m, d)
          const edge = day === from || day === end
          const inRange = from && end && day > from && day < end
          return (
            <button
              key={day}
              type="button"
              className={`dv-cal-day${edge ? ' is-edge' : ''}${inRange ? ' is-in' : ''}${day === from ? ' is-from' : ''}${day === end ? ' is-to' : ''}${day === today ? ' is-today' : ''}`}
              disabled={day > today}
              aria-pressed={edge || Boolean(inRange)}
              aria-label={shortThai(day)}
              onClick={() => pick(day)}
            >
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}
