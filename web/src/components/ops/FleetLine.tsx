import { fmtNum } from '../../utils/format'
import type { OverviewCapacity } from '../../api/opsOverview'

/**
 * สภาพกองรถ — บรรทัดเดียวข้างหัวข้อตารางรถ
 *
 * เคยเป็นการ์ดของตัวเองพร้อมแถบวัดสามแถบ ซึ่งกินความสูงเกือบสองร้อยพิกเซล
 * เพื่อบอกตัวเลขสามตัวที่คนอ่านครั้งเดียวแล้วจำได้ทั้งวัน — แถบวัดมีประโยชน์
 * ตอนที่ต้องเทียบสัดส่วนของหลายอย่างพร้อมกัน ไม่ใช่ตอนที่มีสามตัวเลขติดกัน
 *
 * อยู่ข้างหัวข้อ "รถแต่ละคันถึงไหนแล้ว" เพราะมันคือบริบทของตารางนั้นโดยตรง:
 * ตารางบอกว่ารถที่ออกไปแล้วอยู่ไหน บรรทัดนี้บอกว่ายังเหลือรถอีกกี่คัน
 */

export function FleetLine({ capacity }: { capacity: OverviewCapacity | null }): React.JSX.Element | null {
  if (!capacity) return null

  return (
    <span className="ops-fleetline">
      <span>วิ่งอยู่ <b className="num">{fmtNum(capacity.vehicles_running)}</b></span>
      <span>ว่าง <b className="num">{fmtNum(capacity.vehicles_free)}</b></span>
      {/* ซ่อม/หยุดไม่ใช่ทางเลือกของวันนี้ จึงขึ้นเฉพาะเมื่อมีจริง
          ศูนย์คันที่เขียนไว้ทุกวันคือบรรทัดที่คนเลิกอ่านตั้งแต่สัปดาห์แรก */}
      {capacity.vehicles_off > 0 && <span>ซ่อม/หยุด <b className="num">{fmtNum(capacity.vehicles_off)}</b></span>}
      {/* คนขับว่างเป็นเพดานจริงของการจ่ายงาน รถว่างสิบคันแต่คนขับว่างคนเดียว
          ก็ปล่อยได้เที่ยวเดียว จึงต้องอยู่ในสายตาเดียวกับรถ */}
      <span>คนขับว่าง <b className="num">{fmtNum(capacity.drivers_free)}</b></span>
    </span>
  )
}
