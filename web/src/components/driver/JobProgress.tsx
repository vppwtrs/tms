import type { MyJob } from '../../types'

/**
 * แถบขั้นตอนของเที่ยววิ่ง — บอกว่าตอนนี้อยู่ตรงไหนของงาน
 *
 * แอปส่งของทุกเจ้ามีแถบนี้เพราะคนขับเปิดดูตอนจอดข้างทาง แล้วต้องรู้ใน 1 วินาที
 * ว่าทำอะไรไปแล้วบ้าง เหลืออะไร — badge สถานะเดี่ยว ๆ ตอบคำถามนี้ไม่ได้
 *
 * 4 ขั้นอ่านจากข้อมูลจริงทั้งหมด ไม่มี state แยกให้หลุดจากความจริง
 */
export function JobProgress({ job }: { job: MyJob }): React.JSX.Element {
  const delivered = job.orders.filter((o) => o.status === 'delivered').length
  const steps = [
    { label: 'รับงาน', done: true },
    { label: 'ออกรถ', done: job.status !== 'planned' },
    /* ต้องส่งครบทุกจุดถึงนับว่าเสร็จ — ถ้านับตั้งแต่จุดแรก แถบจะขึ้นเขียว
       ทั้งที่ยังเหลืออีกหลายจุด แล้วคนขับอ่านแล้วเข้าใจผิดว่าจบงานได้ */
    { label: `ส่งของ ${delivered}/${job.orders.length}`, done: job.orders.length > 0 && delivered === job.orders.length },
    { label: 'ปิดงาน', done: job.status === 'completed' },
  ]
  // ขั้นที่กำลังทำ = ขั้นแรกที่ยังไม่เสร็จ
  const current = steps.findIndex((s) => !s.done)

  return (
    <ol className="job-progress" aria-label="ความคืบหน้าของเที่ยววิ่ง">
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={`job-progress-step${s.done ? ' is-done' : ''}${i === current ? ' is-current' : ''}`}
          aria-current={i === current ? 'step' : undefined}
        >
          <span className="job-progress-dot" aria-hidden="true" />
          <span className="job-progress-label">{s.label}</span>
        </li>
      ))}
    </ol>
  )
}
