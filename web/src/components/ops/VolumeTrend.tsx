import { fmtNum } from '../../utils/format'
import { volumeLabel, type OpsVolume, type VolumeGrain } from '../../api/opsToday'
import { smoothPath } from '../../utils/curve'

/**
 * ปริมาณงาน — แท่งคือจุดส่ง เส้นคือเที่ยววิ่ง สลับได้ วัน / เดือน / ปี
 *
 * **ไม่มีแกนตัวเลขด้านซ้าย** โดยตั้งใจ แกนกินความกว้างทุกแถวเพื่อบอกสิ่งที่ตัวเลข
 * บนหัวแท่งบอกอยู่แล้ว และการอ่านค่าจากแกนต้องกวาดตาไปกลับระหว่างแท่งกับแกน
 * ซึ่งช้ากว่าอ่านตัวเลขที่อยู่ตรงนั้นเลย
 *
 * เส้นเป็นเส้นโค้ง ไม่ใช่เส้นหักมุม — ข้อมูลรายเดือน/รายปีเป็นค่าที่ค่อย ๆ เปลี่ยน
 * มุมแหลมที่ทุกจุดสื่อว่ามันกระโดดตรงนั้นพอดี ทั้งที่ระหว่างจุดเราไม่มีข้อมูลเลย
 * แต่โค้งต้องไม่เหวี่ยงเกินค่าจริง (ดู utils/curve.ts)
 *
 * สองหน่วยอยู่ในภาพเดียวได้เพราะเป็นคนละรูปทรง (แท่ง/เส้น) ไม่ใช่สองสีของแท่ง
 * เส้นถูกปรับสเกลด้วยค่าสูงสุดของตัวมันเอง — อ่าน **รูปร่าง** ของมัน ไม่ใช่ค่าเทียบแท่ง
 * ซึ่งเป็นสิ่งที่คนดูอยากรู้จริง ๆ: จำนวนเที่ยวขึ้นตามงานหรือเปล่า
 *
 * ช่วงสุดท้ายยังไม่จบเสมอ (วันนี้ / เดือนนี้ / ปีนี้) จึงวาดเป็นแท่งขอบประ
 * แล้วเขียนกำกับใต้ภาพ ปล่อยให้เป็นแท่งทึบเตี้ย ๆ คือหลอกให้อ่านว่างานตกฮวบ
 */

const W = 1000
const H = 230
const PAD_T = 26
const PAD_B = 30
const PAD_X = 12

const GRAINS: { key: VolumeGrain; label: string }[] = [
  { key: 'day', label: 'วัน' },
  { key: 'month', label: 'เดือน' },
  { key: 'year', label: 'ปี' },
]

export function VolumeTrend({ data, grain, onGrain }: {
  data: OpsVolume | null
  grain: VolumeGrain
  onGrain: (g: VolumeGrain) => void
}): React.JSX.Element {
  const points = data?.points ?? []
  const maxStops = Math.max(1, ...points.map((p) => p.stops))
  const maxTrips = Math.max(1, ...points.map((p) => p.trips))
  const base = H - PAD_B
  const span = (W - PAD_X * 2) / Math.max(1, points.length)
  const barW = Math.min(64, span * 0.56)
  const cx = (i: number): number => PAD_X + span * i + span / 2
  const barH = (n: number): number => Math.max(2, ((base - PAD_T) * n) / maxStops)
  const lineY = (n: number): number => base - ((base - PAD_T) * n) / maxTrips

  /* เส้นโค้งแบบ monotone — โค้งได้แต่ห้ามเหวี่ยงเกินค่าจริง ช่วงที่เป็นศูนย์ติดกัน
     แล้วพุ่งขึ้น เส้นแบบเฉลี่ยทั่วไปจะแอ่นต่ำกว่าศูนย์ก่อน ซึ่งวาดวันที่วิ่งติดลบ */
  const line = smoothPath(points.map((p, i) => ({ x: cx(i), y: lineY(p.trips) })))
  /* พื้นจาง ๆ ใต้เส้น — เส้นลอย ๆ กลางที่ว่างไม่มีอะไรยึด ตาเลยอ่านไม่ออกว่ามันสูงจาก
     อะไร พื้นที่ปิดลงถึงเส้นฐานทำให้เส้นมีน้ำหนักและมีที่ยืน */
  const area = line
    ? `${line} L${cx(points.length - 1)},${base} L${cx(0)},${base} Z`
    : ''
  /* เส้นแนวนอนจาง ๆ สามเส้น — ไม่มีตัวเลขกำกับเพราะตัวเลขอยู่บนหัวแท่งแล้ว
     มีไว้ให้แท่งมีระดับอ้างอิง ไม่ใช่ลอยอยู่บนพื้นขาว */
  const grid = [0.25, 0.5, 0.75].map((f) => base - (base - PAD_T) * f)
  const partial = points.find((p) => p.partial)

  return (
    <>
      <div className="ops-chart-head">
        <div className="ops-chart-legend">
          <span><i className="sw-actual" />จุดส่ง (แท่ง)</span>
          <span><i className="sw-trips" />เที่ยววิ่ง (เส้น)</span>
        </div>
        <div className="ops-lens" role="group" aria-label="ช่วงเวลาของกราฟ">
          {GRAINS.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={g.key === grain}
              onClick={() => onGrain(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ops-chart-wrap">
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMinYMid meet"
          role="img"
          aria-label={`ปริมาณงานราย${grain === 'day' ? 'วัน' : grain === 'month' ? 'เดือน' : 'ปี'}`}
        >
          {grid.map((y) => (
            <line key={y} className="ops-chart-grid" x1={PAD_X} y1={y} x2={W - PAD_X} y2={y} />
          ))}
          <line className="ops-chart-base" x1={PAD_X} y1={base} x2={W - PAD_X} y2={base} />

          {/* พื้นใต้เส้นวาดก่อนแท่ง ไม่งั้นสีจาง ๆ ไปเคลือบทับแท่งจนแท่งดูหม่นลง */}
          {area && <path className="ops-varea" d={area} />}

          {points.map((p, i) => (
            <g key={p.key}>
              <rect
                className={`ops-vbar${p.partial ? ' is-partial' : ''}`}
                x={cx(i) - barW / 2}
                y={base - barH(p.stops)}
                width={barW}
                height={barH(p.stops)}
                rx={4}
              />
              {/* วันที่ไม่มีงานไม่ต้องเขียนเลขศูนย์ — แท่งที่ไม่มีความสูงบอกอยู่แล้ว
                  และเลขศูนย์เรียงกันห้าตัวคือสิ่งที่กินสายตาไปจากวันที่มีงานจริง */}
              {p.stops > 0 && (
                <text className="ops-vlabel" x={cx(i)} y={base - barH(p.stops) - 8}>
                  {fmtNum(p.stops)}
                </text>
              )}
              <text className="ops-chart-axis is-x" x={cx(i)} y={base + 18}>
                {volumeLabel(p.key, grain)}
              </text>
            </g>
          ))}

          {line && <path className="ops-vline" d={line} />}
          {points.map((p, i) => (
            <circle key={`d-${p.key}`} className="ops-vdot" cx={cx(i)} cy={lineY(p.trips)} r={4} />
          ))}
        </svg>
      </div>

      {partial && (
        <p className="ops-chart-note">
          แท่งขอบประคือ{grain === 'day' ? 'วันนี้' : grain === 'month' ? 'เดือนนี้' : 'ปีนี้'}
          ที่ยังไม่จบ — ยังเทียบเต็มช่วงกับช่วงก่อนหน้าไม่ได้
        </p>
      )}
    </>
  )
}
