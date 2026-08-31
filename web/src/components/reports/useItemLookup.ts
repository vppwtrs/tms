import { useRef, useState } from 'react'
import { shipmentItems, itemsOf, fillItemsByNo, type ShipmentItem } from '../../api/tmsReports'
import type { Warehouse } from '../../api/tmsPull'

/**
 * รายการสินค้าของใบ สำหรับรายงานที่มีแต่เลขใบ (Actual Shipment / Plan Simulate)
 *
 * ทั้งสองเส้นนั้นไม่ส่ง item มาเลย มีแต่เลขใบ ตัวรายการต้องไปเอาจากฝั่ง Picking List
 * ซึ่งมีสองทาง และต้นทุนต่างกันคนละชั้น จึงแยกเป็นสองจังหวะ ไม่ใช่ยิงรวดเดียว:
 *
 *   1. `load()` — ดึง PL ของช่วงวันเดียวกันมาก้อนเดียวแล้ว join ด้วยเลขใบ ยิงครั้งเดียว
 *   2. `fill()` — ใบที่ข้อ 1 ไล่ไม่ถึง (ออกก่อนช่วงวันที่เลือก) ค้นทีละเลขผ่าน
 *      `scanPickingListsByNo` เป็นสิบถึงร้อยคำขอ คนที่แค่อยากดูยอดไม่ควรต้องจ่ายเวลานั้น
 *      จึงต้องกดปุ่มเอง
 *
 * ผลของข้อ 2 ถูกจำไว้ใน ref ข้ามการกด "ดึงจาก TMS" รอบใหม่ — ไม่งั้นกดดึงซ้ำทีไร
 * คอลัมน์สินค้ากลับไปเป็น "ยังไม่ได้ค้น" ทั้งที่เพิ่งค้นเสร็จ และคนใช้ต้องจ่ายคำขอ
 * เป็นร้อยไปหา TMS ซ้ำเพื่อได้คำตอบเดิม ใบหนึ่งใบมีสินค้าอะไรไม่เปลี่ยนระหว่างเปิดหน้าอยู่
 */
export interface ItemLookup {
  items: Map<string, ShipmentItem[]> | null
  /** ใบที่ค้นแล้ว TMS บอกว่าไม่มีใบนี้ — ต่างจากใบที่มีอยู่แต่ไม่มีรายการสินค้า */
  notFound: Set<string>
  open: Set<string>
  toggle: (key: string) => void
  error: string | null
  filling: boolean
  note: string
  itemsFor: (pickingListNo: string) => ShipmentItem[] | null
  /** ใบที่ยังไม่มีรายการ — ตัวเลขนี้คือจำนวนคำขอที่จะยิงเพิ่ม จึงต้องบอกก่อนกด */
  missingNos: (nos: string[]) => string[]
  load: (from: string, to: string, warehouses: Warehouse[]) => Promise<void>
  fill: (warehouses: Warehouse[], nos: string[]) => Promise<void>
}

/** ถอยวันเริ่มต้นของรอบไล่ PL ไปกี่วัน
 *
 *  ใบถูก**วางแผน**ส่งวันหนึ่งแล้ว**ส่งจริง**อีกวันหนึ่ง รอบไล่ PL กรองด้วยวันวางแผน
 *  ส่วนรายงานกรองด้วยช่วงที่ผู้ใช้เลือก ใบที่วางแผนไว้ก่อนช่วงนั้นจึงหลุดออกทั้งหมด
 *  แล้วขึ้นบนจอว่า "ยังไม่ได้ค้น" ทั้งที่ของอยู่ห่างไปไม่กี่วัน — ยิ่งช่วงวันแคบยิ่งหลุดเยอะ
 *
 *  ถอยกลับสามสัปดาห์คือการอ่านเพิ่มไม่กี่หน้าในคำขอเดียวกัน ถูกกว่าการค้นทีละใบ
 *  เป็นสิบถึงร้อยคำขอหลายเท่า ใบที่ยังหลุดจากช่วงนี้จริง ๆ ค่อยใช้ปุ่มค้นรายใบ */
const ITEM_LOOKBACK_DAYS = 21

const itemsFrom = (from: string): string => {
  const d = new Date(`${from}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return from
  d.setUTCDate(d.getUTCDate() - ITEM_LOOKBACK_DAYS)
  return d.toISOString().slice(0, 10)
}

export function useItemLookup(): ItemLookup {
  const [items, setItems] = useState<Map<string, ShipmentItem[]> | null>(null)
  const [notFound, setNotFound] = useState<Set<string>>(new Set())
  /* กางทีละหลายใบได้ คนตรวจของมักเทียบสองสามใบพร้อมกัน */
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [filling, setFilling] = useState(false)
  const [note, setNote] = useState('')
  const filled = useRef<Map<string, ShipmentItem[]>>(new Map())
  const notFoundRef = useRef<Set<string>>(new Set())

  const load = async (from: string, to: string, warehouses: Warehouse[]): Promise<void> => {
    setOpen(new Set())
    setError(null)
    setNotFound(new Set(notFoundRef.current))
    try {
      const byDate = await shipmentItems(itemsFrom(from), to, warehouses)
      /* ผลรอบวันเป็นฐาน แล้วทับด้วยผลค้นรายใบที่เคยได้มา — ทับทางนี้เพราะผลรายใบ
         เจาะจงกว่า และเป็นตัวที่ครอบใบที่รอบวันไล่ไม่ถึงตั้งแต่แรก */
      setItems(new Map([...byDate, ...filled.current]))
    } catch (e) {
      /* รายการสินค้าล้มไม่ควรทำให้ทั้งรายงานหาย — ตัวเลขของรายงานยังใช้ได้ด้วยตัวเอง
         แค่บอกให้รู้ว่าคอลัมน์สินค้าจะว่างเพราะอะไร */
      setItems(null)
      setError(e instanceof Error ? e.message : 'ดึงรายการสินค้าไม่สำเร็จ')
    }
  }

  const itemsFor = (no: string): ShipmentItem[] | null => (items ? itemsOf(items, no) : null)

  const missingNos = (nos: string[]): string[] =>
    items ? [...new Set(nos.filter((no) => no && !itemsOf(items, no)))] : []

  const fill = async (warehouses: Warehouse[], nos: string[]): Promise<void> => {
    if (!items || nos.length === 0) return
    setFilling(true)
    setNote('')
    try {
      const next = await fillItemsByNo(items, warehouses, nos, (done, total) =>
        setNote(`ค้นแล้ว ${done} จาก ${total} ใบ`))
      setItems(next.items)
      setNotFound(next.notFound)
      /* จำเฉพาะใบที่รอบนี้ค้นมาได้ ไม่ใช่ทั้งตาราง — ตารางมีผลรอบวันปนอยู่ด้วย
         ซึ่งตัวมันเองมาใหม่ทุกครั้งที่กดดึงอยู่แล้ว */
      for (const no of nos) {
        const got = itemsOf(next.items, no)
        if (got) filled.current.set(no, got)
      }
      notFoundRef.current = next.notFound
      setNote(next.notFound.size
        ? `TMS หาไม่เจอ ${next.notFound.size} ใบ — เลขใบในรายงานกับในทะเบียนใบไม่ตรงกัน`
        : '')
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'ค้นรายการสินค้าไม่สำเร็จ')
    } finally {
      setFilling(false)
    }
  }

  const toggle = (key: string): void =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return { items, notFound, open, toggle, error, filling, note, itemsFor, missingNos, load, fill }
}
