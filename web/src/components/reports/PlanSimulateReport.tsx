import { useState } from 'react'
import { Button, ErrorBox } from '../ui'
import { useWarehouses, WarehouseNote, WarehouseFilter } from './useWarehouses'
import { Stat, statGrid, downloadCsv } from './shared'
import { planSimulate, type PlanSimulateRow } from '../../api/tmsReports'
import { useItemLookup } from './useItemLookup'
import { ItemCell, ItemRows } from './ItemCells'
import { fmtNum } from '../../utils/format'

/**
 * รายงาน Plan Simulate ของ TMS — แผนที่ TMS จัดไว้ อ่านสดจาก TMS บริษัท
 *
 * เป็น**แผน ไม่ใช่ผล**: มีรถ คนขับ ร้าน และวันนัดรับของ แต่ไม่มีวันส่งจริง
 * ไม่มีสถานะ ไม่มีค่าขนส่ง ใครถามว่า "ส่งทันไหม" ต้องไปดูแท็บ Actual Shipment
 * ตารางนี้จึงไม่มีคอลัมน์พวกนั้นให้ว่างไว้หลอกตา
 *
 * รายการสินค้ามาจากฝั่ง Picking List เหมือนแท็บ Actual Shipment (ดู `useItemLookup`)
 * เส้น plansimulate เองไม่ส่ง item มา มีแต่เลขใบ
 */
export function PlanSimulateReport({ range }: { range: { from: string; to: string } }): React.JSX.Element {
  const wh = useWarehouses()
  const [rows, setRows] = useState<PlanSimulateRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const lookup = useItemLookup()
  /* กรองคลังหลังดึง ไม่ใช่เลือกก่อนดึง — ของมาครบทุกคลังแล้วตั้งแต่กดครั้งเดียว */
  const [only, setOnly] = useState('')

  const load = async (): Promise<void> => {
    if (!wh.list.length) return
    setLoading(true)
    setError(null)
    try {
      /* ยิงคู่กันไป ไม่เรียงกัน — คนละเส้น ไม่ขึ้นต่อกัน และแต่ละเส้นวิ่งข้ามประเทศ
         ฝั่งรายการสินค้าเก็บ error ของตัวเองไว้ ไม่ทำให้แผนทั้งตารางหาย */
      const [plan] = await Promise.all([
        planSimulate(range.from, range.to, wh.list),
        lookup.load(range.from, range.to, wh.list),
      ])
      setRows(plan)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดึง Plan Simulate จาก TMS ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  /* วันนัดรับของใหม่สุดอยู่บนสุด — คนอ่านแผนถามถึงของที่กำลังจะออกก่อนเสมอ
     ใบที่ยังไม่มีวันนัด ไปอยู่ท้ายสุด ไม่ใช่ปนอยู่กลางตารางแบบเดาไม่ถูกว่าทำไม
     เรียงตามเที่ยวกับเลขใบซ้อนลงไป ให้ลำดับคงที่ ไม่สลับไปมาระหว่างการกดดึงแต่ละครั้ง
     เรียงที่เดียวแล้วใช้ทั้งตารางและ CSV ไฟล์ที่ออกจึงเรียงเหมือนที่เห็นบนจอ */
  const shown = (rows ?? []).filter((r) => !only || r.warehouse === only)
  const sorted = [...shown].sort((a, b) => {
    if (a.planPickupDate !== b.planPickupDate) {
      if (!a.planPickupDate) return 1
      if (!b.planPickupDate) return -1
      return a.planPickupDate < b.planPickupDate ? 1 : -1
    }
    return (b.tripNo || '').localeCompare(a.tripNo || '') || a.pickingListNo.localeCompare(b.pickingListNo)
  })

  const exportCsv = (): void => {
    if (!rows?.length) return
    const head = [
      'คลัง', 'เที่ยว', 'วันที่สั่ง', 'เลข PL', 'ประเภทใบ', 'รหัสร้าน', 'ร้าน', 'สาขา', 'จังหวัด',
      'เขต', 'หน่วย', 'ทะเบียน', 'คนขับ', 'นัดรับของ', 'ผู้ขนส่ง', 'ชนิดรถ', 'เหตุผล',
      'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'แบ่งส่ง', 'ใบต้นทาง', 'คลังของใบ',
    ]
    /* บรรทัดละรายการสินค้า ไม่ใช่บรรทัดละใบ — คนเอาไฟล์ไปทำ pivot ต่อเสมอ
       ใบที่ยังไม่มีรายการยังต้องมีหนึ่งบรรทัดของตัวเอง ไม่ใช่หายไปจากไฟล์ */
    const base = (r: PlanSimulateRow): (string | number)[] => [
      r.warehouse, r.tripNo, r.orderDate, r.pickingListNo, r.pickingListType, r.dealerCode, r.dealerName,
      r.branch, r.province, r.area, r.unit ?? '', r.licensePlate, r.driverName,
      r.planPickupDate, r.outsource, r.type, r.reason,
    ]
    const body: (string | number)[][] = []
    for (const r of sorted) {
      const its = lookup.itemsFor(r.pickingListNo)
      if (its?.length) for (const it of its) body.push([...base(r), it.itemNo, it.itemName, it.qty ?? '', it.splitQty ?? '', it.pickingListNo, it.warehouse])
      else body.push([...base(r), '', '', '', '', '', ''])
    }
    downloadCsv(`plan-simulate-${range.from}-${range.to}.csv`, [head, ...body])
  }

  const trips = new Set(shown.map((r) => r.tripNo).filter(Boolean)).size
  const dealers = new Set(shown.map((r) => r.dealerCode).filter(Boolean)).size
  /* แยกตามผู้ขนส่งเพราะเป็นคำถามแรกของคนอ่านแผน: อันไหนรถเรา อันไหนจ้างข้างนอก
     ใช้คำที่ TMS ส่งมาตรง ๆ ไม่จัดกลุ่มเป็น "รถเรา/รถจ้าง" เอง — การตีความนั้น
     อยู่ในโค้ดที่อื่นแล้ว (OUR_CARRIERS) ถ้าตีความสองที่แล้วไม่ตรงกันจะไล่ยาก */
  const missingNos = lookup.missingNos(shown.map((r) => r.pickingListNo))
  const matched = lookup.items ? shown.filter((r) => lookup.itemsFor(r.pickingListNo)?.length).length : 0
  const byCarrier = new Map<string, number>()
  for (const r of shown) {
    const k = r.outsource || 'ไม่ระบุ'
    byCarrier.set(k, (byCarrier.get(k) ?? 0) + 1)
  }

  return (
    <>
      <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* ช่องเลือกคลังบอกอยู่แล้วว่ามีคลังไหนบ้าง บรรทัดนี้จึงเหลือไว้เฉพาะตอน
            ยังอ่านรายชื่อไม่เสร็จหรืออ่านไม่ได้ ซึ่งเป็นตอนที่ช่องเลือกยังไม่ขึ้น */}
        {(wh.loading || wh.error) && <WarehouseNote {...wh} />}
        {/* ขึ้นตั้งแต่ก่อนกดดึง — ช่องนี้บอกด้วยว่ารายงานครอบคลุมคลังไหนบ้าง
            ซึ่งเป็นสิ่งที่ต้องรู้ก่อนกด ไม่ใช่หลังกด */}
        <WarehouseFilter
          list={wh.list}
          value={only}
          onChange={setOnly}
          total={(code) => (rows ? (code ? rows.filter((r) => r.warehouse === code).length : rows.length) : null)}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button onClick={() => void load()} loading={loading} disabled={!wh.list.length}>ดึงจาก TMS</Button>
          {missingNos.length > 0 && (
            <Button variant="ghost" onClick={() => void lookup.fill(wh.list, missingNos)} loading={lookup.filling}>
              ค้นสินค้าที่เหลือ {fmtNum(missingNos.length)} ใบ
            </Button>
          )}
          <Button variant="ghost" onClick={exportCsv} disabled={!rows?.length}>ออกไฟล์ CSV</Button>
        </div>
        {lookup.note && <div className="text-xs text-muted" style={{ width: '100%' }}>{lookup.note}</div>}
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {rows === null ? (
        <div className="card" style={{ padding: 24 }}>
          <p className="text-muted">
            เลือกช่วงวันแล้วกด “ดึงจาก TMS” — ตรงกับหน้า Report › Plan Simulate ใน TMS บริษัท
            ช่วงวันที่กรองคือ<b>วันที่วางแผนส่ง</b> เหมือนที่หน้านั้นใช้
          </p>
        </div>
      ) : (
        <>
          <div style={statGrid}>
            <Stat label="บรรทัด" value={fmtNum(shown.length)} />
            <Stat label="เที่ยวตามแผน" value={fmtNum(trips)} />
            <Stat label="ร้าน" value={fmtNum(dealers)} />
            <Stat
              label="ผู้ขนส่งตามแผน"
              value={fmtNum(byCarrier.size)}
              foot={[...byCarrier.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmtNum(v)}`).join(' · ')}
            />
            <Stat
              label="ใบที่มีรายการสินค้า"
              value={lookup.items ? fmtNum(matched) : <span className="text-muted">—</span>}
              foot={lookup.items ? `จาก ${fmtNum(shown.length)} บรรทัด · กดที่แถวเพื่อกางรายการ` : (lookup.error ?? 'ยังไม่มีข้อมูลสินค้า')}
            />
          </div>

          {lookup.error && (
            <div className="card" style={{ padding: 12, marginBottom: 16 }}>
              <span className="text-muted">รายการสินค้าดึงไม่สำเร็จ ({lookup.error}) — แผนด้านบนยังใช้ได้ตามปกติ</span>
            </div>
          )}

          <div className="card" style={{ padding: 0 }}>
            {shown.length === 0 ? (
              <div className="ops-empty">ช่วงนี้ TMS ไม่มีแผน</div>
            ) : (
              <div className="table-wrap">
                <table className="table ops-table">
                  <thead>
                    <tr>
                      <th>คลัง</th>
                      <th>เที่ยว</th>
                      <th>เลข PL</th>
                      <th>นัดรับของ</th>
                      <th>ร้าน</th>
                      <th>จังหวัด</th>
                      <th>เขต</th>
                      <th className="r">หน่วย</th>
                      <th>ทะเบียน</th>
                      <th>คนขับ</th>
                      <th>ผู้ขนส่ง</th>
                      <th>ชนิดรถ</th>
                      <th>สินค้า</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.slice(0, 500).map((r, i) => {
                      const key = `${r.pickingListNo}-${i}`
                      const its = lookup.itemsFor(r.pickingListNo)
                      const isOpen = lookup.open.has(key)
                      return [
                        <tr key={key}>
                          <td>{r.warehouse || <span className="text-muted">—</span>}</td>
                          <td>{r.tripNo || <span className="text-muted">ยังไม่มีเที่ยว</span>}</td>
                          <td><b>{r.pickingListNo}</b></td>
                          <td>{r.planPickupDate || <span className="text-muted">—</span>}</td>
                          <td>{r.dealerName || <span className="text-muted">—</span>}</td>
                          <td>{r.province || <span className="text-muted">—</span>}</td>
                          <td>{r.area || <span className="text-muted">—</span>}</td>
                          <td className="r">{r.unit ?? <span className="text-muted">—</span>}</td>
                          <td>{r.licensePlate || <span className="text-muted">ยังไม่มีรถ</span>}</td>
                          <td>{r.driverName || <span className="text-muted">ยังไม่มีคนขับ</span>}</td>
                          <td>{r.outsource || <span className="text-muted">—</span>}</td>
                          <td>{r.type || <span className="text-muted">—</span>}</td>
                          <td><ItemCell lookup={lookup} no={r.pickingListNo} rowKey={key} /></td>
                        </tr>,
                        isOpen && its?.length ? (
                          <tr key={`${key}-items`}><ItemRows items={its} colSpan={13} /></tr>
                        ) : null,
                      ]
                    })}
                  </tbody>
                </table>
                {shown.length > 500 && (
                  <div className="text-xs text-muted" style={{ padding: '10px 16px' }}>
                    แสดง 500 บรรทัดแรกจาก {fmtNum(shown.length)} — ออกไฟล์ CSV เพื่อดูทั้งหมด (ไฟล์ออกบรรทัดละรายการสินค้า)
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
