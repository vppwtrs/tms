import { useEffect, useState } from 'react'
import { Modal } from '../ui'
import { IconChevronLeft, IconChevronRight, IconClock } from '../icons'
import { todayIso } from '../../utils/format'
import {
  WEEKDAYS, inRange, isFutureDay, isFutureMonth, lastDays, monthGrid, monthTitle,
  monthToDate, rangeButtonLabel, shiftMonth, ymOf,
} from '../../utils/calendar'

/**
 * เลือกช่วงวันของหน้าภาพรวม — ปุ่มเดียวบนหัวหน้า เปิดเป็นกล่องกลางจอ
 *
 * เลือกได้ทั้ง **วันเดียว** และ **ช่วงวัน**: กดวันแรกแล้วกดวันที่สอง
 * กดวันเดิมซ้ำ = ดูวันเดียว ซึ่งเป็นสิ่งที่ใช้บ่อยที่สุด จึงต้องทำได้ด้วยสองคลิก
 * โดยไม่ต้องสลับโหมดอะไรก่อน — โหมดที่ต้องเลือกก่อนใช้คือขั้นตอนที่คนลืมทุกครั้ง
 *
 * ไม่ใช้ `input[type=date]` สองช่อง เพราะหน้าตาต่างกันทุกเบราว์เซอร์ ปฏิทินของ
 * Windows ขึ้นเป็น ค.ศ. ซึ่งคนที่นี่อ่านผิดทันที และช่องคู่เปิดโอกาสให้ใส่ช่วง
 * กลับหัว (เริ่มหลังสิ้นสุด) ซึ่งต้องมีข้อความ error มารองรับอีก
 *
 * ทางลัดอยู่บนสุดเพราะถูกกดบ่อยกว่าการไล่หาวันในปฏิทินมาก ปฏิทินเต็มเดือน
 * อยู่ล่างสำหรับช่วงที่เจาะจงจริง ๆ
 */

interface Range { from: string; to: string }

function shortcuts(): { label: string; range: Range }[] {
  const t = todayIso()
  const y = new Date()
  y.setDate(y.getDate() - 1)
  return [
    { label: 'วันนี้', range: { from: t, to: t } },
    { label: 'เมื่อวาน', range: { from: todayIso(y), to: todayIso(y) } },
    { label: '7 วันล่าสุด', range: lastDays(7) },
    { label: '30 วันล่าสุด', range: lastDays(30) },
    { label: 'เดือนนี้', range: monthToDate() },
  ]
}

export function DayPicker({ value, onChange }: {
  value: Range
  onChange: (range: Range) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => ymOf(value.to))
  /* วันแรกที่กดค้างไว้ระหว่างรอวันที่สอง — null = ยังไม่เริ่มเลือกช่วงใหม่ */
  const [start, setStart] = useState<string | null>(null)

  /* เปิดกล่องแล้วต้องเห็นเดือนของช่วงที่เลือกอยู่ และเริ่มเลือกใหม่ทุกครั้ง
     ไม่ใช่ค้างครึ่งทางจากรอบก่อนซึ่งทำให้คลิกแรกกลายเป็นการปิดช่วงเก่า */
  useEffect(() => {
    if (open) {
      setView(ymOf(value.to))
      setStart(null)
    }
  }, [open, value.to])

  const today = todayIso()
  const cells = monthGrid(view.y, view.m)
  const next = shiftMonth(view.y, view.m, 1)

  const commit = (range: Range): void => {
    onChange(range)
    setOpen(false)
  }

  const clickDay = (iso: string): void => {
    if (start === null) {
      setStart(iso)
      return
    }
    /* กดย้อนขึ้นไปก่อนวันแรกก็ใช้ได้ — สลับให้เอง ดีกว่าบอกว่าเลือกผิด */
    commit(start <= iso ? { from: start, to: iso } : { from: iso, to: start })
  }

  return (
    <>
      <button type="button" className="ops-daybtn" onClick={() => setOpen(true)}>
        <IconClock size={15} />
        <span>{rangeButtonLabel(value.from, value.to)}</span>
        {/* บอกให้รู้ว่าไม่ได้ดูของวันนี้ ไม่งั้นคนลืมแล้วอ่านตัวเลขย้อนหลังเป็นของวันนี้ */}
        {!(value.from === today && value.to === today) && <i className="ops-daybtn-mark" aria-hidden="true" />}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="เลือกช่วงวันที่ดูข้อมูล" size="md">
        <div className="daypick">
          <div className="daypick-shortcuts">
            {shortcuts().map((s) => (
              <button
                key={s.label}
                type="button"
                className={`daypick-chip${s.range.from === value.from && s.range.to === value.to ? ' is-on' : ''}`}
                onClick={() => commit(s.range)}
              >
                {s.label}
              </button>
            ))}
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
            {cells.map((c, i) => {
              if (c.iso === null) return <span key={`e-${i}`} className="daypick-empty" />
              const iso = c.iso
              /* ระหว่างเลือก ให้เน้นเฉพาะวันแรกที่กดไว้ ไม่ใช่ช่วงเก่าที่กำลังจะถูกแทนที่ */
              const on = start !== null ? iso === start : inRange(iso, value.from, value.to)
              const edge = start !== null
                ? iso === start
                : iso === value.from || iso === value.to
              return (
                <button
                  key={iso}
                  type="button"
                  className={
                    `daypick-day${on ? ' is-in' : ''}${edge ? ' is-on' : ''}`
                    + `${iso === today ? ' is-today' : ''}`
                  }
                  disabled={isFutureDay(iso)}
                  aria-current={edge ? 'date' : undefined}
                  onClick={() => clickDay(iso)}
                >
                  {c.day}
                </button>
              )
            })}
          </div>

          <p className="daypick-note">
            {start === null
              ? 'กดวันเริ่ม แล้วกดวันสิ้นสุด · กดวันเดิมซ้ำเพื่อดูวันเดียว'
              : 'เลือกวันสิ้นสุด — วันในอนาคตเลือกไม่ได้'}
          </p>
        </div>
      </Modal>
    </>
  )
}
