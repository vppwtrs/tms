import { useEffect, useMemo, useState } from 'react'
import { Button, ErrorBox, TableSkeleton } from '../ui'
import { opsToday, unitLabel, type OpsToday } from '../../api/opsToday'
import { latestOdometerByVehicle, tollByVehicle, type LatestOdometer } from '../../api/vehicles'
import { fmtDate, fmtNum } from '../../utils/format'
import { xlsxSafe } from '../../utils/xlsxSafe'
import { Money, Stat, statGrid } from './shared'

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
  const [odometers, setOdometers] = useState<Map<number, LatestOdometer>>(new Map())
  const [tolls, setTolls] = useState<Map<number, number>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    opsToday(range.from, range.to)
      .then(async (d) => {
        if (!alive) return
        setData(d)
        setError(null)
        const ids = d.fleet.map((r) => r.vehicle_id)
        /* เลขไมล์เอาค่าล่าสุดจริง ไม่ผูกกับช่วงที่เลือกดู — ค่าทางด่วนผูกกับช่วงที่เลือก
           เพราะเป็นตัวเลข "ทำได้เท่าไรช่วงนี้" เหมือนตัวเลขอื่นในรายงานนี้ */
        const [odo, toll] = await Promise.all([latestOdometerByVehicle(ids), tollByVehicle(ids, range)])
        if (alive) { setOdometers(odo); setTolls(toll) }
      })
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

  /** ดาวน์โหลดรายงานเป็น .xlsx จริง สองชีต — สรุปรายคัน (มีคอลัมน์ "จุดสูงสุด/เที่ยว" กันเข้าใจ
   *  ผิดว่าเบี้ยคิดจากยอดรวม) กับรายละเอียดทุกเที่ยว ไฮไลต์เหลืองตรงจุด/เบี้ยที่เกินเกณฑ์
   *  หน้าตาเดียวกับไฟล์ตัวอย่างที่เคยทำให้ดูก่อนหน้านี้ — exceljs โหลดแบบ dynamic import
   *  ใช้แค่ตอนกดปุ่มนี้ปุ่มเดียว ไม่ต้องแบกเข้า bundle หลักของรายงาน */
  const exportXlsx = async (): Promise<void> => {
    if (!data) return
    const { Workbook } = await import('exceljs')
    const wb = new Workbook()

    const fontNormal = { name: 'Arial', size: 11 }
    const fontBold = { name: 'Arial', size: 11, bold: true }
    const fontTitle = { name: 'Arial', size: 14, bold: true }
    const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F4E78' } }
    const headerFont = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    const flagFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF2CC' } }
    const flagFont = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF9C6500' } }
    const thin = { style: 'thin' as const, color: { argb: 'FFD9D9D9' } }
    const border = { top: thin, bottom: thin, left: thin, right: thin }

    const ws1 = wb.addWorksheet('สรุปรายคัน')
    ws1.mergeCells('A1:L1')
    ws1.getCell('A1').value = `สรุปรายคัน ${range.from} ถึง ${range.to}`
    ws1.getCell('A1').font = fontTitle
    ws1.mergeCells('A2:L2')
    ws1.getCell('A2').value = 'คอลัมน์ "จุดสูงสุด/เที่ยว" คือค่าที่เบี้ยจุดส่งใช้คำนวณจริง ไม่ใช่คอลัมน์ "จุดส่ง" ที่เป็นผลรวมทั้งช่วง'
    ws1.getCell('A2').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF666666' } }

    const head1 = [
      'ทะเบียน', 'คนขับ', 'เที่ยว', 'จุดส่ง (รวม)', 'จุดสูงสุด/เที่ยว', 'จุดที่ปิด', 'เลขไมล์ล่าสุด',
      ...(money ? ['ค่าขนส่งแผน', 'ค่าขนส่งจริง', 'เที่ยวที่ยังไม่ปิดยอด', 'เบี้ยจุดส่ง', 'ค่าทางด่วน (ช่วงนี้)'] : []),
    ]
    const headerRow1 = ws1.getRow(4)
    head1.forEach((h, i) => {
      const cell = headerRow1.getCell(i + 1)
      cell.value = h
      cell.font = headerFont
      cell.fill = headerFill
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    })
    headerRow1.height = 30

    data.fleet.forEach((r, i) => {
      const row = ws1.getRow(5 + i)
      const values = [
        xlsxSafe(r.plate), xlsxSafe(r.crew ?? ''), r.trips, r.stops, r.max_trip_stops, r.stops_done,
        odometers.get(r.vehicle_id)?.reading_km ?? '',
        ...(money
          ? [r.cost_plan ?? '', r.cost_actual ?? '', r.cost_open, r.bonus ?? '', tolls.get(r.vehicle_id) ?? 0]
          : []),
      ]
      values.forEach((v, c) => {
        const cell = row.getCell(c + 1)
        cell.value = v
        cell.font = fontNormal
        cell.border = border
        if (c >= 2) cell.alignment = { horizontal: 'center' }
        /* คอลัมน์ที่ 5 = จุดสูงสุด/เที่ยว, คอลัมน์เบี้ย = index 10 เมื่อมีสิทธิ์เงิน — ไฮไลต์
           คู่กันให้เห็นชัดว่าคันไหนมีเที่ยวแตะเกณฑ์ */
        if (c === 4 && typeof v === 'number' && v > data.bonus_rule.free_stops) {
          cell.fill = flagFill
          cell.font = flagFont
        }
        if (money && c === 10 && typeof v === 'number' && v > 0) {
          cell.fill = flagFill
          cell.font = flagFont
        }
      })
    })
    ws1.columns = [
      { width: 10 }, { width: 42 }, { width: 8 }, { width: 13 }, { width: 15 }, { width: 10 }, { width: 13 },
      ...(money ? [{ width: 12 }, { width: 12 }, { width: 18 }, { width: 11 }, { width: 16 }] : []),
    ]
    ws1.views = [{ state: 'frozen', ySplit: 4 }]

    if (money && data.trip_rows.length > 0) {
      const ws2 = wb.addWorksheet('รายละเอียดทุกเที่ยว')
      const head2 = ['ทะเบียน', 'เลขทริป', 'วันที่', 'จุดส่ง', 'จุดที่ปิด', 'จุดเกินฟรี', 'เบี้ย (บาท)', 'ค่าขนส่งแผน', 'ค่าขนส่งจริง']
      const headerRow2 = ws2.addRow(head2)
      headerRow2.eachCell((cell) => {
        cell.font = headerFont
        cell.fill = headerFill
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      })
      data.trip_rows.forEach((t) => {
        const row = ws2.addRow([
          xlsxSafe(t.plate), xlsxSafe(t.trip_no), fmtDate(t.trip_date), t.stops, t.stops_done,
          t.paid_stops, t.bonus, t.cost_plan ?? '', t.cost_actual ?? '',
        ])
        row.eachCell((cell, col) => {
          cell.font = fontNormal
          cell.border = border
          if (col >= 3) cell.alignment = { horizontal: 'center' }
          if ((col === 6 || col === 7) && t.paid_stops > 0) {
            cell.fill = flagFill
            cell.font = flagFont
          }
        })
      })
      ws2.columns = [{ width: 10 }, { width: 16 }, { width: 12 }, { width: 8 }, { width: 8 }, { width: 10 }, { width: 11 }, { width: 12 }, { width: 12 }]
      ws2.views = [{ state: 'frozen', ySplit: 1 }]
    }

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${range.from}-${range.to}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading && !data) return <TableSkeleton rows={6} cols={6} />

  return (
    <>
      {error && <ErrorBox message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {data && t && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button variant="ghost" onClick={() => void exportXlsx()} disabled={data.fleet.length === 0}>ดาวน์โหลด Excel</Button>
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
                      <th className="r">จุดสูงสุด/เที่ยว</th>
                      <th className="r">ปิดแล้ว</th>
                      <th className="r">เลขไมล์ล่าสุด</th>
                      {money && <th className="r">ค่าขนส่งแผน</th>}
                      {money && <th className="r">ค่าขนส่งจริง</th>}
                      {money && <th className="r">เบี้ย</th>}
                      {money && <th className="r">ค่าทางด่วน (ช่วงนี้)</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.fleet.map((r) => (
                      <tr key={r.vehicle_id}>
                        <td><b>{r.plate}</b></td>
                        <td>{r.crew ?? <span className="text-muted">ยังไม่มีคนขับ</span>}</td>
                        <td className="r">{fmtNum(r.trips)}</td>
                        <td className="r">{fmtNum(r.stops)}</td>
                        <td className="r">
                          {r.max_trip_stops > data.bonus_rule.free_stops
                            ? <span style={{ color: 'var(--warn)', fontWeight: 700 }}>{fmtNum(r.max_trip_stops)}</span>
                            : fmtNum(r.max_trip_stops)}
                        </td>
                        <td className="r">{fmtNum(r.stops_done)}</td>
                        <td className="r">
                          {odometers.has(r.vehicle_id)
                            ? `${odometers.get(r.vehicle_id)!.reading_km.toLocaleString('th-TH')} กม.`
                            : <span className="text-muted">—</span>}
                        </td>
                        {money && <td className="r"><Money value={r.cost_plan} /></td>}
                        {money && (
                          <td className="r">
                            {r.cost_open > 0
                              ? <span className="text-muted">รอปิด {fmtNum(r.cost_open)} เที่ยว</span>
                              : <Money value={r.cost_actual} />}
                          </td>
                        )}
                        {money && <td className="r"><Money value={r.bonus} /></td>}
                        {money && <td className="r"><Money value={tolls.get(r.vehicle_id) ?? 0} /></td>}
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
