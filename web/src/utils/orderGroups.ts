/**
 * จัดออเดอร์เป็นเที่ยว > ร้าน > ใบ — ใช้ร่วมกันระหว่างหน้าออเดอร์กับหน้าพิมพ์ฉลาก
 */
import type { OrderListRow } from '../api/orders'
import type { LabelSource } from './storeLabel'
import { shipToName, storeKey as storeKeyOf } from './stops'

/** เลขที่ใช้เรียกใบนี้กับคนนอกระบบ — PL ก่อนเสมอ
 *
 * ORD เป็นเลขที่ระบบเราสร้างเอง คลัง ร้านค้า และคนขับไม่รู้จัก เวลาโทรตามของ
 * ทุกฝ่ายอ้าง PL ใบที่สร้างเองในระบบ (ไม่มี PL) จึงเป็นกรณีเดียวที่ยังต้องใช้ ORD
 */
export function billNo(o: OrderListRow): string {
  return o.tms_picking_list_no ?? o.order_no
}

export interface StoreGroup {
  key: string
  store: string
  destination: string
  /* destination เต็มทุกแบบที่อยู่ในจุดนี้ — มากกว่าหนึ่งเมื่อ TMS ส่งชื่อคนรับ
     ต่างกันมาในช่องที่อยู่ของร้านเดียวกัน */
  spots: string[]
  rows: OrderListRow[]
  /* สรุปหลักฐานระดับ "จุดแวะ" ไม่ใช่ระดับใบ — คนขับเซ็นครั้งเดียวที่หน้าร้าน
     แล้วลายเซ็นชุดนั้นถูกบันทึกลงทุกใบของร้านนั้น ป้ายรายใบจึงพูดข้อเท็จจริง
     เดียวกันซ้ำเท่าจำนวนใบ ซึ่งอ่านเหมือนมีหลักฐานหลายชุดทั้งที่มีชุดเดียว */
  delivered: number
  withPod: number
  verified: number
  /* ใบที่ใช้เปิดดูหลักฐานของจุดนี้ — ใบไหนก็ได้ที่มี POD เพราะเป็นลายเซ็นใบเดียวกัน */
  podRow: OrderListRow | null
}

/** ข้อมูลฉลากของเที่ยว — ใช้ทั้งตอนตัดสินว่าจะโชว์ปุ่มพิมพ์ และตอนพิมพ์ */
export function tripLabelSources(trip: TripGroup): LabelSource[] {
  return trip.stores.map((s) => ({
    store: s.store,
    /* ที่อยู่เต็มจาก TMS ยาวเกินร้อยตัวอักษร — ฉลากใช้แค่จังหวัด (ท้ายข้อความ "จ.…") */
    address: s.destination.match(/จ\.\s*(\S+)\s*$/)?.[1] ?? trip.area ?? '',
    rows: s.rows.map((r) => ({
      pl: r.tms_picking_list_no, orderNo: r.order_no, goods: r.goods_desc, units: r.tms_unit_count, kind: r.work_kind, items: r.items,
    })),
  }))
}

export interface TripGroup {
  key: string
  /** null = ใบที่ยังไม่ถูกจัดเข้าเที่ยว กลุ่มนั้นไม่มีเที่ยวให้ลบ */
  tripId: number | null
  tripNo: string
  driver: string | null
  warehouse: string | null
  area: string | null
  scheduled: string
  stores: StoreGroup[]
  bills: number
}

/**
 * จัดชั้นตามที่งานจริงเป็น: เที่ยว แล้วร้าน แล้วใบ แล้วรายการของ
 *
 * ตารางแบนที่หนึ่งแถวคือหนึ่งใบ ทำให้เลขเที่ยวกับชื่อร้านซ้ำลงมาทุกบรรทัด
 * จนอ่านไม่ออกว่าเที่ยวหนึ่งแวะกี่ร้าน และร้านหนึ่งต้องยกของกี่ใบ ซึ่งเป็น
 * สองคำถามแรกที่คนวางแผนถามเสมอ
 *
 * แถวยังเป็นหนึ่งใบเหมือนเดิม เพราะปุ่มแก้ไข/ยกเลิกและ POD ผูกกับใบ ไม่ใช่ผูกกับร้าน
 */
export function groupOrders(rows: OrderListRow[]): TripGroup[] {
  const norm = (v: string | null): string => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const trips = new Map<string, Map<string, OrderListRow[]>>()

  for (const o of rows) {
    /* ใบที่ยังไม่จัดเที่ยวไปรวมกันเป็นก้อนเดียว — เป็นกองงานที่ต้องจัด ไม่ใช่เที่ยว */
    const tripKey = String(o.trip_id ?? 0)
    /* ลูกค้าที่จับคู่ไว้แล้วคือตัวตนที่แน่นอนที่สุด ใช้ก่อนเสมอ ที่เหลือค่อยเดา
       จากชื่อจุดส่งกับจังหวัด — ไม่ใช่จาก destination เต็มซึ่งมีชื่อคนรับปนอยู่ */
    const storeKey = storeKeyOf(o)
    let stores = trips.get(tripKey)
    if (!stores) { stores = new Map(); trips.set(tripKey, stores) }
    const found = stores.get(storeKey)
    if (found) found.push(o)
    else stores.set(storeKey, [o])
  }

  return [...trips.entries()].map(([tripKey, stores]) => {
    const all = [...stores.values()].flat()
    const first = all[0] as OrderListRow
    return {
      key: tripKey,
      tripId: first.trip_id,
      tripNo: first.tms_trip_no ?? first.trip_no ?? 'ยังไม่จัดเที่ยว',
      driver: first.driver_name,
      warehouse: first.warehouse_code,
      area: first.area,
      scheduled: first.scheduled_at,
      bills: all.length,
      stores: [...stores.entries()].map(([storeKey, group]) => {
        const head = group[0] as OrderListRow
        /* ในร้านเรียงตามเลข PL — เลขเดียวกับที่คลังยื่นใบมาให้ */
        const rows = [...group].sort((a, b) => billNo(a).localeCompare(billNo(b), 'th'))
        const delivered = rows.filter((r) => r.status === 'delivered')
        const withPod = delivered.filter((r) => r.pod_status)
        /* ที่อยู่ที่ต่างกันภายในจุดเดียวกันไม่ถูกกลืนหาย — ยุบเป็นจุดเดียวเพื่อให้
           อ่านง่าย แต่ยังบอกครบว่าในนั้นมีที่อยู่/คนรับกี่แบบ คนวางแผนที่สงสัยว่า
           ยุบผิดร้านหรือเปล่า ต้องตรวจได้จากหน้าจอ ไม่ใช่ต้องไปเปิดฐาน */
        const spots = [...new Set(rows.map((r) => r.destination))]
        return {
          key: `${tripKey}|${storeKey}`,
          store: head.customer_name ?? shipToName(head.destination),
          destination: spots.length === 1 ? head.destination : `${spots.length} จุดส่งย่อย`,
          spots,
          rows,
          delivered: delivered.length,
          withPod: withPod.length,
          verified: withPod.filter((r) => r.pod_status === 'verified').length,
          podRow: withPod[0] ?? null,
        }
      }),
    }
  })
}
