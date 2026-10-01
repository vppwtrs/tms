/**
 * แทน api/orders — หน้า "จัดการออเดอร์" ของฝ่ายวางแผนในโหมดสาธิต
 *
 * ข้อมูลแต่งขึ้นทั้งหมด อยู่ในหน่วยความจำ รีเฟรชแล้วกลับค่าตั้งต้น
 * ฟังก์ชันที่จอนี้ไม่ใช้ re-export ของจริงไว้ให้ import ครบ (เรียกจริงจะ error เหมือนเดิม)
 * พาธ './../api/orders' จงใจไม่ขึ้นต้นด้วย '../api/' — กัน alias วนกลับมาที่ไฟล์นี้
 */
import type { OrderRow } from '../types/database.js'
import type { Paged } from './customers.js'
import type { OrderFilter, OrderInput, OrderListRow, RemovedOrder } from './../api/orders.js'
import { DEMO_CUSTOMERS } from './customers.js'
import { DEMO_DRIVERS } from './vehicles.js'

export * from './../api/orders.js'

function dayAt(offset: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

interface Seed {
  day: number
  hour: number
  customer: number
  status: OrderRow['status']
  trip?: { id: number; no: string; driver: number; wh: string; area: string }
  goods: string
  qty: number
  urgent?: boolean
  pod?: 'collected' | 'verified'
}

const T1 = { id: 1, no: 'TRIP-DEMO-01', driver: 1, wh: 'WH-DEMO', area: 'กรุงเทพฯ ตะวันออก' }
const T2 = { id: 2, no: 'TRIP-DEMO-02', driver: 2, wh: 'WH-DEMO', area: 'สมุทรปราการ' }
const T3 = { id: 3, no: 'TRIP-DEMO-03', driver: 3, wh: 'WH-NORTH', area: 'นนทบุรี' }
const T0 = { id: 4, no: 'TRIP-DEMO-00', driver: 1, wh: 'WH-DEMO', area: 'กรุงเทพฯ ตะวันออก' }

const SEEDS: Seed[] = [
  { day: 0, hour: 9, customer: 1, status: 'assigned', trip: T1, goods: 'น้ำดื่ม', qty: 12 },
  { day: 0, hour: 11, customer: 2, status: 'assigned', trip: T1, goods: 'อาหารแห้ง', qty: 5 },
  { day: 0, hour: 11, customer: 2, status: 'assigned', trip: T1, goods: 'เครื่องดื่ม', qty: 3 },
  { day: 0, hour: 14, customer: 3, status: 'assigned', trip: T1, goods: 'ของใช้', qty: 8, urgent: true },
  { day: 0, hour: 8, customer: 4, status: 'delivered', trip: T2, goods: 'ขนมขบเคี้ยว', qty: 20, pod: 'collected' },
  { day: 0, hour: 10, customer: 5, status: 'in_transit', trip: T2, goods: 'น้ำดื่ม', qty: 15 },
  { day: 0, hour: 13, customer: 6, status: 'in_transit', trip: T2, goods: 'ของใช้', qty: 6 },
  { day: 0, hour: 15, customer: 7, status: 'pending', goods: 'เครื่องดื่ม', qty: 10 },
  { day: 0, hour: 16, customer: 8, status: 'pending', goods: 'อาหารแห้ง', qty: 4, urgent: true },
  { day: 1, hour: 9, customer: 1, status: 'assigned', trip: T3, goods: 'น้ำดื่ม', qty: 18 },
  { day: 1, hour: 11, customer: 6, status: 'assigned', trip: T3, goods: 'ขนมขบเคี้ยว', qty: 9 },
  { day: 1, hour: 13, customer: 3, status: 'pending', goods: 'ของใช้', qty: 7 },
  { day: 3, hour: 10, customer: 5, status: 'pending', goods: 'เครื่องดื่ม', qty: 12 },
  { day: -1, hour: 9, customer: 4, status: 'delivered', trip: T0, goods: 'น้ำดื่ม', qty: 10, pod: 'verified' },
  { day: -1, hour: 11, customer: 7, status: 'delivered', trip: T0, goods: 'อาหารแห้ง', qty: 6, pod: 'verified' },
  { day: -1, hour: 14, customer: 8, status: 'cancelled', trip: T0, goods: 'ของใช้', qty: 3 },
]

const customerOf = (id: number | null) => DEMO_CUSTOMERS.find((c) => c.id === id) ?? null

function build(): OrderListRow[] {
  return SEEDS.map((s, i): OrderListRow => {
    const id = 500 + i
    const c = customerOf(s.customer)!
    const at = dayAt(s.day, s.hour)
    return {
      id,
      order_no: `ORD-DEMO-${String(id).padStart(4, '0')}`,
      customer_id: c.id,
      origin: s.trip?.wh === 'WH-NORTH' ? 'คลังสมมติ นนทบุรี' : 'คลังสมมติ บางนา',
      destination: `${c.name} · ${c.address ?? ''}`,
      goods_desc: `${s.goods} ${s.qty} ลัง`,
      weight_kg: s.qty * 12,
      distance_km: 5 + (i % 5) * 4,
      fee: s.qty * 35,
      priority: s.urgent ? 'urgent' : 'normal',
      status: s.status,
      scheduled_at: at,
      delivered_at: s.status === 'delivered' ? dayAt(s.day, s.hour, 40) : null,
      trip_id: s.trip?.id ?? null,
      seq: null,
      notes: null,
      work_kind: null,
      tms_trip_no: s.trip ? s.trip.no.replace('TRIP', 'TMS') : null,
      tms_picking_list_no: `PL-DEMO-${String(i + 1).padStart(3, '0')}`,
      tms_unit_count: s.qty,
      cancel_reason: s.status === 'cancelled' ? 'ร้านปิด' : null,
      cancelled_at: s.status === 'cancelled' ? dayAt(s.day, s.hour, 30) : null,
      cancelled_by: null,
      created_at: dayAt(s.day - 1, 16),
      updated_at: at,
      customer_name: c.name,
      driver_name: s.trip ? DEMO_DRIVERS.find((d) => d.id === s.trip!.driver)?.name ?? null : null,
      trip_no: s.trip?.no ?? null,
      warehouse_code: s.trip?.wh ?? null,
      area: s.trip?.area ?? null,
      pod_status: s.pod ?? null,
      items: [{ item_no: `SKU-${100 + (i % 7)}`, item_name: s.goods, qty: s.qty }],
    }
  })
}

let rows = build()
let nextId = 500 + rows.length

const ms = (s: string): number => new Date(s).getTime()

export async function listOrders(f: OrderFilter = {}): Promise<Paged<OrderListRow>> {
  const page = f.page ?? 1
  const limit = f.limit ?? 20
  const q = f.q?.toLowerCase()
  const hit = rows.filter((r) =>
    (!q || [r.order_no, r.tms_picking_list_no, r.tms_trip_no, r.origin, r.destination, r.goods_desc]
      .some((v) => v?.toLowerCase().includes(q)))
    && (!f.status || r.status === f.status)
    && (!f.priority || r.priority === f.priority)
    && (!f.customerId || r.customer_id === f.customerId)
    && (!f.driverId || SEEDS[r.id - 500]?.trip?.driver === f.driverId)
    && (!f.from || ms(r.scheduled_at) >= ms(f.from))
    && (!f.to || ms(r.scheduled_at) <= ms(f.to)))
  /* ลำดับเดียวกับของจริง: วันใหม่ก่อน แล้วเที่ยว แล้วร้าน แล้วเลข PL */
  hit.sort((a, b) =>
    b.scheduled_at.slice(0, 10).localeCompare(a.scheduled_at.slice(0, 10))
    || (b.trip_id ?? -1) - (a.trip_id ?? -1)
    || a.destination.localeCompare(b.destination)
    || (a.tms_picking_list_no ?? '').localeCompare(b.tms_picking_list_no ?? '')
    || a.id - b.id)
  const start = (page - 1) * limit
  return { rows: hit.slice(start, start + limit), total: hit.length, page, limit }
}

export async function createOrder(input: Partial<OrderInput> & {
  origin: string
  destination: string
  goods_desc: string
  scheduled_at: string
}): Promise<OrderRow> {
  const id = nextId++
  const now = new Date().toISOString()
  const row: OrderListRow = {
    ...rows[0]!,
    customer_id: null, distance_km: 0, weight_kg: 0, fee: 0, priority: 'normal', notes: null,
    tms_trip_no: null, tms_picking_list_no: null, tms_unit_count: null, work_kind: null, seq: null,
    ...input,
    id,
    order_no: `ORD-DEMO-${String(id).padStart(4, '0')}`,
    status: 'pending',
    trip_id: null,
    delivered_at: null,
    cancel_reason: null, cancelled_at: null, cancelled_by: null,
    created_at: now,
    updated_at: now,
    customer_name: customerOf(input.customer_id ?? null)?.name ?? null,
    driver_name: null, trip_no: null, warehouse_code: null, area: null, pod_status: null, items: [],
  }
  rows = [row, ...rows]
  return row
}

export async function updateOrder(id: number, input: Partial<OrderInput>): Promise<OrderRow> {
  const cur = rows.find((r) => r.id === id)
  if (!cur) throw new Error('ไม่พบออเดอร์')
  const next: OrderListRow = { ...cur, ...input, updated_at: new Date().toISOString() }
  if (input.customer_id !== undefined) next.customer_name = customerOf(input.customer_id)?.name ?? null
  rows = rows.map((r) => (r.id === id ? next : r))
  return next
}

export async function removeOrder(id: number): Promise<RemovedOrder> {
  const cur = rows.find((r) => r.id === id)
  if (!cur) throw new Error('ไม่พบออเดอร์')
  if (cur.pod_status) throw new Error('ใบนี้เก็บหลักฐานการส่งมอบแล้ว ลบไม่ได้')
  rows = rows.filter((r) => r.id !== id)
  const tripRemoved = cur.trip_id !== null && !rows.some((r) => r.trip_id === cur.trip_id)
  return { deleted: 1, order_no: cur.order_no, trip_removed: tripRemoved, trip_no: cur.trip_no }
}
