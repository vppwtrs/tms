import { fmtKm, fmtMoney, fmtNum } from '../../utils/format'
import { volumeLabel } from '../../api/opsToday'
import type { VehicleUsage, VehicleUsageGrain, VehicleUsagePoint } from '../../api/vehicles'
import { smoothPath } from '../../utils/curve'
import { EmptyState, TableSkeleton } from '../ui'
import { IconClock } from '../icons'

/**
 * รายละเอียดการใช้รถคันเดียว — สองกราฟเส้นอิสระ (ระยะทาง/ค่าทางด่วน) + อันดับคนขับ
 *
 * กราฟทั้งสองสเกลด้วยค่าสูงสุดของตัวเอง ไม่ใช้แกนร่วม เพราะหน่วยคนละอย่าง (กม./บาท)
 * ใช้ monotone cubic เดียวกับ VolumeTrend กันเส้นเหวี่ยงเกินค่าจริงตอนข้อมูลเป็นศูนย์ติดกัน
 *
 * ตัวเลขกำกับบนจุด: ใส่เฉพาะจุดที่ไม่ใช่ศูนย์ (เหมือน ops-vlabel) — วันที่ไม่มีงาน
 * ไม่ต้องเขียนเลขศูนย์ซ้ำ ตัวเลขห้าหกตัวติดกันจะกินสายตาไปจากวันที่มีของจริง
 */

const W = 480
const H = 190
const PAD_T = 30
const PAD_B = 24
const PAD_X = 10

const GRAINS: { key: VehicleUsageGrain; label: string }[] = [
  { key: 'day', label: 'วัน' },
  { key: 'month', label: 'เดือน' },
  { key: 'year', label: 'ปี' },
]

function LineChart({ points, grain, color, value, fmt }: {
  points: VehicleUsagePoint[]
  grain: VehicleUsageGrain
  color: string
  value: (p: VehicleUsagePoint) => number
  fmt: (n: number) => string
}): React.JSX.Element {
  const max = Math.max(1, ...points.map(value))
  const base = H - PAD_B
  const span = (W - PAD_X * 2) / Math.max(1, points.length - 1 || 1)
  const cx = (i: number): number => points.length === 1 ? W / 2 : PAD_X + span * i
  const cy = (n: number): number => base - ((base - PAD_T) * n) / max
  const line = smoothPath(points.map((p, i) => ({ x: cx(i), y: cy(value(p)) })))

  /* ป้ายแกนวันขึ้นชิดกันเกินไปถ้าเขียนทุกจุด — ข้ามให้เหลือ ~6 ป้ายพอ */
  const axisStep = Math.max(1, Math.ceil(points.length / 6))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="กราฟย้อนหลัง">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={PAD_X} y1={base - (base - PAD_T) * f} x2={W - PAD_X} y2={base - (base - PAD_T) * f} className="vu-grid" />
      ))}
      {line && <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />}
      {points.map((p, i) => {
        const v = value(p)
        if (v <= 0) return null
        return (
          <g key={p.key}>
            <circle cx={cx(i)} cy={cy(v)} r={i === points.length - 1 ? 3.5 : 2.5} fill={color} />
            <text x={cx(i)} y={cy(v) - 8} className="vu-point-label" textAnchor="middle">{fmt(v)}</text>
          </g>
        )
      })}
      {points.map((p, i) => (
        i % axisStep === 0 || i === points.length - 1 ? (
          <text key={`ax-${p.key}`} x={cx(i)} y={H - 4} className="vu-axis-label" textAnchor="middle">
            {volumeLabel(p.key, grain)}
          </text>
        ) : null
      ))}
    </svg>
  )
}

export function VehicleUsagePanel({ data, grain, onGrain, loading, error }: {
  data: VehicleUsage | null
  grain: VehicleUsageGrain
  onGrain: (g: VehicleUsageGrain) => void
  loading: boolean
  error: string
}): React.JSX.Element {
  const points = data?.points ?? []
  const drivers = data?.drivers ?? []
  const totalKm = points.reduce((s, p) => s + p.distance_km, 0)
  const totalToll = points.reduce((s, p) => s + p.toll_cost, 0)
  const maxHours = Math.max(1, ...drivers.map((d) => d.hours))

  return (
    <div className="vu-panel">
      <div className="vu-panel-head">
        <div className="ops-lens" role="group" aria-label="ช่วงเวลาของกราฟ">
          {GRAINS.map((g) => (
            <button key={g.key} type="button" aria-pressed={g.key === grain} onClick={() => onGrain(g.key)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-danger">{error}</p>
      ) : loading ? (
        <TableSkeleton rows={4} cols={1} />
      ) : (
        <>
          <div className="vu-charts">
            <div className="vu-chart">
              <div className="vu-chart-head">
                <span className="vu-dot" style={{ background: 'var(--blue-500)' }} />
                ระยะทางวิ่ง (กม.)
                <b className="vu-total">รวม {fmtKm(totalKm)}</b>
              </div>
              <LineChart points={points} grain={grain} color="var(--blue-500)" value={(p) => p.distance_km} fmt={(n) => fmtNum(Math.round(n))} />
            </div>
            <div className="vu-chart">
              <div className="vu-chart-head">
                <span className="vu-dot" style={{ background: 'var(--warn)' }} />
                ค่าทางด่วน (บาท)
                <b className="vu-total">รวม {fmtMoney(totalToll)}</b>
              </div>
              <LineChart points={points} grain={grain} color="var(--warn)" value={(p) => p.toll_cost} fmt={(n) => fmtMoney(n)} />
            </div>
          </div>

          <div className="vu-rank">
            <div className="vu-rank-head">มุมมองการใช้รถ — คนขับที่ใช้คันนี้เยอะสุด <span className="text-muted">(ชั่วโมง ออกรถ→คืนรถ)</span></div>
            {drivers.length === 0 ? (
              <EmptyState icon={<IconClock size={28} />} title="ยังไม่มีข้อมูล" desc="ต้องมีเที่ยวที่มีเวลาออกรถและคืนรถครบก่อน" />
            ) : (
              drivers.map((d, i) => (
                <div className="vu-rank-row" key={d.driver_id}>
                  <span className="vu-rank-no">{i + 1}</span>
                  <span className="vu-rank-name">{d.driver_name}</span>
                  <div className="vu-rank-bar"><i style={{ width: `${Math.max(4, (d.hours / maxHours) * 100)}%` }} /></div>
                  <span className="vu-rank-hr">{d.hours.toLocaleString('th-TH')} ชม. <span className="text-muted">· {d.trips} เที่ยว</span></span>
                </div>
              ))
            )}
          </div>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>ระยะทางนับเฉพาะเที่ยวที่มีเลขไมล์ออกรถ+จบงานครบ (เที่ยวที่ไม่มีเลขไมล์จะไม่ถูกนับ ไม่ใช่นับเป็นศูนย์) อันดับคนขับนับเฉพาะเที่ยวที่มีเวลาออกรถและคืนรถครบ</p>
        </>
      )}
    </div>
  )
}
