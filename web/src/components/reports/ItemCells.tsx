import type { ShipmentItem } from '../../api/tmsReports'
import type { ItemLookup } from './useItemLookup'

/**
 * ช่อง "สินค้า" กับแถวรายการที่กางออกมา — ใช้ร่วมกันระหว่าง Actual Shipment
 * กับ Plan Simulate เพราะทั้งสองหน้าอ่านรายการจากที่เดียวกันและต้องเขียนเหมือนกัน
 *
 * ข้อความสามแบบในช่องนี้ต้องแยกกัน ไม่ยุบเป็น "ไม่มีข้อมูล" อันเดียว เพราะคนอ่าน
 * ต้องทำต่างกัน: ยังไม่ได้ค้น = กดปุ่มบนหัว · ไม่มีรายการ = ใบนั้นไม่มีของจริง ๆ
 * (TMS ตอบ totalQty 0) · หาใบไม่เจอ = เลขใบสองที่ไม่ตรงกัน ต้องมีคนไปดู
 */
export function ItemCell({ lookup, no, rowKey }: {
  lookup: ItemLookup
  no: string
  rowKey: string
}): React.JSX.Element {
  const its = lookup.itemsFor(no)
  const isOpen = lookup.open.has(rowKey)

  if (!lookup.items) return <span className="text-muted">ยังไม่มีข้อมูล</span>
  if (its?.length) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => lookup.toggle(rowKey)} aria-expanded={isOpen}>
        {isOpen ? 'ซ่อน' : `ดู ${its.length} รายการ`}
      </button>
    )
  }
  return (
    <span className="text-muted">
      {lookup.notFound.has(no) ? 'TMS หาใบนี้ไม่เจอ' : its ? 'ไม่มีรายการ' : 'ยังไม่ได้ค้น'}
    </span>
  )
}

export function ItemRows({ items, colSpan }: { items: ShipmentItem[]; colSpan: number }): React.JSX.Element {
  const anySplit = items.some((it) => it.splitQty !== null)
  return (
    <td colSpan={colSpan} style={{ background: 'var(--surface-2, rgba(127,127,127,.06))' }}>
      <table className="table" style={{ margin: 0 }}>
        <thead>
          <tr>
            <th style={{ width: 180 }}>รหัสสินค้า</th>
            <th>ชื่อสินค้า</th>
            <th className="r" style={{ width: 90 }}>จำนวน</th>
            {/* แบ่งไปเที่ยวอื่นเท่าไร — ขึ้นเฉพาะใบที่มีจริง ใบธรรมดาไม่ต้องมีคอลัมน์ว่าง */}
            {anySplit && <th className="r" style={{ width: 110 }}>แบ่งส่ง</th>}
            {/* ใบต้นทางของบรรทัด — ใบที่ถูกแบ่ง (-C-0x) ค้นทีเดียวได้รายการของพี่น้องใบมาด้วย
                ถ้าไม่บอกว่าบรรทัดไหนของใบไหน คนอ่านจะนับซ้ำ */}
            <th style={{ width: 200 }}>ใบต้นทาง</th>
            <th style={{ width: 120 }}>คลัง</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, k) => (
            <tr key={`${it.itemNo}-${k}`}>
              <td>{it.itemNo || <span className="text-muted">—</span>}</td>
              <td>{it.itemName || <span className="text-muted">—</span>}</td>
              <td className="r">{it.qty ?? <span className="text-muted">—</span>}</td>
              {anySplit && <td className="r">{it.splitQty ?? <span className="text-muted">—</span>}</td>}
              <td>{it.pickingListNo || <span className="text-muted">—</span>}</td>
              <td>{it.warehouse || <span className="text-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </td>
  )
}
