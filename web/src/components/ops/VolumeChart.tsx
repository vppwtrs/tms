import { fmtNum } from '../../utils/format'
import { hasReliableCapacity, isThinEstimate, type OverviewCapacity, type OverviewChart } from '../../api/opsOverview'

/**
 * ปริมาณงาน — แผนภูมิเดียวคร่อมทั้งอดีตและอนาคต
 *
 * แยกสามชุดด้วย **ความมั่นใจของข้อมูล** ไม่ใช่ด้วยความสวย
 *   เกิดขึ้นจริง   — นับจากเที่ยวที่วิ่งไปแล้ว
 *   ยืนยันแล้ว     — TMS วางแผนวันส่งไว้จริง (plan_delivery_date) เห็นล่วงหน้า 2-3 วัน
 *   ประมาณการ     — ค่าเฉลี่ยเคลื่อนที่ 4 สัปดาห์ แยกตามวันในสัปดาห์
 *
 * แท่งประมาณการใช้ **เส้นขอบประ** ไม่ใช่สีจาง เพราะสีจางพอที่จะอ่านออกว่า "ไม่แน่"
 * ก็จางเกินเกณฑ์ contrast 3:1 ของวัตถุกราฟิกไปแล้ว (เทาม่วง #b9b2d6 วัดได้ 2.02:1)
 * เส้นประยังแยกด้วยรูปทรง ไม่ใช่ด้วยสีอย่างเดียว คนตาบอดสีจึงอ่านออกด้วย
 *
 * เส้นแดงคือกำลังรับงานสูงสุด แท่งที่ชนเส้นคือคำถามที่ต้องตอบวันนี้ ไม่ใช่วันจันทร์
 */

const W = 1000
const H = 240
const PAD_L = 46
const PAD_B = 28
const PAD_T = 16

interface Bar {
  day: string
  stops: number
  kind: 'actual' | 'planned' | 'estimate'
  thin?: boolean
}

function dayLabel(iso: string): string {
  return String(Number(iso.slice(8, 10)))
}

export function VolumeChart({ chart, capacity }: {
  chart: OverviewChart
  capacity: OverviewCapacity | null
}): React.JSX.Element {
  const bars: Bar[] = [
    ...chart.actual.map((p): Bar => ({ ...p, kind: 'actual' })),
    ...chart.planned.map((p): Bar => ({ ...p, kind: 'planned' })),
    /* วันที่ TMS ยืนยันแล้ว ไม่ต้องเดาซ้ำ — ของจริงชนะของประมาณเสมอ */
    ...chart.estimate
      .filter((e) => !chart.planned.some((p) => p.day === e.day))
      .map((e): Bar => ({ day: e.day, stops: e.stops, kind: 'estimate', thin: isThinEstimate(e) })),
  ].sort((a, b) => a.day.localeCompare(b.day))

  if (bars.length === 0) {
    return <p className="ops-empty">ยังไม่มีข้อมูลปริมาณงานในช่วงนี้</p>
  }

  /* ฐานบางเกิน = ไม่วาดเส้น ไม่ใช่วาดเส้นที่ผิด — ดู hasReliableCapacity */
  const cap = hasReliableCapacity(capacity) ? (capacity?.max_stops_per_day ?? 0) : 0
  const peak = Math.max(...bars.map((b) => b.stops), cap, 1)
  /* ปัดขึ้นเป็นหลักสิบ เส้นแกนจะได้เป็นเลขกลม ๆ ที่คนอ่านเทียบด้วยตาได้ */
  const top = Math.ceil((peak * 1.1) / 20) * 20
  const plotH = H - PAD_T - PAD_B
  const slot = (W - PAD_L - 12) / bars.length
  const barW = Math.min(34, slot * 0.72)
  const y = (v: number): number => PAD_T + plotH * (1 - v / top)

  const overCap = cap > 0 ? bars.filter((b) => b.kind !== 'actual' && b.stops > cap) : []

  return (
    <>
      <div className="ops-chart-legend">
        <span><i className="sw-actual" />เกิดขึ้นจริง</span>
        <span><i className="sw-planned" />ยืนยันแล้วจาก TMS</span>
        <span><i className="sw-estimate" />ประมาณการ</span>
        {cap > 0 && <span><i className="sw-cap" />กำลังรับงาน {fmtNum(cap)} จุด/วัน</span>}
      </div>

      <div className="ops-chart-wrap">
        <svg
          width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMid meet"
          role="img"
          aria-label={
            `แผนภูมิแท่งปริมาณจุดส่งรายวัน ${chart.actual.length} วันที่ผ่านมา ` +
            `และ ${chart.planned.length + chart.estimate.length} วันข้างหน้า` +
            (overCap.length > 0 ? ` โดยมี ${overCap.length} วันที่เกินกำลังรับงาน` : '')
          }
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const v = Math.round(top * (1 - f))
            return (
              <g key={f}>
                <line className="ops-chart-grid" x1={PAD_L} y1={y(v)} x2={W - 12} y2={y(v)} />
                <text className="ops-chart-axis" x={0} y={y(v) + 4}>{v}</text>
              </g>
            )
          })}

          {bars.map((b, i) => {
            const x = PAD_L + i * slot + (slot - barW) / 2
            const h = Math.max(2, plotH * (b.stops / top))
            return (
              <g key={b.day}>
                <rect
                  className={`ops-bar is-${b.kind}${b.thin ? ' is-thin' : ''}`}
                  x={x} y={y(b.stops)} width={barW} height={h} rx={4}
                >
                  <title>
                    {`${b.day} · ${fmtNum(b.stops)} จุด · ` +
                     (b.kind === 'actual' ? 'เกิดขึ้นจริง'
                      : b.kind === 'planned' ? 'ยืนยันแล้วจาก TMS'
                      : b.thin ? 'ประมาณการ (ข้อมูลไม่ถึง 4 สัปดาห์)' : 'ประมาณการ')}
                  </title>
                </rect>
                <text className="ops-chart-axis" x={x + barW / 2} y={H - 10} textAnchor="middle">
                  {dayLabel(b.day)}
                </text>
              </g>
            )
          })}

          {/* ขีดคร่อม = ช่วงที่เคยแกว่งจริง ไม่ใช่ช่วงความเชื่อมั่นทางสถิติ */}
          {chart.estimate.map((e) => {
            const i = bars.findIndex((b) => b.day === e.day && b.kind === 'estimate')
            if (i < 0) return null
            const cx = PAD_L + i * slot + slot / 2
            return (
              <g key={`w-${e.day}`} className="ops-whisker">
                <line x1={cx} y1={y(e.high)} x2={cx} y2={y(e.low)} />
                <line x1={cx - 6} y1={y(e.high)} x2={cx + 6} y2={y(e.high)} />
                <line x1={cx - 6} y1={y(e.low)} x2={cx + 6} y2={y(e.low)} />
              </g>
            )
          })}

          {cap > 0 && (
            <g className="ops-cap-line">
              <line x1={PAD_L} y1={y(cap)} x2={W - 12} y2={y(cap)} />
              <text x={W - 14} y={y(cap) - 6} textAnchor="end">กำลังรับงาน {fmtNum(cap)}</text>
            </g>
          )}
        </svg>
      </div>

      <p className="ops-chart-note">
        ประมาณการคือค่าเฉลี่ย 4 สัปดาห์ล่าสุด <b>แยกตามวันในสัปดาห์</b> (จันทร์กับเสาร์คนละวัน)
        ขีดคร่อมคือช่วงที่<b>เคยแกว่งจริง</b> ไม่ใช่ช่วงความเชื่อมั่นทางสถิติ
        {cap > 0 && capacity
          ? ` · กำลังรับงานคิดจากรถ ${fmtNum(capacity.vehicles)} คัน คนขับ ${fmtNum(capacity.drivers)} คน และจุดเฉลี่ยต่อคันต่อวัน ${capacity.stops_per_vehicle_day} จาก ${fmtNum(capacity.sample_days)} วันที่มีงาน`
          : ' · ยังไม่แสดงเส้นกำลังรับงาน เพราะ 28 วันล่าสุดมีวันที่มีงานจริงน้อยเกินจะเฉลี่ยได้'}
      </p>

      {overCap.length > 0 && (
        <p className="ops-chart-warn">
          ⚠ {overCap.map((b) => b.day).join(' · ')} คาดว่าเกินกำลังรับงาน —
          เตรียมรถเสริมหรือเลื่อนงานที่ไม่ด่วนตั้งแต่ตอนนี้
        </p>
      )}
    </>
  )
}
