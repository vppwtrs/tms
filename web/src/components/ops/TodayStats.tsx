import { fmtNum } from '../../utils/format'
import { costVariance, unitLabel, type OpsToday, type UnitKind } from '../../api/opsToday'

/**
 * งานวันนี้ — แถบสรุปบนสุดของหน้าภาพรวม
 *
 * เป็น **แผ่นเดียว มีเส้นคั่นบาง ๆ** ไม่ใช่การ์ดเจ็ดใบเรียงกัน
 * เจ็ดกรอบซ้อนอยู่ในกรอบหน้าอีกที ทำให้หน้าดูแข็งและอึดอัด ทั้งที่ตัวเลขเจ็ดตัวนี้
 * เป็นเรื่องเดียวกันคือ "วันนี้" — ของที่เป็นพวกเดียวกันควรอยู่ในแผ่นเดียวกัน
 * แล้วใช้ระยะห่างกับเส้นบางแยกกัน ไม่ใช่ใช้กรอบ
 *
 * เรียงตามลำดับที่คำถามถูกถามจริงตอนเช้า: ใช้รถกี่คัน ได้กี่เที่ยว กี่ใบ กี่จุด
 * แล้วจบด้วยเรื่องเงิน · ช่องเงินหายทั้งกลุ่มเมื่อสิทธิ์ไม่ถึง (ต้องมี dispatch.view)
 * ไม่ใช่ขึ้นเป็นขีด — ขีดแปลว่า "ไม่มีข้อมูล" ซึ่งคนละเรื่องกับ "คุณดูไม่ได้"
 *
 * แถวล่างคือหน่วยงานแยกประเภท ซึ่งเป็นการแตกยอดของตัวเลขข้างบนอยู่แล้ว
 * จึงอยู่ในแผ่นเดียวกัน ไม่ต้องมีการ์ดของตัวเอง
 */

const UNIT_CLASS: Record<string, string> = {
  vehicle: 'u-truck',
  box: 'u-box',
  pallet: 'u-pallet',
}

function Item({ label, value, unit, foot, money, hint }: {
  label: string
  value: string
  unit: string
  foot: React.ReactNode
  money?: boolean
  hint?: string
}): React.JSX.Element {
  return (
    <div className={`ops-band-item${money ? ' is-money' : ''}`}>
      <span className="ops-band-label" title={hint}>{label}</span>
      <div className="ops-band-value">
        <b className="num">{value}</b>
        <span>{unit}</span>
      </div>
      <span className="ops-band-foot">{foot}</span>
    </div>
  )
}

function UnitLine({ units }: { units: UnitKind[] }): React.JSX.Element | null {
  const rows = units.filter((u) => u.units > 0 || u.orders > 0)
  if (rows.length === 0) return null
  const total = rows.reduce((n, u) => n + u.units, 0)

  return (
    <div className="ops-band-units">
      <span className="ops-band-label">หน่วยงานแยกประเภท</span>
      <div className="ops-unitbar">
        {rows.map((u) => (
          <i
            key={u.kind}
            className={UNIT_CLASS[u.kind] ?? 'u-other'}
            style={{ width: `${(u.units / (total || 1)) * 100}%` }}
          />
        ))}
      </div>
      <div className="ops-unitkeys">
        {rows.map((u) => (
          <span key={u.kind}>
            <i className={UNIT_CLASS[u.kind] ?? 'u-other'} />
            {unitLabel(u.kind)} <b className="num">{fmtNum(u.units)}</b>
          </span>
        ))}
        <span className="ops-band-total">รวม <b className="num">{fmtNum(total)}</b> หน่วย</span>
      </div>
    </div>
  )
}

export function TodayStats({ data }: { data: OpsToday | null }): React.JSX.Element {
  if (!data) {
    return <div className="ops-band is-empty" aria-busy="true" />
  }

  const t = data.today
  const variance = costVariance(t.cost_plan, t.cost_actual)
  const pct = t.cost_plan && variance !== null && t.cost_plan !== 0
    ? Math.round((variance / t.cost_plan) * 1000) / 10
    : null

  return (
    <section className="ops-band" aria-label="งานวันนี้">
      <div className="ops-band-row">
        <Item
          label="ใช้รถ"
          value={fmtNum(t.vehicles_used)}
          unit="คัน"
          foot={`ใช้ได้ ${fmtNum(t.vehicles_usable)} · ว่าง ${fmtNum(t.vehicles_free)}`}
        />
        <Item
          label="เที่ยววิ่ง"
          value={fmtNum(t.trips)}
          unit="เที่ยว"
          foot={t.vehicles_used > 0
            ? `เฉลี่ย ${(t.trips / t.vehicles_used).toFixed(1)} ต่อคัน`
            : 'ยังไม่มีเที่ยววันนี้'}
          hint="Trip — เที่ยวที่ออกวันนี้ ไม่นับเที่ยวที่ถูกยกเลิก"
        />
        <Item
          label="ใบส่งของ"
          value={fmtNum(t.shipments)}
          unit="ใบ"
          foot="หนึ่งใบต่อหนึ่ง picking list"
          hint="Shipment — ใบที่ผูกกับเที่ยวของวันนี้"
        />
        <Item
          label="จุดส่ง"
          value={fmtNum(t.stops)}
          unit="จุด"
          foot={t.trips > 0 ? `เฉลี่ย ${(t.stops / t.trips).toFixed(1)} ต่อเที่ยว` : '—'}
          hint="Drop — หนึ่งร้านในหนึ่งเที่ยว = หนึ่งจุด ไม่ใช่หนึ่งใบ"
        />

        {data.money && (
          <>
            <Item
              money
              label="ค่าขนส่งตามแผน"
              value={t.cost_plan === null ? '—' : fmtNum(t.cost_plan)}
              unit="บาท"
              foot={`${fmtNum(t.trips)} เที่ยว`}
              hint="ค่าเหมาที่ตกลงไว้ตอนจัดเที่ยว"
            />
            <Item
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
            <Item
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

      <UnitLine units={data.units} />
    </section>
  )
}
