import { useState } from 'react'
import { Button, ErrorBox } from '../ui'
import { useWarehouses, WarehouseNote, WarehouseFilter } from './useWarehouses'
import { Money, Stat, statGrid, downloadCsv } from './shared'
import { actualShipment, type ActualShipmentRow } from '../../api/tmsReports'
import { useItemLookup } from './useItemLookup'
import { ItemCell, ItemRows } from './ItemCells'
import { fmtNum } from '../../utils/format'

/**
 * รายงาน Actual Shipment ของ TMS — ยอดที่ส่งจริง อ่านสดจาก TMS บริษัท
 *
 * เส้นนี้เคยเป็นแหล่งข้อมูลหลักของระบบแล้วถูกเลิกใช้ (ดูหัวไฟล์ `tmsPull.ts`)
 * เพราะสำหรับ**การนำเข้างาน** Picking List ให้ของครบกว่า แต่ในฐานะ**รายงาน**
 * มันยังเป็นเส้นเดียวที่ TMS สรุปยอดส่งจริงมาให้เป็นก้อนเดียว
 *
 * **รายละเอียดสินค้ามาจากอีกเส้นหนึ่ง** — `actualshipment` ไม่ส่ง item มาเลย
 * มีแต่เลขใบ ตัวรายการจึงมาจาก PL header ของช่วงวันเดียวกัน แล้ว join ด้วยเลขใบ
 * (ดู `shipmentItems` ใน api/tmsReports.ts) ยิงเส้นละหนึ่งครั้ง ไม่ใช่ถามรายใบ
 *
 * ใบที่หาไม่เจอในฝั่ง PL ต้องเขียนว่าหาไม่เจอ ไม่ใช่ปล่อยว่าง — ใบที่ไม่มีสินค้า
 * กับใบที่เราหารายการไม่เจอ เป็นคนละเรื่องกันสำหรับคนที่กำลังตรวจของ
 */
export function ActualShipmentReport({ range }: { range: { from: string; to: string } }): React.JSX.Element {
  const wh = useWarehouses()
  const [rows, setRows] = useState<ActualShipmentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /* รายการสินค้าอยู่ในตัวช่วยที่ใช้ร่วมกับแท็บ Plan Simulate — สองหน้านั้นอ่านรายการ
     จากที่เดียวกันและต้องเขียนบนจอเหมือนกัน มีที่เดียวจึงเพี้ยนกันไม่ได้ */
  const lookup = useItemLookup()
  /* กรองคลังหลังดึง ไม่ใช่เลือกก่อนดึง — ของมาครบทุกคลังแล้วตั้งแต่กดครั้งเดียว */
  const [only, setOnly] = useState('')

  const load = async (): Promise<void> => {
    if (!wh.list.length) return
    setLoading(true)
    setError(null)
    try {
      /* ยิงคู่กันไป ไม่เรียงกัน — สองเส้นนี้ไม่ขึ้นต่อกัน และแต่ละเส้นวิ่งข้ามประเทศ
         การรอเส้นแรกจบก่อนคือการจ่ายเวลาเดินทางสองรอบโดยไม่ได้อะไร
         ฝั่งรายการสินค้าจัดการ error ของตัวเองอยู่แล้ว จึงไม่ทำให้ทั้งรายงานล้ม */
      const [shipments] = await Promise.all([
        actualShipment(range.from, range.to, wh.list),
        lookup.load(range.from, range.to, wh.list),
      ])
      setRows(shipments)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดึง Actual Shipment จาก TMS ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  const filtered = (rows ?? []).filter((r) => !only || r.warehouse === only)
  /* วันส่งจริงใหม่สุดอยู่บนสุด — คนอ่านรายงานผลถามถึงของที่เพิ่งส่งก่อนเสมอ
     ใบที่ยังไม่ส่งไปอยู่ท้ายสุด ไม่ปนกลางตารางแบบเดาไม่ถูกว่าทำไม
     เรียงตามเที่ยวกับเลขใบซ้อนลงไป ให้ลำดับคงที่ระหว่างการกดดึงแต่ละครั้ง
     เรียงที่เดียวใช้ทั้งตารางและ CSV ไฟล์ที่ออกจึงเรียงเหมือนที่เห็นบนจอ */
  const shown = [...filtered].sort((a, b) => {
    if (a.deliveryDate !== b.deliveryDate) {
      if (!a.deliveryDate) return 1
      if (!b.deliveryDate) return -1
      return a.deliveryDate < b.deliveryDate ? 1 : -1
    }
    return (b.tripNo || '').localeCompare(a.tripNo || '') || a.pickingListNo.localeCompare(b.pickingListNo)
  })
  const missingNos = lookup.missingNos(shown.map((r) => r.pickingListNo))

  /* CSV ออกเป็น **บรรทัดละรายการสินค้า** ไม่ใช่บรรทัดละใบ — คนเอาไฟล์ไปทำ pivot
     ต่อเสมอ และใบที่มีสามรุ่นในบรรทัดเดียวคือสิ่งที่ pivot ทำอะไรต่อไม่ได้
     ใบที่ไม่มีรายการยังต้องมีหนึ่งบรรทัดของตัวเอง ไม่ใช่หายไปจากไฟล์ */
  const exportCsv = (): void => {
    if (!rows?.length) return
    const head = [
      'คลัง', 'วันที่สั่ง', 'แผนรับของ', 'รับของจริง', 'กำหนดส่ง', 'ส่งจริง',
      'เที่ยว', 'เลข PL', 'ประเภทใบ', 'รหัสร้าน', 'ร้าน', 'สาขา', 'จังหวัด', 'เขต',
      'ทะเบียน', 'คนขับ', 'ผู้ขนส่งภายนอก', 'ประเภทงาน', 'หน่วย', 'ค่าขนส่งจริง',
      'สถานะการส่ง', 'SLA', 'เหตุผล', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'แบ่งส่ง', 'ใบต้นทาง', 'คลังของใบ',
    ]
    const base = (r: ActualShipmentRow): (string | number)[] => [
      r.warehouse, r.orderDate, r.planPickupDate, r.pickupDate, r.onDeliveryDate, r.deliveryDate,
      r.tripNo, r.pickingListNo, r.pickingListType, r.dealerCode, r.dealerName, r.branch,
      r.province, r.area, r.licensePlate, r.driverName, r.outsource, r.type,
      r.unit ?? '', r.actualCost ?? '', r.statusDelivery, r.sla, r.reason,
    ]
    const body: (string | number)[][] = []
    for (const r of shown) {
      const its = lookup.itemsFor(r.pickingListNo)
      if (its?.length) for (const it of its) body.push([...base(r), it.itemNo, it.itemName, it.qty ?? '', it.splitQty ?? '', it.pickingListNo, it.warehouse])
      else body.push([...base(r), '', '', '', '', '', ''])
    }
    downloadCsv(`actual-shipment-${range.from}-${range.to}.csv`, [head, ...body])
  }

  const trips = new Set(shown.map((r) => r.tripNo).filter(Boolean)).size
  /* รวมเฉพาะบรรทัดที่มีตัวเลขจริง — บรรทัดที่ TMS ไม่ส่งค่ามาต้องไม่ถูกนับเป็น 0
     แล้วกลืนหายไปในยอดรวม จำนวนบรรทัดที่มีค่าจึงต้องขึ้นกำกับไว้ด้วย */
  const withCost = shown.filter((r) => r.actualCost !== null)
  const costSum = withCost.reduce((a, r) => a + (r.actualCost ?? 0), 0)
  /* นับตามคำที่ TMS ส่งมาตรง ๆ ไม่จัดกลุ่มเอง — เกณฑ์ตรงเวลาเป็นของเขา
     เราตีความใหม่เมื่อไหร่ เลขสองระบบจะไม่ตรงกันแล้วเถียงกันไม่จบ */
  const bySla = new Map<string, number>()
  for (const r of shown) {
    const k = r.sla || r.statusDelivery || 'ไม่ระบุ'
    bySla.set(k, (bySla.get(k) ?? 0) + 1)
  }
  const matched = lookup.items ? shown.filter((r) => lookup.itemsFor(r.pickingListNo)?.length).length : 0

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
            เลือกช่วงวันแล้วกด “ดึงจาก TMS” — ช่วงวันที่กรองคือ<b>วันที่วางแผนส่ง</b> ไม่ใช่วันที่ส่งจริง
            เพราะ TMS กรองด้วยช่องนั้น ใบที่ส่งช้าข้ามวันจึงยังอยู่ในช่วงเดิมของมัน
          </p>
        </div>
      ) : (
        <>
          <div style={statGrid}>
            <Stat label="บรรทัด" value={fmtNum(shown.length)} />
            <Stat label="เที่ยว" value={fmtNum(trips)} />
            <Stat
              label="ค่าขนส่งจริงรวม"
              value={withCost.length ? <Money value={costSum} /> : <span className="text-muted">—</span>}
              foot={`มีตัวเลข ${fmtNum(withCost.length)} จาก ${fmtNum(shown.length)} บรรทัด`}
            />
            <Stat
              label="ผลการส่งตามเกณฑ์ TMS"
              value={fmtNum(bySla.size)}
              foot={[...bySla.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k} ${fmtNum(v)}`)
                .join(' · ')}
            />
            <Stat
              label="ใบที่มีรายการสินค้า"
              value={lookup.items ? fmtNum(matched) : <span className="text-muted">—</span>}
              foot={lookup.items ? `จาก ${fmtNum(shown.length)} บรรทัด · กดที่แถวเพื่อกางรายการ` : (lookup.error ?? 'ยังไม่มีข้อมูลสินค้า')}
            />
          </div>

          {lookup.error && (
            <div className="card" style={{ padding: 12, marginBottom: 16 }}>
              <span className="text-muted">รายการสินค้าดึงไม่สำเร็จ ({lookup.error}) — ตัวเลขส่งจริงด้านบนยังใช้ได้ตามปกติ</span>
            </div>
          )}

          <div className="card" style={{ padding: 0 }}>
            {shown.length === 0 ? (
              <div className="ops-empty">ช่วงนี้ TMS ไม่มีข้อมูลส่งจริง</div>
            ) : (
              <div className="table-wrap">
                <table className="table ops-table">
                  <thead>
                    <tr>
                      <th>คลัง</th>
                      <th>ส่งจริง</th>
                      <th>เที่ยว</th>
                      <th>เลข PL</th>
                      <th>ร้าน</th>
                      <th>ทะเบียน</th>
                      <th>คนขับ</th>
                      <th className="r">หน่วย</th>
                      <th className="r">ค่าขนส่งจริง</th>
                      <th>สถานะการส่ง</th>
                      <th>SLA</th>
                      <th>สินค้า</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, 500).map((r, i) => {
                      const key = `${r.pickingListNo}-${i}`
                      const its = lookup.itemsFor(r.pickingListNo)
                      const isOpen = lookup.open.has(key)
                      return [
                        <tr key={key}>
                          <td>{r.warehouse || <span className="text-muted">—</span>}</td>
                          <td>{r.deliveryDate || <span className="text-muted">ยังไม่ส่ง</span>}</td>
                          <td>{r.tripNo || <span className="text-muted">—</span>}</td>
                          <td><b>{r.pickingListNo}</b></td>
                          <td>{r.dealerName || <span className="text-muted">—</span>}</td>
                          <td>{r.licensePlate || <span className="text-muted">—</span>}</td>
                          <td>{r.driverName || <span className="text-muted">—</span>}</td>
                          <td className="r">{r.unit ?? <span className="text-muted">—</span>}</td>
                          <td className="r"><Money value={r.actualCost} /></td>
                          <td>{r.statusDelivery || <span className="text-muted">—</span>}</td>
                          <td>{r.sla || <span className="text-muted">—</span>}</td>
                          <td><ItemCell lookup={lookup} no={r.pickingListNo} rowKey={key} /></td>
                        </tr>,
                        isOpen && its?.length ? (
                          <tr key={`${key}-items`}><ItemRows items={its} colSpan={12} /></tr>
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
