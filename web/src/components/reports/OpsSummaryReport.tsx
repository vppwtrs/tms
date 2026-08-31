import { useEffect, useMemo, useState } from 'react'
import { Button, ErrorBox, TableSkeleton } from '../ui'
import { opsToday, unitLabel, type OpsToday } from '../../api/opsToday'
import { fmtNum } from '../../utils/format'
import { Money, Stat, statGrid, downloadCsv } from './shared'

/**
 * สรุปงานของ**ระบบเรา** ตามช่วงวัน — ไม่ใช่ของ TMS บริษัท
 *
 * ตัวเลขทุกตัวมาจาก `ops_today(p_from, p_to)` ตัวเดียวกับหน้าภาพรวม ตั้งใจให้เป็น
 * แหล่งเดียว: กติกานับจุดส่ง (app.stop_key) และกติกาเบี้ยอยู่ในฐาน ถ้าหน้านี้นับเอง
 * เลขสองหน้าจะไม่ตรงกันโดยไม่มีอะไรฟ้อง ซึ่งเคยเกิดมาแล้ว
 *
 * ต่างจากหน้าภาพรวมตรงคำถาม ไม่ใช่ตรงตัวเลข: หน้าภาพรวมถามว่า "ตอนนี้ถึงไหนแล้ว"
 * ที่นี่ถามว่า "ช่วงที่ผ่านมาทำได้เท่าไร" — ของที่ต้องส่งให้คนอื่นอ่านต่อ
 *
 * ยังไม่มีสรุปรายคนขับ เพราะฐานคืนงานรายคัน ไม่ใช่รายคน — เที่ยวที่ขึ้นสองคน
 * แยกกลับเป็นรายคนจากชื่อที่ต่อกันมาไม่ได้อย่างเชื่อถือได้ ต้องเพิ่มฟังก์ชันในฐานก่อน
 */
export function OpsSummaryReport({ range }: { range: { from: string; to: string } }): React.JSX.Element {
  const [data, setData] = useState<OpsToday | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    opsToday(range.from, range.to)
      .then((d) => { if (alive) { setData(d); setError(null) } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'อ่านรายงานไม่สำเร็จ') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [range.from, range.to, reloadKey])

  const money = data?.money ?? false
  const t = data?.today ?? null
  const variance = useMemo(() => {
    if (!t || t.cost_plan === null || t.cost_actual === null) return null
    return t.cost_actual - t.cost_plan
  }, [t])

  const exportCsv = (): void => {
    if (!data) return
    const head = [
      'ทะเบียน', 'คนขับ', 'เที่ยว', 'จุดส่ง', 'จุดที่ปิด',
      ...(money ? ['ค่าขนส่งแผน', 'ค่าขนส่งจริง', 'เที่ยวที่ยังไม่ปิดยอด', 'เบี้ยจุดส่ง'] : []),
    ]
    const rows: (string | number)[][] = data.fleet.map((r) => [
      r.plate,
      r.crew ?? '',
      r.trips,
      r.stops,
      r.stops_done,
      ...(money ? [r.cost_plan ?? '', r.cost_actual ?? '', r.cost_open, r.bonus ?? ''] : []),
    ])
    downloadCsv(`report-${range.from}-${range.to}.csv`, [head, ...rows])
  }

  if (loading && !data) return <TableSkeleton rows={6} cols={6} />

  return (
    <>
      {error && <ErrorBox message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {data && t && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button variant="ghost" onClick={exportCsv} disabled={data.fleet.length === 0}>ออกไฟล์ CSV</Button>
          </div>

          <div style={statGrid}>
            <Stat label="เที่ยว" value={fmtNum(t.trips)} foot={`ใช้รถ ${fmtNum(t.vehicles_used)} คัน`} />
            <Stat label="ใบงาน" value={fmtNum(t.shipments)} />
            <Stat
              label="จุดส่ง"
              value={fmtNum(t.stops)}
              foot={t.stops > 0 ? `ปิดแล้ว ${fmtNum(t.stops_done)} จุด (${Math.round((t.stops_done / t.stops) * 100)}%)` : undefined}
            />
            {money && (
              <Stat
                label="ค่าขนส่ง แผน → จริง"
                value={<span><Money value={t.cost_plan} /> <span className="text-muted">→</span> <Money value={t.cost_actual} /></span>}
                foot={
                  /* เที่ยวที่ยังไม่ปิดยอดทำให้ "จริง" ยังไม่ครบ ต้องเขียนไว้ ไม่ใช่ปล่อยให้
                     คนอ่านเข้าใจว่าประหยัดกว่าแผน ทั้งที่ยอดยังมาไม่ครบ */
                  t.trips_open_cost !== null && t.trips_open_cost > 0
                    ? `ยังไม่ปิดยอด ${fmtNum(t.trips_open_cost)} เที่ยว — ยอดจริงยังไม่ครบ`
                    : variance === null
                      ? 'ยังเทียบไม่ได้'
                      : variance > 0
                        ? `เกินแผน ${fmtNum(variance)} บาท`
                        : variance < 0
                          ? `ต่ำกว่าแผน ${fmtNum(-variance)} บาท`
                          : 'ตรงแผน'
                }
              />
            )}
            {money && (
              <Stat
                label="เบี้ยจุดส่ง"
                value={<Money value={t.bonus_total} />}
                foot={`${fmtNum(t.bonus_trips)} เที่ยวที่เกิน ${data.bonus_rule.free_stops} จุด · จุดละ ${data.bonus_rule.rate} บาท`}
              />
            )}
          </div>

          {!money && (
            <div className="card" style={{ padding: 12, marginBottom: 16 }}>
              <span className="text-muted">บัญชีนี้ไม่มีสิทธิ์ดูตัวเลขค่าใช้จ่าย — รายงานจึงแสดงเฉพาะปริมาณงาน</span>
            </div>
          )}

          {data.units.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, marginBottom: 10 }}>งานตามประเภท</h2>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {data.units.map((u) => (
                  <div key={u.kind}>
                    <div className="text-xs text-muted">{unitLabel(u.kind)}</div>
                    <div style={{ fontWeight: 700 }}>{fmtNum(u.orders)} ใบ · {fmtNum(u.units)} หน่วย</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 0 }}>
            <h2 style={{ fontSize: 15, padding: '14px 16px 0' }}>สรุปรายคัน</h2>
            {data.fleet.length === 0 ? (
              <div className="ops-empty">ช่วงนี้ไม่มีรถออกงาน</div>
            ) : (
              <div className="table-wrap">
                <table className="table ops-table">
                  <thead>
                    <tr>
                      <th>ทะเบียน</th>
                      <th>คนขับ</th>
                      <th className="r">เที่ยว</th>
                      <th className="r">จุดส่ง</th>
                      <th className="r">ปิดแล้ว</th>
                      {money && <th className="r">ค่าขนส่งแผน</th>}
                      {money && <th className="r">ค่าขนส่งจริง</th>}
                      {money && <th className="r">เบี้ย</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.fleet.map((r) => (
                      <tr key={r.vehicle_id}>
                        <td><b>{r.plate}</b></td>
                        <td>{r.crew ?? <span className="text-muted">ยังไม่มีคนขับ</span>}</td>
                        <td className="r">{fmtNum(r.trips)}</td>
                        <td className="r">{fmtNum(r.stops)}</td>
                        <td className="r">{fmtNum(r.stops_done)}</td>
                        {money && <td className="r"><Money value={r.cost_plan} /></td>}
                        {money && (
                          <td className="r">
                            {r.cost_open > 0
                              ? <span className="text-muted">รอปิด {fmtNum(r.cost_open)} เที่ยว</span>
                              : <Money value={r.cost_actual} />}
                          </td>
                        )}
                        {money && <td className="r"><Money value={r.bonus} /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
