import { fmtNum } from '../../utils/format'
import { progressRatio, type OverviewProgress } from '../../api/opsOverview'

/**
 * ไทล์หลักของหน้าภาพรวม — "วันนี้ไปถึงไหน"
 *
 * นับเป็น **จุดส่ง ไม่ใช่ใบเบิก** เพราะร้านเดียวสั่งหลายใบเป็นเรื่องปกติ นับใบทำให้
 * ตัวเลขดูเยอะกว่างานจริง และไม่ตรงกับที่คนขับเห็นบนแอป — ฐานนับให้ด้วยกติกา
 * เดียวกับ storeKey ระบบจึงมีความจริงชุดเดียว
 *
 * แถบมีสี่ช่วง ไม่ใช่สองช่วง เพราะ "ยังไม่ถึงร้าน" มีสองแบบที่แก้คนละวิธี:
 * ของที่รถถืออยู่แล้ว (รอเวลา ทำอะไรไม่ได้) กับของที่ยังไม่ออกจากคลัง (ต้องจัดรถ)
 * รวมสองอันเป็นช่องเดียวคือการซ่อนคำถามที่ต้องตัดสินใจ
 */

export function DayProgress({ data }: { data: OverviewProgress | null }): React.JSX.Element {
  const total = data?.stops_total ?? 0
  const done = data?.stops_done ?? 0
  const running = data?.stops_running ?? 0
  const waiting = data?.stops_waiting ?? 0
  const cancelled = data?.stops_cancelled ?? 0
  const ratio = progressRatio(data)

  /* หารด้วยยอดรวมทั้งหมดรวมจุดที่ยกเลิก แถบจึงยาวเต็มกรอบเสมอ ไม่มีช่องโหว่
     ที่คนดูต้องเดาว่าหายไปไหน */
  const all = total + cancelled || 1
  const pct = (n: number): string => `${(n / all) * 100}%`

  return (
    <section className="ops-progress" aria-label="ความคืบหน้าของวันนี้">
      <div className="ops-progress-head">
        <span className="ops-progress-label">ความคืบหน้าวันนี้</span>
        {total > 0 && <span className="ops-progress-pct num">{(ratio * 100).toFixed(1)}%</span>}
      </div>

      <div className="ops-progress-figure">
        <b className="num">{fmtNum(done)}</b>
        <span>/ {fmtNum(total)} จุด</span>
      </div>

      {/* ยังไม่มีจุดของวันนี้ = แถบว่าง ไม่ใช่แถบเต็ม — ศูนย์หารศูนย์ต้องอ่านว่า
          "ยังไม่เริ่ม" ไม่ใช่ "เสร็จหมดแล้ว" */}
      <div
        className="ops-progress-bar"
        role="progressbar"
        aria-label="ความคืบหน้าจุดส่งของวันนี้"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={`ส่งแล้ว ${done} จาก ${total} จุด`}
      >
        <i className="seg-done" style={{ width: pct(done) }} />
        <i className="seg-run" style={{ width: pct(running) }} />
        <i className="seg-wait" style={{ width: pct(waiting) }} />
        <i className="seg-cancel" style={{ width: pct(cancelled) }} />
      </div>

      <div className="ops-progress-legend">
        <span><i className="seg-done" />ส่งแล้ว {fmtNum(done)}</span>
        <span><i className="seg-run" />กำลังวิ่ง {fmtNum(running)}</span>
        <span><i className="seg-wait" />รอออกรถ {fmtNum(waiting)}</span>
        {/* จุดที่ยกเลิกแยกออกมา ไม่ปนกับ "รอออกรถ" เพราะไม่ใช่งานที่ยังต้องไป
            และไม่ถูกนับใน "จบครบภายในวัน" ด้วย สาเหตุอยู่ที่รางขวา */}
        {cancelled > 0 && <span><i className="seg-cancel" />ยกเลิก {fmtNum(cancelled)}</span>}
      </div>
    </section>
  )
}
