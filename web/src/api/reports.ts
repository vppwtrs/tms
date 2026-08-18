import { supabase, unwrap } from './supabase.js'
import type { OrderRow, TripRow, CustomerRow, DriverRow } from '../types/database.js'

/**
 * รายงาน — แทน server/src/modules/reports
 *
 * **ตัวนี้รวมยอดในเบราว์เซอร์ ไม่ใช่ใน SQL** ซึ่งต่างจากของเดิมที่เขียนเป็น query รวมยอด
 * เหตุผล: ของเดิมมีสิบกว่า query ที่ join กันหลายชั้น ย้ายมาเป็น RPC ทั้งหมดคืองานอีกก้อน
 * และตอนนี้ข้อมูลระดับ SME (หลักพันแถวต่อเดือน) ดึงมารวมฝั่ง client ยังเร็วกว่าที่คนรอไหว
 *
 * **เส้นที่ต้องย้ายไป SQL**: ถ้าช่วงที่เลือกดึงเกิน ~5,000 แถว หรือหน้ารายงานเริ่มค้าง
 * ให้ย้ายไปเป็น RPC ที่ return json ก้อนเดียว อย่าฝืนเพิ่มการรวมยอดในนี้ต่อ
 * PostgREST มีเพดาน 1,000 แถวต่อ request อยู่แล้ว — โค้ดข้างล่างไล่หน้าเอง ไม่ได้ปิดตาข้ามไป
 */

/* PostgREST ส่งกลับสูงสุด 1,000 แถวต่อ request — ไล่หน้าจนกว่าจะได้ไม่เต็มหน้า
   เพดาน 20 หน้า (20,000 แถว) กันลูปไม่รู้จบ ถ้าชนเพดานแปลว่าถึงเวลาย้ายไป SQL แล้วจริง ๆ */
const PAGE = 1000
const MAX_PAGES = 20

async function fetchOrders(fromIso: string, toEx: string): Promise<OrderRow[]> {
  const out: OrderRow[] = []
  for (let p = 0; p < MAX_PAGES; p++) {
    const rows = await unwrap(
      supabase
        .from('orders')
        .select('*')
        .gte('scheduled_at', fromIso)
        .lt('scheduled_at', toEx)
        .order('id')
        .range(p * PAGE, p * PAGE + PAGE - 1),
    )
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

async function fetchTrips(fromIso: string, toEx: string): Promise<TripRow[]> {
  const out: TripRow[] = []
  for (let p = 0; p < MAX_PAGES; p++) {
    const rows = await unwrap(
      supabase
        .from('trips')
        .select('*')
        .gte('created_at', fromIso)
        .lt('created_at', toEx)
        .order('id')
        .range(p * PAGE, p * PAGE + PAGE - 1),
    )
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export interface ReportKpis {
  orders_total: number
  orders_delivered: number
  orders_cancelled: number
  revenue: number
  trips_total: number
  trips_completed: number
  trip_cost: number
  /** ค่าจ้างขนส่งรวมจาก TMS — คนละก้อนกับ trip_cost ที่เป็นต้นทุนระหว่างทาง */
  freight_cost: number
  weight_kg: number
}

export interface ReportResult {
  from: string
  to: string
  kpis: ReportKpis
  by_status: { status: string; count: number }[]
  top_customers: { customer_id: number; name: string; orders: number; revenue: number }[]
  lanes: { lane: string; orders: number; revenue: number }[]
  driver_performance: { driver_id: number; name: string; trips: number; orders: number }[]
}

/** ช่วงเวลาใช้ scheduled_at ของออเดอร์ และรวมทั้งวันสุดท้าย (เหมือน generate() เดิมที่ +1 วัน) */
export async function generateReport(fromIso: string, toIso: string): Promise<ReportResult> {
  const toExclusive = new Date(toIso)
  toExclusive.setDate(toExclusive.getDate() + 1)
  const toEx = toExclusive.toISOString()

  const [orders, trips] = await Promise.all([fetchOrders(fromIso, toEx), fetchTrips(fromIso, toEx)])

  const delivered = orders.filter((o) => o.status === 'delivered')
  const kpis: ReportKpis = {
    orders_total: orders.length,
    orders_delivered: delivered.length,
    orders_cancelled: orders.filter((o) => o.status === 'cancelled').length,
    /* รายได้นับเฉพาะใบที่ส่งสำเร็จ — ใบที่ยังไม่ส่งยังไม่ใช่เงิน */
    revenue: delivered.reduce((s, o) => s + o.fee, 0),
    trips_total: trips.length,
    trips_completed: trips.filter((t) => t.status === 'completed').length,
    trip_cost: trips.reduce((s, t) => s + t.fuel_cost + t.toll_cost + t.other_cost, 0),
    /* ค่าจ้างขนส่งที่ TMS ปิดยอดแล้วเป็นตัวตั้ง ถ้ายังไม่ปิดค่อยใช้ยอดตามสัญญา
       เที่ยวที่ไม่มีทั้งคู่ (งานที่สร้างเองในระบบ) ไม่ถูกนับ ไม่ใช่นับเป็นศูนย์ */
    freight_cost: trips.reduce((s, t) => s + (t.freight_actual_cost ?? t.freight_cost ?? 0), 0),
    weight_kg: delivered.reduce((s, o) => s + o.weight_kg, 0),
  }

  const byStatus = new Map<string, number>()
  for (const o of orders) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1)

  /* คนขับของเที่ยวอยู่ที่ trip_drivers แล้ว ไม่ใช่ trips.driver_id ที่เก็บได้คนเดียว
     เที่ยวที่ไปสองคนต้องนับให้ทั้งสองคน ไม่ใช่ให้คนแรกคนเดียว */
  const [customers, drivers, tripDrivers] = await Promise.all([
    unwrap(supabase.from('customers').select('*')),
    unwrap(supabase.from('drivers').select('*')),
    trips.length
      ? unwrap(
          supabase
            .from('trip_drivers')
            .select('trip_id, driver_id')
            .in('trip_id', trips.map((t) => t.id)),
        )
      : Promise.resolve([] as { trip_id: number; driver_id: number }[]),
  ])
  const customerName = new Map((customers as CustomerRow[]).map((c) => [c.id, c.name]))
  const driverName = new Map((drivers as DriverRow[]).map((d) => [d.id, d.name]))

  const byCustomer = new Map<number, { orders: number; revenue: number }>()
  for (const o of delivered) {
    if (o.customer_id === null) continue
    const cur = byCustomer.get(o.customer_id) ?? { orders: 0, revenue: 0 }
    byCustomer.set(o.customer_id, { orders: cur.orders + 1, revenue: cur.revenue + o.fee })
  }

  const byLane = new Map<string, { orders: number; revenue: number }>()
  for (const o of delivered) {
    const lane = `${o.origin} → ${o.destination}`
    const cur = byLane.get(lane) ?? { orders: 0, revenue: 0 }
    byLane.set(lane, { orders: cur.orders + 1, revenue: cur.revenue + o.fee })
  }

  const ordersPerTrip = new Map<number, number>()
  for (const o of orders) {
    if (o.trip_id === null) continue
    ordersPerTrip.set(o.trip_id, (ordersPerTrip.get(o.trip_id) ?? 0) + 1)
  }
  const driversOfTrip = new Map<number, number[]>()
  for (const r of tripDrivers as { trip_id: number; driver_id: number }[]) {
    const cur = driversOfTrip.get(r.trip_id)
    if (cur) cur.push(r.driver_id)
    else driversOfTrip.set(r.trip_id, [r.driver_id])
  }
  const byDriver = new Map<number, { trips: number; orders: number }>()
  for (const t of trips.filter((x) => x.status === 'completed')) {
    /* เที่ยวเก่าที่ยังไม่มีแถวใน trip_drivers ให้ถอยไปใช้คนขับหลักเหมือนเดิม */
    const ids = driversOfTrip.get(t.id) ?? (t.driver_id != null ? [t.driver_id] : [])
    for (const id of ids) {
      const cur = byDriver.get(id) ?? { trips: 0, orders: 0 }
      byDriver.set(id, {
        trips: cur.trips + 1,
        orders: cur.orders + (ordersPerTrip.get(t.id) ?? 0),
      })
    }
  }

  return {
    from: fromIso,
    to: toIso,
    kpis,
    by_status: [...byStatus].map(([status, count]) => ({ status, count })),
    top_customers: [...byCustomer]
      .map(([customer_id, v]) => ({ customer_id, name: customerName.get(customer_id) ?? '—', ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8),
    lanes: [...byLane]
      .map(([lane, v]) => ({ lane, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8),
    driver_performance: [...byDriver]
      .map(([driver_id, v]) => ({ driver_id, name: driverName.get(driver_id) ?? '—', ...v }))
      .sort((a, b) => b.trips - a.trips),
  }
}
