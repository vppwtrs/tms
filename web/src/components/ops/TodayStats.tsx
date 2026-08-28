import { fmtNum } from '../../utils/format'
import type { OpsToday } from '../../api/opsToday'
import { costVariance } from '../../api/opsToday'

/**
 * งานวันนี้ — แถวบนสุดของหน้าภาพรวม
 *
 * เรียงตามลำดับที่คำถามถูกถามจริงในห้องประชุมเช้า: ใช้รถกี่คัน ได้กี่เที่ยว
 * กี่ใบ กี่จุด แล้วจบด้วยเรื่องเงิน ก่อนหน้านี้บนสุดเป็นความคืบหน้า
 * ซึ่งเป็นคำถามที่สอง ไม่ใช่คำถามแรก
 *
 * สามช่องท้ายเป็นเรื่องเงิน มีเส้นคั่นซ้าย — ตัวเลขปฏิบัติการกับตัวเลขต้นทุน
 * ตอบคนละคำถามและมีคนละเจ้าของ วางเรียงกันเฉย ๆ จะถูกอ่านรวมเป็นพวงเดียว
 *
 * ช่องเงินหายทั้งแถวเมื่อสิทธิ์ไม่ถึง (ต้องมี dispatch.view) ไม่ใช่ขึ้นเป็นขีด —
 * ขีดแปลว่า "ไม่มีข้อมูล" ซึ่งคนละเรื่องกับ "คุณดูไม่ได้"
 */

function Tile({ label, value, unit, foot, money, hint }: {
  label: string
  value: string
  unit: string
  foot: React.ReactNode
  money?: boolean
  hint?: string
}): React.JSX.Element {
  return (
    <div className={`ops-tstat${money ? ' is-money' : ''}`}>
      <span className="ops-tstat-label" title={hint}>{label}</span>
      <div className="ops-tstat-value">
        <b className={`num${money ? ' is-sm' : ''}`}>{value}</b>
        <span>{unit}</span>
      </div>
      <span className="ops-tstat-foot">{foot}</span>
    </div>
  )
}

export function TodayStats({ data }: { data: OpsToday | null }): React.JSX.Element {
  if (!data) {
    return (
      <div className="ops-today" aria-busy="true">
        {[0, 1, 2, 3].map((i) => <div key={i} className="ops-tstat is-empty" />)}
      </div>
    )
  }

  const t = data.today
  const variance = costVariance(t.cost_plan, t.cost_actual)
  const pct = t.cost_plan && variance !== null && t.cost_plan !== 0
    ? Math.round((variance / t.cost_plan) * 1000) / 10
    : null

  return (
    <div className="ops-today">
      <Tile
        label="ใช้รถ"
        value={fmtNum(t.vehicles_used)}
        unit="คัน"
        foot={`จากที่ใช้ได้ ${fmtNum(t.vehicles_usable)} คัน · ว่าง ${fmtNum(t.vehicles_free)}`}
      />
      <Tile
        label="เที่ยววิ่ง (Trip)"
        value={fmtNum(t.trips)}
        unit="เที่ยว"
        foot={t.vehicles_used > 0
          ? `เฉลี่ย ${(t.trips / t.vehicles_used).toFixed(1)} เที่ยวต่อคัน`
          : 'ยังไม่มีเที่ยววันนี้'}
      />
      <Tile
        label="ใบส่งของ (Shipment)"
        value={fmtNum(t.shipments)}
        unit="ใบ"
        foot="นับเป็นใบเบิก หนึ่งใบต่อหนึ่ง picking list"
        hint="ใบที่ผูกกับเที่ยวของวันนี้ · ใบที่ยังไม่ถูกจัดเที่ยวไม่นับ"
      />
      <Tile
        label="จุดส่ง (Drop)"
        value={fmtNum(t.stops)}
        unit="จุด"
        foot={t.trips > 0 ? `เฉลี่ย ${(t.stops / t.trips).toFixed(1)} จุดต่อเที่ยว` : '—'}
        hint="หนึ่งร้านในหนึ่งเที่ยว = หนึ่งจุด ไม่ใช่หนึ่งใบ — กติกาเดียวกับจอคนขับ"
      />

      {data.money && (
        <>
          <Tile
            money
            label="ค่าขนส่งตามแผน"
            value={t.cost_plan === null ? '—' : fmtNum(t.cost_plan)}
            unit="บาท"
            foot={`${fmtNum(t.trips)} เที่ยว`}
            hint="ค่าเหมาที่ตกลงไว้ตอนจัดเที่ยว"
          />
          <Tile
            money
            label="ค่าขนส่งจริง"
            value={t.cost_actual === null ? '—' : fmtNum(t.cost_actual)}
            unit="บาท"
            foot={
              /* เที่ยวที่ยังไม่ปิดตัวเลขต้องบอกก่อนส่วนต่างเสมอ — ไม่งั้นวันที่ยังไม่จบ
                 จะอ่านว่า "ถูกกว่าแผน" ทั้งที่แค่ยังปิดไม่หมด */
              (t.trips_open_cost ?? 0) > 0
                ? <span className="ops-tstat-warn">ยังไม่ปิด {fmtNum(t.trips_open_cost ?? 0)} เที่ยว</span>
                : variance === null
                  ? 'ยังไม่มีตัวเลขให้เทียบ'
                  : variance === 0
                    ? 'ตรงตามแผนพอดี'
                    : (
                      <span className={variance > 0 ? 'ops-delta-up' : 'ops-delta-down'}>
                        {variance > 0 ? '▲ เกินแผน ' : '▼ ต่ำกว่าแผน '}
                        {fmtNum(Math.abs(variance))}
                        {pct !== null && ` · ${Math.abs(pct)}%`}
                      </span>
                    )
            }
            hint="ยอดที่ปิดจริงหลังจบเที่ยว"
          />
          <Tile
            money
            label="เบี้ยจุดส่ง"
            value={t.bonus_total === null ? '—' : fmtNum(t.bonus_total)}
            unit="บาท"
            foot={t.bonus_trips > 0
              ? `จาก ${fmtNum(t.bonus_trips)} เที่ยวที่เกิน ${data.bonus_rule.free_stops} จุด`
              : `ยังไม่มีเที่ยวไหนเกิน ${data.bonus_rule.free_stops} จุด`}
            hint={`จ่ายเฉพาะจุดที่เกิน ${data.bonus_rule.free_stops} จุดละ ${data.bonus_rule.rate} บาท ถ้าขึ้นหลายคนหารกัน — ยังไม่รวมอยู่ในค่าขนส่งจริง`}
          />
        </>
      )}
    </div>
  )
}
