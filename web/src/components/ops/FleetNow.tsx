import { fmtNum } from '../../utils/format'
import type { OverviewCapacity } from '../../api/opsOverview'

/**
 * กองรถตอนนี้
 *
 * มีเพราะคำถามที่ตามมาทันทีหลังเห็นว่างานพรุ่งนี้เกินกำลัง คือ "แล้วรถว่างกี่คัน"
 * v4 ไม่มีที่ไหนบนหน้าตอบคำถามนั้น คนต้องเปิดหน้ารถอีกแท็บเพื่อดูเลขสามตัว
 *
 * เป็นแถบ ไม่ใช่ตัวเลขเรียง — ความยาวบอกสัดส่วนได้ตั้งแต่ก่อนอ่านตัวเลข
 * ซึ่งเป็นสิ่งเดียวที่ต้องรู้ตอนกวาดตาผ่าน
 */

export function FleetNow({ capacity }: { capacity: OverviewCapacity | null }): React.JSX.Element {
  if (!capacity) {
    return (
      <section className="ops-fleet" aria-label="กองรถตอนนี้">
        <span className="ops-progress-label">กองรถตอนนี้</span>
        <p className="ops-empty">สิทธิ์ไม่ถึงข้อมูลรถ</p>
      </section>
    )
  }

  const fleet = capacity.vehicles_running + capacity.vehicles_free + capacity.vehicles_off
  /* ไม่มีรถในระบบเลยก็ยังต้องวาดแถบว่าง ไม่ใช่หารด้วยศูนย์ */
  const pct = (n: number): string => `${(n / (fleet || 1)) * 100}%`

  const rows = [
    { label: 'วิ่งอยู่', value: capacity.vehicles_running, cls: 'm-run' },
    { label: 'ว่าง', value: capacity.vehicles_free, cls: 'm-free' },
    { label: 'ซ่อม/หยุด', value: capacity.vehicles_off, cls: 'm-off' },
  ]

  return (
    <section className="ops-fleet" aria-label="กองรถตอนนี้">
      <span className="ops-progress-label">กองรถตอนนี้</span>
      {rows.map((r) => (
        <div key={r.label} className="ops-fleet-row">
          <span>{r.label}</span>
          <div className="ops-meter"><i className={r.cls} style={{ width: pct(r.value) }} /></div>
          <b className="num">{fmtNum(r.value)}</b>
        </div>
      ))}
      {/* คนขับว่างเป็นเพดานจริงของการจ่ายงาน รถว่างสิบคันแต่คนขับว่างคนเดียว
          ก็ปล่อยได้เที่ยวเดียว จึงต้องอยู่ในสายตาเดียวกับรถ */}
      <div className="ops-fleet-row is-driver">
        <span>คนขับว่าง</span>
        <div className="ops-meter">
          <i className="m-free" style={{ width: `${(capacity.drivers_free / (capacity.drivers || 1)) * 100}%` }} />
        </div>
        <b className="num">{fmtNum(capacity.drivers_free)}</b>
      </div>
    </section>
  )
}
