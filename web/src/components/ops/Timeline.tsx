/**
 * ไทม์ไลน์ — ลำดับเหตุการณ์ของเที่ยวหรือของจุดส่ง
 *
 * ป้ายสถานะบอกได้แค่ว่า "ตอนนี้อยู่ตรงไหน" ตอบไม่ได้ว่าค้างมานานแค่ไหนและ
 * ข้ามขั้นตอนไหนไปหรือเปล่า ซึ่งเป็นสองคำถามที่ต้องตอบตอนลูกค้าโทรมาถาม
 */

export type StepState = 'done' | 'current' | 'pending' | 'danger'

export interface TimelineStep {
  key: string
  title: string
  /* เวลาที่เกิดจริง — ขั้นที่ยังไม่ถึงไม่มีเวลา ไม่ใช่เวลาที่คาดว่าจะถึง
     เดาเวลาแล้วพิมพ์ลงหน้าจอปนกับเวลาจริง คนอ่านแยกไม่ออกว่าอันไหนเกิดแล้ว */
  time?: string | null
  note?: string | null
  state: StepState
}

export function Timeline({ steps }: { steps: TimelineStep[] }): React.JSX.Element {
  return (
    <ol className="ops-timeline">
      {steps.map((s) => (
        <li key={s.key} className={`ops-tl-item is-${s.state}`}>
          <span className="ops-tl-dot" aria-hidden />
          <div className="ops-tl-title">{s.title}</div>
          {s.time && <div className="ops-tl-time">{s.time}</div>}
          {s.note && <div className="ops-tl-note">{s.note}</div>}
        </li>
      ))}
    </ol>
  )
}
