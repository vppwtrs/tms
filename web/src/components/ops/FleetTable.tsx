import { fmtNum } from '../../utils/format'
import { rowProgress, sinceText, type FleetRow, type OpsToday } from '../../api/opsToday'

/**
 * รถแต่ละคันถึงไหนแล้ว
 *
 * ตอบคำถามที่ก่อนหน้านี้ไม่มีที่ไหนในระบบตอบได้ในที่เดียว: รถคันนี้ได้กี่เที่ยว
 * กี่จุด เกินเกณฑ์เบี้ยไหม ค่าขนส่งเท่าไร และตอนนี้ถึงไหนแล้ว เดิมต้องเปิดหน้า
 * แผนงานแล้วไล่กดทีละเที่ยว ซึ่งไม่มีใครทำตอนเช้าที่งานกำลังออก
 *
 * **"ถึงไหนแล้ว" คือจุดที่คนขับกดปิดล่าสุด ไม่ใช่ตำแหน่ง GPS**
 * บนเว็บ ตำแหน่งหยุดส่งทันทีที่คนขับล็อกหน้าจอ ซึ่งเป็นเกือบตลอดการขับ
 * หมุดบนแผนที่จึงอาจค้างอยู่ที่เดิมมาชั่วโมงแล้วโดยไม่มีอะไรบอก
 * สิ่งที่เชื่อถือได้คือ "เขากดปิดจุดนี้เมื่อ 12 นาทีที่แล้ว" ตารางนี้จึงบอกแบบนั้น
 *
 * ค่าขนส่งแสดงเป็นคู่ แผน → จริง เสมอ ตัวเลขต้นทุนเดี่ยว ๆ ไม่บอกอะไรถ้าไม่มี
 * อีกตัวเทียบ · เที่ยวที่ยังไม่ปิดเขียนว่า "รอปิดเที่ยว" ไม่ใช่ 0 เพราะศูนย์แปลว่า
 * ไม่มีค่าใช้จ่าย ซึ่งคนละเรื่องกับยังไม่รู้
 */

function CostPair({ row, money }: { row: FleetRow; money: boolean }): React.JSX.Element {
  if (!money) return <span className="ops-cost-none">—</span>
  const plan = row.cost_plan
  const actual = row.cost_actual
  if (plan === null && actual === null) return <span className="ops-cost-none">—</span>

  const over = plan !== null && actual !== null ? actual - plan : null
  return (
    <span className="ops-cost">
      <span className="ops-cost-plan">{plan === null ? '—' : fmtNum(plan)}</span>
      <span className="ops-cost-arrow" aria-hidden="true">→</span>
      {row.cost_open > 0 || actual === null ? (
        <span className="ops-cost-none">รอปิดเที่ยว</span>
      ) : (
        <span className={`ops-cost-act${over === null ? '' : over > 0 ? ' is-over' : over < 0 ? ' is-under' : ''}`}>
          {fmtNum(actual)}
        </span>
      )}
    </span>
  )
}

export function FleetTable({ data }: { data: OpsToday | null }): React.JSX.Element {
  const rows = data?.fleet ?? []
  const money = data?.money ?? false

  if (!data) return <div className="ops-empty">กำลังโหลดงานรายคัน…</div>
  if (rows.length === 0) {
    return <div className="ops-empty">วันนี้ยังไม่มีรถออกงาน — จ่ายงานที่หน้าแผนงานขนส่ง</div>
  }

  const sum = rows.reduce(
    (acc, r) => ({
      trips: acc.trips + r.trips,
      stops: acc.stops + r.stops,
      done: acc.done + r.stops_done,
      plan: acc.plan + (r.cost_plan ?? 0),
      actual: acc.actual + (r.cost_actual ?? 0),
      bonus: acc.bonus + (r.bonus ?? 0),
      open: acc.open + r.cost_open,
    }),
    { trips: 0, stops: 0, done: 0, plan: 0, actual: 0, bonus: 0, open: 0 },
  )

  return (
    <div className="table-wrap">
      <table className="ops-fleettab">
        <thead>
          <tr>
            <th>รถ / คนขับ</th>
            <th className="r">เที่ยว</th>
            <th className="r">จุดส่ง</th>
            <th className="ops-fleettab-progress">ความคืบหน้า · จุดล่าสุด</th>
            {money && <th className="r">ค่าขนส่ง แผน → จริง</th>}
            {money && <th className="r" title={`จ่ายเฉพาะจุดที่เกิน ${data.bonus_rule.free_stops} จุดละ ${data.bonus_rule.rate} บาท ถ้าขึ้นหลายคนหารกัน`}>เบี้ยจุดส่ง</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = rowProgress(r)
            /* ยังไม่ปิดจุดไหนเลยทั้งที่มีจุดต้องส่ง = ยังไม่ออกจากคลัง หรือค้างอยู่
               สองอย่างนี้แถบสีเดียวกันไม่ได้ คันที่ค้างต้องสะดุดตาก่อนคันที่เพิ่งเริ่ม */
            const stalled = r.stops_done > 0 && r.stops_done < r.stops
              && sinceText(r.last_at) !== '' && Date.now() - new Date(r.last_at ?? 0).getTime() > 45 * 60_000
            return (
              <tr key={r.vehicle_id}>
                <td>
                  <span className="ops-plate">{r.plate}</span>
                  <span className="ops-crew">{r.crew ?? 'ยังไม่มีคนขับ'}</span>
                </td>
                <td className="r num">{fmtNum(r.trips)}</td>
                <td className="r">
                  <span className="num">{fmtNum(r.stops)}</span>
                  {r.over_free && (
                    <span className="ops-over" title={`เกิน ${data.bonus_rule.free_stops} จุด — เที่ยวนี้มีเบี้ยจุดส่ง`}>
                      เกิน {data.bonus_rule.free_stops}
                    </span>
                  )}
                </td>
                <td>
                  <div className="ops-rowbar">
                    <i className={stalled ? 'is-late' : undefined} style={{ width: `${pct * 100}%` }} />
                  </div>
                  <span className="ops-at">
                    {fmtNum(r.stops_done)}/{fmtNum(r.stops)}
                    {r.last_stop ? ` · ${r.last_stop}` : ' · ยังไม่ปิดจุดไหน'}
                    {r.last_at ? ` · ${sinceText(r.last_at)}` : ''}
                  </span>
                </td>
                {money && <td className="r"><CostPair row={r} money={money} /></td>}
                {money && (
                  <td className="r">
                    {r.bonus ? (
                      <>
                        <span className="ops-money num">{fmtNum(r.bonus)}</span>
                        {/* หารกันกี่คนต้องเขียนไว้ ไม่ใช่ให้คนคิดเอง — เที่ยวเดียวกัน
                            ยอดรวมเท่ากันแต่คนขับได้ไม่เท่ากันเมื่อขึ้นคนละจำนวน */}
                        {r.crew_size > 1 && (
                          <span className="ops-split">คนละ {fmtNum(Math.round(r.bonus / r.crew_size))}</span>
                        )}
                      </>
                    ) : <span className="ops-money is-zero">—</span>}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>รวม {fmtNum(rows.length)} คัน</td>
            <td className="r num">{fmtNum(sum.trips)}</td>
            <td className="r num">{fmtNum(sum.stops)}</td>
            <td>{fmtNum(sum.done)} จาก {fmtNum(sum.stops)} จุด</td>
            {money && (
              <td className="r">
                <span className="ops-cost">
                  <span className="ops-cost-plan">{fmtNum(sum.plan)}</span>
                  <span className="ops-cost-arrow" aria-hidden="true">→</span>
                  {sum.open > 0
                    ? <span className="ops-cost-none">ยังไม่ครบ</span>
                    : <span className={`ops-cost-act${sum.actual > sum.plan ? ' is-over' : sum.actual < sum.plan ? ' is-under' : ''}`}>{fmtNum(sum.actual)}</span>}
                </span>
              </td>
            )}
            {money && <td className="r num">{fmtNum(sum.bonus)}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
