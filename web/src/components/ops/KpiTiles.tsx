import { fmtNum } from '../../utils/format'
import {
  coverageNote,
  sparkPoints,
  type KpiTrendPoint,
  type OverviewKpis,
} from '../../api/opsOverview'

/**
 * KPI สี่ตัว พร้อมลูกศรเทียบช่วงก่อน และเส้นแนวโน้มในตัว
 *
 * ลูกศรบอกว่า **ดีขึ้นหรือแย่ลง** เส้นบอกว่ามัน **ค่อย ๆ** ดีขึ้นมาทั้งสัปดาห์
 * หรือเพิ่งเด้งเมื่อวานวันเดียว — สองอย่างนี้ต่างกันมากเวลาตัดสินใจ และเส้นกินที่
 * เพิ่มแค่ 22px ซึ่งถูกกว่าการเปิดอีกหน้าไปดูย้อนหลัง
 *
 * ชุดนี้ผูกกับข้อเท็จจริงว่า **งานส่วนใหญ่เป็นเหมาจ่าย** เปลี่ยนเมื่อไหร่ต้องคิดใหม่ทั้งชุด
 * ที่ถูกตีตกไปแล้วและห้ามเสนอกลับ: OTIF, เวลาเฉลี่ยต่อจุด, ต้นทุนจาก fuel/toll/other
 * — เหตุผลเต็มอยู่ในหัวไฟล์ของ migration 20260828010000
 */

interface Tile {
  label: string
  value: string
  unit?: string
  /** null = ไม่มีตัวเทียบ (ยังไม่มีข้อมูลช่วงก่อน) ต่างจาก 0 ที่แปลว่าเท่าเดิม */
  delta: number | null
  /** ทิศที่ถือว่าดี — ค่าเหมาต่อจุดยิ่งน้อยยิ่งดี ต่างจากตัวอื่นที่ยิ่งมากยิ่งดี */
  goodWhen: 'up' | 'down'
  deltaText?: (d: number) => string
  foot?: string
  spark?: string
}

function isGood(t: Tile): boolean {
  return t.delta !== null && (t.delta > 0) === (t.goodWhen === 'up')
}

function DeltaLine({ tile }: { tile: Tile }): React.JSX.Element {
  if (tile.delta === null) return <span className="ops-kpi-delta is-flat">ยังไม่มีช่วงก่อนให้เทียบ</span>
  if (Math.abs(tile.delta) < 0.05) return <span className="ops-kpi-delta is-flat">— เท่าช่วงก่อน</span>

  const text = tile.deltaText
    ? tile.deltaText(tile.delta)
    : `${tile.delta > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(Number(tile.delta.toFixed(2))))}`

  /* สีบอกว่า "ดีขึ้นหรือแย่ลง" ไม่ใช่ "ขึ้นหรือลง" — ค่าเหมาต่อจุดที่ลดลงคือข่าวดี
     ถ้าทาสีตามทิศลูกศร ผู้อ่านจะเห็นแดงแล้วตกใจกับสิ่งที่ควรดีใจ */
  return <span className={`ops-kpi-delta ${isGood(tile) ? 'is-good' : 'is-bad'}`}>{text}</span>
}

export function KpiTiles({ kpis, prev, trend }: {
  kpis: OverviewKpis
  prev: OverviewKpis | null
  trend: KpiTrendPoint[]
}): React.JSX.Element {
  const diff = (a: number | undefined | null, b: number | undefined | null): number | null =>
    a === undefined || a === null || b === undefined || b === null ? null : a - b

  const tiles: Tile[] = [
    {
      label: 'จบครบภายในวัน',
      value: kpis.same_day ? kpis.same_day.pct.toFixed(1) : '—',
      unit: kpis.same_day ? '%' : undefined,
      delta: diff(kpis.same_day?.pct, prev?.same_day?.pct),
      goodWhen: 'up',
      deltaText: (d) => `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)} จุด`,
      foot: kpis.same_day ? `จาก ${fmtNum(kpis.same_day.base)} จุด` : 'ยังไม่มีจุดส่งในช่วงนี้',
      spark: sparkPoints(trend, (p) => p.same_day_pct),
    },
    {
      label: 'จุดต่อเที่ยว',
      value: kpis.stops_per_trip ? kpis.stops_per_trip.value.toFixed(1) : '—',
      unit: kpis.stops_per_trip ? 'จุด' : undefined,
      delta: diff(kpis.stops_per_trip?.value, prev?.stops_per_trip?.value),
      goodWhen: 'up',
      deltaText: (d) => `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)} จุด`,
      /* งานเหมาจ่าย: ยิ่งเที่ยวหนึ่งกวาดได้หลายจุด ค่าเหมาต่อจุดยิ่งถูก
         ตัวนี้กับใบถัดไปจึงเป็นเรื่องเดียวกันคนละมุม */
      foot: kpis.stops_per_trip ? `จาก ${fmtNum(kpis.stops_per_trip.trips)} เที่ยว` : 'ยังไม่มีเที่ยวในช่วงนี้',
      spark: sparkPoints(trend, (p) => p.stops_per_trip),
    },
    {
      label: 'ค่าเหมาต่อจุด',
      value: kpis.cost_per_stop ? fmtNum(Math.round(kpis.cost_per_stop.value)) : '—',
      unit: kpis.cost_per_stop ? 'บาท' : undefined,
      delta: diff(kpis.cost_per_stop?.value, prev?.cost_per_stop?.value),
      goodWhen: 'down',
      deltaText: (d) => `${d > 0 ? '▲ แพงขึ้น' : '▼ คุ้มขึ้น'} ${fmtNum(Math.abs(Math.round(d)))}`,
      foot: kpis.cost_per_stop
        ? coverageNote(kpis.cost_per_stop, 'ของเที่ยว') || 'ทุกเที่ยวมีตัวเลข'
        : 'สิทธิ์ไม่ถึง หรือยังไม่มีตัวเลข',
      spark: sparkPoints(trend, (p) => p.cost_per_stop),
    },
    {
      label: 'ส่วนต่างสัญญา',
      value: kpis.cost_variance
        ? `${kpis.cost_variance.total > 0 ? '+' : ''}${fmtNum(Math.round(kpis.cost_variance.total))}`
        : '—',
      unit: kpis.cost_variance ? 'บาท' : undefined,
      delta: diff(kpis.cost_variance?.total, prev?.cost_variance?.total),
      goodWhen: 'down',
      deltaText: (d) => `${d > 0 ? '▲ ห่างขึ้น' : '▼ แคบลง'} ${fmtNum(Math.abs(Math.round(d)))}`,
      /* null ในช่องค่าเหมาแปลว่า "ยังไม่ปิดตัวเลข" ไม่ใช่ "ศูนย์บาท" ฐานจึงตัดเที่ยว
         พวกนั้นออกทั้งเศษและส่วน แล้วส่ง coverage กลับมาให้เขียนกำกับตรงนี้ */
      foot: kpis.cost_variance
        ? coverageNote(kpis.cost_variance, 'ที่ปิดตัวเลข') || 'ปิดตัวเลขครบแล้ว'
        : 'สิทธิ์ไม่ถึง หรือยังไม่มีตัวเลข',
      /* ส่วนต่างไม่มีเส้น — ฐานยังไม่ได้ส่งชุดรายวันของมันมา วาดเส้นจากตัวอื่น
         แล้วบอกว่าเป็นของใบนี้คือโกหกเงียบ ๆ */
    },
  ]

  return (
    <div className="ops-kpis">
      {tiles.map((t) => (
        <div key={t.label} className="ops-kpi">
          <span className="ops-kpi-label">{t.label}</span>
          <div className="ops-kpi-value">
            {t.value}
            {t.unit && <span className="ops-kpi-unit">{t.unit}</span>}
          </div>
          <DeltaLine tile={t} />
          {t.foot && <div className="ops-kpi-foot">{t.foot}</div>}
          {t.spark && (
            <svg className="ops-kpi-spark" width="100%" height="22" viewBox="0 0 150 22"
              preserveAspectRatio="none" aria-hidden="true">
              <polyline
                className={isGood(t) ? 'is-good' : t.delta === null ? 'is-flat' : 'is-bad'}
                points={t.spark}
              />
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}
