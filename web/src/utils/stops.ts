import type { MyJobOrder } from '../types'

/**
 * จุดส่งหนึ่งจุด = หนึ่งร้าน ไม่ใช่หนึ่งใบ
 *
 * TMS ส่งข้อมูลมาเป็นระดับใบเบิก (picking list) ร้านเดียวสั่งของหลายใบเป็นเรื่องปกติ
 * ถ้าเอาใบมาวางเป็นจุดส่งตรง ๆ คนขับจะเห็นร้านเดิมซ้ำติดกันหลายบรรทัด แล้วต้องกด
 * "ส่งเสร็จ" ซ้ำที่หน้าร้านเดียว ซึ่งอ่านไม่ออกว่าทำไม และกดตกไปใบหนึ่งเมื่อไหร่
 * ใบนั้นก็ค้างเป็นของที่ยังไม่ส่งทั้งที่ของถึงร้านแล้ว
 */
export interface StopGroup {
  /** คีย์ของร้าน — ใช้เป็น key ของ React และตัวชี้จุดที่กางอยู่ */
  key: string
  /** ใบทั้งหมดของร้านนี้ เรียงตามลำดับที่มาในเที่ยว */
  orders: MyJobOrder[]
  destination: string
  customer_name: string | null
  customer_phone: string | null
  customer_address: string | null
  /** เวลานัดที่เร็วที่สุดในบรรดาใบของร้านนี้ */
  scheduled_at: string
  /** ส่งครบทุกใบแล้ว (ใบที่ถูกยกเลิกไม่นับว่าค้าง) */
  done: boolean
  /** ทุกใบถูกยกเลิก — ไม่ต้องไปร้านนี้ */
  cancelled: boolean
  /** ใบที่ยังต้องส่งของร้านนี้ */
  pending: MyJobOrder[]
  /** ใบที่ส่งแล้วแต่ยังไม่มีหลักฐาน */
  needPod: MyJobOrder[]
  weight_kg: number
  unit_count: number
}

/** ชื่อร้าน + ที่อยู่ = ตัวระบุร้าน — ฐานไม่ได้ส่ง customer_id มาในชุดข้อมูลของคนขับ */
function keyOf(o: MyJobOrder): string {
  const norm = (s: string | null): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return `${norm(o.customer_name) || norm(o.destination)}|${norm(o.customer_address)}`
}

/**
 * รวมใบของร้านเดียวกันเป็นจุดเดียว โดยคงลำดับการแวะไว้ตามใบแรกของร้านนั้น
 *
 * ร้านเดียวกันที่อยู่คนละช่วงของรายการก็ถูกดึงมารวมกัน เพราะการไปร้านเดิมสองรอบ
 * ในเที่ยวเดียวไม่ใช่สิ่งที่คนขับตั้งใจทำ
 */
export function groupStops(orders: MyJobOrder[]): StopGroup[] {
  const byKey = new Map<string, MyJobOrder[]>()
  for (const o of orders) {
    const k = keyOf(o)
    const list = byKey.get(k)
    if (list) list.push(o)
    else byKey.set(k, [o])
  }

  return [...byKey.entries()].map(([key, list]) => {
    const first = list[0] as MyJobOrder
    const pending = list.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled')
    const delivered = list.filter((o) => o.status === 'delivered')
    return {
      key,
      orders: list,
      destination: first.destination,
      customer_name: first.customer_name,
      /* ใบแรกอาจไม่มีเบอร์ ใบอื่นของร้านเดียวกันอาจมี — เอาอันที่มีก่อน */
      customer_phone: list.find((o) => o.customer_phone)?.customer_phone ?? null,
      customer_address: list.find((o) => o.customer_address)?.customer_address ?? null,
      scheduled_at: list.reduce((min, o) => (o.scheduled_at < min ? o.scheduled_at : min), first.scheduled_at),
      done: pending.length === 0 && delivered.length > 0,
      cancelled: pending.length === 0 && delivered.length === 0,
      pending,
      needPod: delivered.filter((o) => !o.has_pod),
      weight_kg: list.reduce((sum, o) => sum + (o.weight_kg || 0), 0),
      unit_count: list.reduce((sum, o) => sum + (o.tms_unit_count ?? 0), 0),
    }
  })
}
