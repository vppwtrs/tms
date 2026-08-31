import { useState } from 'react'
import { Button, ErrorBox } from '../ui'
import { useWarehouses, WarehouseNote } from './useWarehouses'
import { Stat, statGrid, downloadCsv } from './shared'
import { pullPickingLists, PL_STATUS, type PlRow, type PlStatus } from '../../api/tmsPull'
import { fmtNum } from '../../utils/format'

/**
 * รายงาน Picking List — อ่านสดจาก TMS บริษัท ไม่ผ่านฐานของเรา
 *
 * ใช้ `pullPickingLists` ตัวเดียวกับรอบดึงข้อมูล ไม่ได้เขียนเส้นใหม่: กติกาว่า
 * ใบไหนเข้าเงื่อนไข วันไหนนับเป็นวันของใบ และช่องจำนวนชื่ออะไรบ้าง อยู่ในนั้นแล้ว
 * ทั้งชุด เขียนใหม่ที่นี่ = มีกฎสองชุดที่ต้องแก้พร้อมกันตลอดไป
 *
 * **ไม่ยิงเองตอนเปิดแท็บ** ต้องกดดึง — หนึ่งครั้งคือคำขอจริงข้ามประเทศ
 * ไปหา TMS ที่คนทั้งบริษัทใช้อยู่ การยิงทุกครั้งที่ใครเผลอกดแท็บคือการกินทรัพยากร
 * ของเขาโดยไม่มีใครสั่ง
 */
/** แถวของรายงานนี้ = แถวจาก tmsPull บวกรหัสคลังที่มันมาจาก
 *  ดึงทุกคลังมารวมกันในการกดครั้งเดียว ถ้าไม่ติดรหัสคลังไว้ คนอ่านจะแยกไม่ออก */
type Row = PlRow & { warehouse: string }

export function PickingListReport({ range }: { range: { from: string; to: string } }): React.JSX.Element {
  const wh = useWarehouses()
  const [statuses, setStatuses] = useState<PlStatus[]>([])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [note, setNote] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (): Promise<void> => {
    if (!wh.list.length) return
    setLoading(true)
    setError(null)
    try {
      /* ทุกคลังพร้อมกัน — คนละคลังคนละคำขอ ไม่มีอะไรขึ้นต่อกัน
         ข้อความคืบหน้าเขียนทับกันได้ระหว่างทาง แต่ยอดสรุปท้ายรอบเป็นของรวม */
      const all = await Promise.all(wh.list.map(async (w) => {
        const res = await pullPickingLists(
          { from: range.from, to: range.to, warehouse: w, statuses },
          (msg) => setNote(`${w.code}: ${msg}`),
        )
        return { code: w.code, res }
      }))
      setRows(all.flatMap(({ code, res }) => res.rows.map((r) => ({ ...r, warehouse: code }))))
      const sum = (pickFn: (r: (typeof all)[number]['res']) => number): number =>
        all.reduce((t, x) => t + pickFn(x.res), 0)
      const missing = sum((r) => r.missingItems)
      setNote(`สแกน ${fmtNum(sum((r) => r.scanned))} ใบ · ${fmtNum(sum((r) => r.pickingLists))} PL · ${fmtNum(sum((r) => r.trips))} เที่ยว` +
        (missing ? ` · ${fmtNum(missing)} ใบไม่มีรายการสินค้า` : ''))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดึง Picking List จาก TMS ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  const toggle = (st: PlStatus): void =>
    setStatuses((cur) => (cur.includes(st) ? cur.filter((x) => x !== st) : [...cur, st]))

  const exportCsv = (): void => {
    if (!rows?.length) return
    const head = ['คลัง', 'เลข PL', 'วันที่วางแผนส่ง', 'เที่ยว', 'สถานะใบ', 'สถานะเที่ยว', 'รหัสร้าน', 'ร้าน', 'จังหวัด', 'หน่วย', 'จำนวนรวม', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'แบ่งส่ง']
    const body: (string | number)[][] = rows.map((r) => [
      r.warehouse, r.pickingListNo, r.planDeliveryDate, r.tripNo, r.plStatus, r.tripStatus,
      r.dealerCode, r.dealerName, r.province,
      r.unit ?? '', r.totalQty ?? '', r.itemNo, r.itemName, r.itemQty ?? '', r.itemSplitQty ?? '',
    ])
    downloadCsv(`picking-list-${range.from}-${range.to}.csv`, [head, ...body])
  }

  const pls = rows ? new Set(rows.map((r) => r.pickingListNo)).size : 0
  const trips = rows ? new Set(rows.map((r) => r.tripNo).filter(Boolean)).size : 0
  const dealers = rows ? new Set(rows.map((r) => r.dealerCode).filter(Boolean)).size : 0

  return (
    <>
      <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <WarehouseNote {...wh} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PL_STATUS.map((st) => (
            <label key={st} className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={statuses.includes(st)} onChange={() => toggle(st)} />
              {st}
            </label>
          ))}
        </div>
        {/* ไม่ติ๊กเลย = เอาทุกสถานะ เขียนไว้เพราะช่องติ๊กเปล่าอ่านได้ว่า "ไม่เอาสักอัน" */}
        <span className="text-xs text-muted">ไม่เลือก = ทุกสถานะ</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button onClick={() => void load()} loading={loading} disabled={!wh.list.length}>ดึงจาก TMS</Button>
          <Button variant="ghost" onClick={exportCsv} disabled={!rows?.length}>ออกไฟล์ CSV</Button>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {rows === null ? (
        <div className="card" style={{ padding: 24 }}>
          <p className="text-muted">เลือกช่วงวันแล้วกด “ดึงจาก TMS” — ข้อมูลอ่านสดจาก TMS บริษัท ไม่ได้เก็บลงระบบนี้</p>
        </div>
      ) : (
        <>
          <div style={statGrid}>
            <Stat label="บรรทัดรายการ" value={fmtNum(rows.length)} foot={note} />
            <Stat label="ใบ (PL)" value={fmtNum(pls)} />
            <Stat label="เที่ยว" value={fmtNum(trips)} />
            <Stat label="ร้าน" value={fmtNum(dealers)} />
          </div>

          <div className="card" style={{ padding: 0 }}>
            {rows.length === 0 ? (
              <div className="ops-empty">ช่วงนี้ไม่มีใบที่เข้าเงื่อนไข</div>
            ) : (
              <div className="table-wrap">
                <table className="table ops-table">
                  <thead>
                    <tr>
                      <th>เลข PL</th>
                      <th>วันที่วางแผนส่ง</th>
                      <th>เที่ยว</th>
                      <th>สถานะใบ</th>
                      <th>ร้าน</th>
                      <th>จังหวัด</th>
                      <th className="r">หน่วย</th>
                      <th>สินค้า</th>
                      <th className="r">จำนวน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* จำกัดที่ 500 บรรทัดบนจอ ไฟล์ CSV ยังได้ครบทุกบรรทัด — ตารางหมื่นแถว
                        ทำให้เบราว์เซอร์หนืดจนเลื่อนไม่ลง ซึ่งไม่ได้ช่วยใครอ่านอะไรเพิ่ม */}
                    {rows.slice(0, 500).map((r, i) => (
                      <tr key={`${r.pickingListNo}-${r.itemNo}-${i}`}>
                        <td><b>{r.pickingListNo}</b></td>
                        <td>{r.planDeliveryDate}</td>
                        <td>{r.tripNo || <span className="text-muted">ยังไม่มีเที่ยว</span>}</td>
                        <td>{r.plStatus}</td>
                        <td>{r.dealerName || r.shipToName}</td>
                        <td>{r.province || r.shipToProvince}</td>
                        <td className="r">{r.unit ?? <span className="text-muted">—</span>}</td>
                        <td>{r.itemName || <span className="text-muted">ไม่มีรายการสินค้า</span>}</td>
                        <td className="r">{r.itemQty ?? <span className="text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 500 && (
                  <div className="text-xs text-muted" style={{ padding: '10px 16px' }}>
                    แสดง 500 บรรทัดแรกจาก {fmtNum(rows.length)} — ออกไฟล์ CSV เพื่อดูทั้งหมด
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
