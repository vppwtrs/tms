import { useEffect, useState } from 'react'
import { Select } from '../ui'
import { listWarehouses, type Warehouse } from '../../api/tmsPull'

/**
 * คลังทั้งหมดที่ระบบนี้รับผิดชอบ — รายงานดึงทุกคลังพร้อมกัน ไม่ให้เลือกทีละคลัง
 *
 * เจ้าของงานสั่งเมื่อ 31 ส.ค. 2569 ว่าให้ดึงทั้งสองคลังในการกดครั้งเดียว การเลือก
 * ทีละคลังแปลว่าต้องกดสองรอบแล้วเอาสองไฟล์มาต่อกันเอง ซึ่งไม่ใช่สิ่งที่คนอ่าน
 * รายงานอยากทำ
 *
 * รายชื่อมาจากบัญชี TMS ที่ล็อกอินอยู่ ไม่ใช่ค่าคงที่ในโค้ด (`listWarehouses`
 * กรองเหลือเฉพาะคลังที่ระบบนี้รับผิดชอบให้แล้ว) ยังไม่ได้ล็อกอิน TMS จะอ่านไม่ได้
 * ซึ่งต้องบอกตรง ๆ ว่าให้ไปล็อกอิน ไม่ใช่ขึ้นตารางว่างที่อ่านได้ว่า "ไม่มีงาน"
 */
export function useWarehouses(): { list: Warehouse[]; loading: boolean; error: string | null } {
  const [list, setList] = useState<Warehouse[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    listWarehouses()
      .then((ws) => { if (alive) { setList(ws); setError(null) } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'อ่านรายชื่อคลังไม่ได้') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return { list, loading, error }
}

/** บรรทัดบอกว่ารายงานนี้ครอบคลุมคลังไหนบ้าง — คนอ่านต้องรู้ขอบเขตก่อนเชื่อตัวเลข */
export function WarehouseNote({ list, loading, error }: {
  list: Warehouse[]
  loading: boolean
  error: string | null
}): React.JSX.Element {
  if (loading) return <span className="text-muted">กำลังอ่านรายชื่อคลัง…</span>
  if (error) return <span className="text-muted">{error}</span>
  return <span className="text-muted">คลัง {list.map((w) => w.code).join(' · ')}</span>
}

/** ตัวกรองคลังของรายงานที่ดึงมาทั้งสองคลังแล้ว
 *
 *  **กรอง ไม่ใช่เลือกก่อนดึง** — ของถูกดึงมาครบทุกคลังตั้งแต่กดครั้งเดียวแล้ว
 *  ตัวนี้แค่ตัดสินว่าจะโชว์อันไหน จึงสลับดูได้ทันทีโดยไม่ต้องยิงหา TMS ใหม่
 *  และยอดรวมด้านบนกับไฟล์ CSV เดินตามตัวกรองนี้เสมอ ไม่ใช่โชว์ยอดของทั้งหมด
 *  ทับตารางที่กรองแล้ว ซึ่งจะอ่านได้ว่าเลขสองที่ไม่ตรงกัน
 *
 *  เป็นช่องเลือกแบบเดียวกับตัวเลือกคลังเดิมของ TMS ตามที่เจ้าของงานขอ — ชื่อเต็ม
 *  ของคลังอยู่ในนั้นด้วย เพราะรหัสคลังอย่างเดียวคนอ่านแยกไม่ออกว่า KM.12 หรือ KM.21
 *  จำนวนต่อคลังติดท้าย คนอ่านจึงรู้ว่าเลือกแล้วจะเหลือเท่าไรก่อนเลือก */
export function WarehouseFilter({ list, value, onChange, total }: {
  list: Warehouse[]
  value: string
  onChange: (code: string) => void
  /** จำนวนบรรทัดของคลังนั้น — null ตอนยังไม่ได้ดึง จะได้ไม่ขึ้น "(0)" ให้เข้าใจผิด
   *  ว่าคลังนั้นไม่มีงาน ทั้งที่แค่ยังไม่ได้ถาม */
  total: (code: string) => number | null
}): React.JSX.Element | null {
  if (list.length < 2) return null
  const label = (w: Warehouse): string => (w.description ? `${w.code} · ${w.description}` : w.code)
  const count = (code: string): string => {
    const n = total(code)
    return n === null ? '' : ` (${n})`
  }
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="กรองตามคลัง">
      <option value="">ทุกคลัง{count('')}</option>
      {list.map((w) => (
        <option key={w.code} value={w.code}>{label(w)}{count(w.code)}</option>
      ))}
    </Select>
  )
}
