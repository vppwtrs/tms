import { fmtNum } from '../../utils/format'
import type { OverviewCapacity } from '../../api/opsOverview'
import { unitLabel, type UnitKind } from '../../api/opsToday'

/**
 * กองรถตอนนี้
 *
 * มีเพราะคำถามที่ตามมาทันทีหลังเห็นว่างานพรุ่งนี้เกินกำลัง คือ "แล้วรถว่างกี่คัน"
 * v4 ไม่มีที่ไหนบนหน้าตอบคำถามนั้น คนต้องเปิดหน้ารถอีกแท็บเพื่อดูเลขสามตัว
 *
 * เป็นแถบ ไม่ใช่ตัวเลขเรียง — ความยาวบอกสัดส่วนได้ตั้งแต่ก่อนอ่านตัวเลข
 * ซึ่งเป็นสิ่งเดียวที่ต้องรู้ตอนกวาดตาผ่าน
 *
 * บนสุดของการ์ดคือ **หน่วยงานแยกประเภท** เพราะมันตอบว่า "งานวันนี้เป็นงานแบบไหน"
 * ซึ่งเป็นคำถามที่มาคู่กับ "แล้วรถพอไหม" เสมอ วางแยกการ์ดกันแล้วต้องกวาดตาสองที่
 *
 * ประเภทที่ฐานไม่ได้ส่งมาจะไม่ถูกวาด — ไม่วาดพาเรทเป็นศูนย์ เพราะศูนย์แปลว่า
 * "วันนี้ไม่มีงานพาเรท" ทั้งที่ความจริงคือระบบยังไม่มีข้อมูลประเภทนั้นเลย
 */

/** สีของประเภทงาน — คงที่ต่อประเภท ไม่ใช่ตามลำดับที่ฐานส่งมา
 *  ประเภทที่โผล่มาใหม่ได้สีกลาง ดีกว่าสีสลับกันไปมาทุกวันจนจำไม่ได้ */
const UNIT_CLASS: Record<string, string> = {
  vehicle: 'u-truck',
  box: 'u-box',
  pallet: 'u-pallet',
}

export function FleetNow({ capacity, units }: {
  capacity: OverviewCapacity | null
  units?: UnitKind[]
}): React.JSX.Element {
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

  const unitRows = (units ?? []).filter((u) => u.units > 0 || u.orders > 0)
  const unitTotal = unitRows.reduce((n, u) => n + u.units, 0)

  return (
    <section className="ops-fleet" aria-label="กองรถตอนนี้">
      {unitRows.length > 0 && (
        <div className="ops-units">
          <span className="ops-progress-label">หน่วยงานแยกประเภท (Unit)</span>
          <div className="ops-units-fig"><b className="num">{fmtNum(unitTotal)}</b><span>หน่วย</span></div>
          <div className="ops-unitbar">
            {unitRows.map((u) => (
              <i
                key={u.kind}
                className={UNIT_CLASS[u.kind] ?? 'u-other'}
                style={{ width: `${(u.units / (unitTotal || 1)) * 100}%` }}
              />
            ))}
          </div>
          <div className="ops-unitkeys">
            {unitRows.map((u) => (
              <span key={u.kind}>
                <i className={UNIT_CLASS[u.kind] ?? 'u-other'} />
                {unitLabel(u.kind)} <b className="num">{fmtNum(u.units)}</b>
              </span>
            ))}
          </div>
        </div>
      )}
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
