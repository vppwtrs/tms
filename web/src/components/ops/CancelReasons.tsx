import { fmtNum } from '../../utils/format'
import type { CancelReason } from '../../api/opsOverview'

/**
 * ทำไมงานไม่จบในวัน — แถบยาว ไม่ใช่ตาราง
 *
 * ตารางบังคับให้อ่านตัวเลขทีละแถวแล้วเทียบในหัวเอง แถบบอกด้วยความยาวว่าอันไหน
 * ใหญ่สุดตั้งแต่ก่อนอ่านตัวเลข ซึ่งเป็นสิ่งเดียวที่ต้องรู้ตอนกวาดตาผ่าน
 *
 * ใช้ `orders.cancel_reason` ซึ่งเป็น 6 ค่าที่มีอยู่จริงใน CANCEL_STOP_REASONS
 * ไม่ใช่หมวดที่คิดขึ้นเอง — ของแถมคือทุกแถวมีเจ้าของชัด ร้านปิดคือฝ่ายขายไปคุย
 * ของไม่ครบคือคลัง ที่อยู่ผิดคือข้อมูลลูกค้า แผงที่บอกสาเหตุแล้วไม่รู้ว่าใครต้องแก้
 * ก็เป็นแค่การรายงานความซวย
 */

/** ใครเป็นคนแก้เรื่องนี้ — ผูกกับข้อความใน CANCEL_STOP_REASONS ตรงตัว
 *  เหตุผลที่ไม่รู้จัก (ของเก่า หรือที่คนขับพิมพ์เอง) ไม่ต้องเดาเจ้าของให้ */
const OWNER: Record<string, string> = {
  'ร้านปิด ไม่มีคนรับ': 'ฝ่ายขาย',
  'ร้านแจ้งยกเลิก': 'ฝ่ายขาย',
  'ต้นทางยกเลิกรายการ': 'ฝ่ายขาย',
  'ของไม่ครบ/ของผิด': 'คลัง',
  'ที่อยู่ผิด หาไม่เจอ': 'ข้อมูลลูกค้า',
  'ร้านขอเลื่อนวันส่ง': 'ฝ่ายขาย',
}

export function CancelReasons({ rows }: { rows: CancelReason[] }): React.JSX.Element {
  const total = rows.reduce((sum, r) => sum + r.orders, 0)

  if (total === 0) {
    return <p className="ops-empty">ไม่มีใบที่ถูกยกเลิกในช่วงนี้</p>
  }

  const top = rows[0]?.orders ?? 1

  return (
    <ul className="ops-reasons">
      {rows.map((r) => (
        <li key={r.reason} className="ops-reason">
          <span className="ops-reason-name">
            {r.reason}
            {OWNER[r.reason] && <span className="ops-reason-owner">{OWNER[r.reason]}</span>}
          </span>
          <b className="num">{fmtNum(r.orders)}</b>
          {/* ความยาวเทียบกับแถวที่มากที่สุด ไม่ใช่กับผลรวม — แบบหลังทำให้ทุกแถบสั้น
              จนเทียบกันไม่ออกเวลาสาเหตุกระจายหลายอัน */}
          <div className="ops-reason-bar">
            <i style={{ width: `${(r.orders / top) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
