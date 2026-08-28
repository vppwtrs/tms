import { useEffect, useState } from 'react'
import { Modal } from '../ui'
import { IconChevronLeft, IconChevronRight, IconClock } from '../icons'
import { todayIso } from '../../utils/format'
import {
  WEEKDAYS, dayButtonLabel, isFutureDay, isFutureMonth, monthGrid, monthTitle, shiftMonth, ymOf,
} from '../../utils/calendar'

/**
 * เลือกวันของหน้าภาพรวม — ปุ่มเดียวบนหัวหน้า เปิดเป็นกล่องกลางจอ
 *
 * ไม่ใช้ `input[type=date]` เพราะหน้าตาต่างกันทุกเบราว์เซอร์ ปฏิทินของ Windows
 * ขึ้นเป็น ค.ศ. ซึ่งคนที่นี่อ่านผิดทันที และไม่มีที่ให้ใส่ทางลัดที่คนใช้จริง
 * (เมื่อวาน · 7 วันก่อน) ซึ่งเป็นสิ่งที่ถูกกดบ่อยกว่าการไล่หาวันในปฏิทินมาก
 *
 * ทางลัดอยู่บนสุดของกล่องด้วยเหตุผลนั้น — ปฏิทินเต็มเดือนอยู่ล่างสำหรับคนที่
 * ต้องการวันที่เจาะจงจริง ๆ ซึ่งเกิดน้อยกว่า
 *
 * วันในอนาคตกดไม่ได้ และเดือนหน้าเข้าไม่ได้ — ปุ่มที่กดแล้วไม่ได้อะไรคือปุ่มที่
 * ทำให้คนสงสัยว่าระบบพัง
 */

const SHORTCUTS: { label: string; back: number }[] = [
  { label: 'วันนี้', back: 0 },
  { label: 'เมื่อวาน', back: 1 },
  { label: '7 วันก่อน', back: 7 },
  { label: '30 วันก่อน', back: 30 },
]

function backIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return todayIso(d)
}

export function DayPicker({ value, onChange }: {
  value: string
  onChange: (iso: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => ymOf(value))

  /* เปิดกล่องแล้วต้องเห็นเดือนของวันที่เลือกอยู่เสมอ ไม่ใช่เดือนที่ค้างจากครั้งก่อน */
  useEffect(() => {
    if (open) setView(ymOf(value))
  }, [open, value])

  const today = todayIso()
  const cells = monthGrid(view.y, view.m)
  const next = shiftMonth(view.y, view.m, 1)
  const pick = (iso: string): void => {
    onChange(iso)
    setOpen(false)
  }

  return (
    <>
      <button type="button" className="ops-daybtn" onClick={() => setOpen(true)}>
        <IconClock size={15} />
        <span>{dayButtonLabel(value)}</span>
        {/* บอกให้รู้ว่ากำลังดูของเก่าอยู่ ไม่งั้นคนลืมแล้วอ่านตัวเลขเมื่อวานเป็นของวันนี้ */}
        {value !== today && <i className="ops-daybtn-mark" aria-hidden="true" />}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="เลือกวันที่ดูข้อมูล" size="md">
        <div className="daypick">
          <div className="daypick-shortcuts">
            {SHORTCUTS.map((s) => {
              const iso = backIso(s.back)
              return (
                <button
                  key={s.label}
                  type="button"
                  className={`daypick-chip${iso === value ? ' is-on' : ''}`}
                  onClick={() => pick(iso)}
                >
                  {s.label}
                </button>
              )
            })}
          </div>

          <div className="daypick-head">
            <button
              type="button"
              className="daypick-nav"
              aria-label="เดือนก่อนหน้า"
              onClick={() => setView(shiftMonth(view.y, view.m, -1))}
            >
              <IconChevronLeft size={16} />
            </button>
            <b>{monthTitle(view.y, view.m)}</b>
            <button
              type="button"
              className="daypick-nav"
              aria-label="เดือนถัดไป"
              disabled={isFutureMonth(next.y, next.m)}
              onClick={() => setView(next)}
            >
              <IconChevronRight size={16} />
            </button>
          </div>

          <div className="daypick-grid" role="grid" aria-label={monthTitle(view.y, view.m)}>
            {WEEKDAYS.map((w) => (
              <span key={w} className="daypick-dow" aria-hidden="true">{w}</span>
            ))}
            {cells.map((c, i) => (
              c.iso === null
                ? <span key={`e-${i}`} className="daypick-empty" />
                : (
                  <button
                    key={c.iso}
                    type="button"
                    className={`daypick-day${c.iso === value ? ' is-on' : ''}${c.iso === today ? ' is-today' : ''}`}
                    disabled={isFutureDay(c.iso)}
                    aria-current={c.iso === value ? 'date' : undefined}
                    onClick={() => pick(c.iso!)}
                  >
                    {c.day}
                  </button>
                )
            ))}
          </div>

          <p className="daypick-note">
            วันในอนาคตเลือกไม่ได้ — ยังไม่มีข้อมูลของวันที่ยังไม่เกิด
          </p>
        </div>
      </Modal>
    </>
  )
}
