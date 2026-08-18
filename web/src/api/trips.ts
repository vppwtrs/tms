import { supabase, unwrap, toDataError } from './supabase.js'
import type { TripRow, TripStatus, OrderRow, VehicleRow, DriverRow } from '../types/database.js'
import type { Paged } from './customers.js'

/**
 * เที่ยววิ่ง — แทน server/src/modules/trips
 *
 * ไฟล์นี้ต่างจาก orders/customers ตรงที่ **การกระทำเกือบทั้งหมดเป็น RPC**
 * ไม่ใช่เพราะเรื่องสิทธิ์ แต่เพราะทุกอย่างในนี้แตะหลายตารางพร้อมกัน:
 * สร้างเที่ยว = insert trips + update orders + update vehicles + update drivers
 * ถ้าปล่อยให้หน้าจอยิงสี่ request เรียงกัน แล้วเน็ตหลุดหลัง request ที่สอง
 * จะได้เที่ยวที่มีออเดอร์แต่รถยังว่าง — สถานะที่ไม่มีทางเกิดตอนอยู่บน Express
 * รายละเอียดอยู่ใน supabase/migrations/0007_office_api.sql
 *
 * ที่เหลือ (อ่านรายการ อัปเดตค่าน้ำมัน) ยิงตารางตรงได้ เพราะแตะตารางเดียว
 */

export interface TripFilter {
  status?: TripStatus
  page?: number
  limit?: number
}

export async function listTrips(f: TripFilter = {}): Promise<Paged<TripRow>> {
  const page = f.page ?? 1
  const limit = f.limit ?? 20
  const start = (page - 1) * limit

  let q = supabase.from('trips').select('*', { count: 'exact' })
  if (f.status) q = q.eq('status', f.status)

  const { data, count, error } = await q.order('id', { ascending: false }).range(start, start + limit - 1)
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0, page, limit }
}

export interface TripDetail {
  trip: TripRow
  vehicle: VehicleRow | null
  driver: DriverRow | null
  orders: OrderRow[]
  total_weight_kg: number
}

/* ดึงสี่ก้อนขนานกันแทน nested select — nested select ต้องมี Relationships จริงใน type
   ซึ่งไฟล์ database.ts เขียนมือไว้เป็น [] (ดูคอมเมนต์ในไฟล์นั้น) */
export async function getTripDetail(id: number): Promise<TripDetail> {
  /* ประกาศชนิดตรง ๆ — ปล่อยให้ infer จาก .single() แล้วเอาไปใช้ในนิพจน์ถัดไป
     postgrest-js จะยุบเหลือ never เหมือนกับดัก .maybeSingle() ที่เจอมาแล้ว */
  const trip: TripRow = await unwrap(supabase.from('trips').select('*').eq('id', id).single())
  const [vehicle, driver, orders] = await Promise.all([
    unwrap(supabase.from('vehicles').select('*').eq('id', trip.vehicle_id).single()),
    unwrap(supabase.from('drivers').select('*').eq('id', trip.driver_id).single()),
    unwrap(supabase.from('orders').select('*').eq('trip_id', id).order('scheduled_at')),
  ])
  const total = orders.reduce((s, o) => (o.status === 'cancelled' ? s : s + o.weight_kg), 0)
  return { trip, vehicle, driver, orders, total_weight_kg: total }
}

/** กระดานจัดรถ — เที่ยวที่ยังไม่จบ แยกเป็นสองคอลัมน์เหมือนหน้าเดิม */
export async function getTripBoard(): Promise<{ planned: TripRow[]; in_progress: TripRow[] }> {
  const rows = await unwrap(
    supabase.from('trips').select('*').in('status', ['planned', 'in_progress']).order('id', { ascending: false }),
  )
  return {
    planned: rows.filter((t) => t.status === 'planned'),
    in_progress: rows.filter((t) => t.status === 'in_progress'),
  }
}

/** เที่ยวหนึ่งใบพร้อมของที่การ์ดบนหน้าจัดเที่ยวต้องใช้ — ของเดิมบน Express JOIN มาให้แล้ว */
export interface BoardTrip {
  id: number
  trip_no: string
  status: TripStatus
  departed_at: string | null
  vehicle_plate: string
  vehicle_type: string
  vehicle_capacity: number
  driver_name: string
  total_weight: number
  /* ค่าจ้างขนส่งจาก TMS — ยอดปิดจริงถ้ามี ไม่งั้นยอดตามสัญญา
     null = เที่ยวที่สร้างเองในระบบ ยังไม่มีตัวเลขจากฝั่ง TMS */
  freight_cost: number | null
  orders: OrderRow[]
}

/* ยิงสี่คิวรีแล้วประกอบเองแทน nested select — เหตุผลเดียวกับ getTripDetail()
   คือ database.ts เขียน Relationships ไว้เป็น [] postgrest-js จึง infer ก้อนซ้อนไม่ได้
   สี่คิวรีต่อการโหลดกระดานหนึ่งครั้งไม่ใช่ต้นทุนที่รู้สึกได้ เที่ยวที่ยังไม่จบมีไม่กี่สิบใบ */
export async function getTripBoardDetailed(): Promise<{ planned: BoardTrip[]; in_progress: BoardTrip[] }> {
  const trips: TripRow[] = await unwrap(
    supabase.from('trips').select('*').in('status', ['planned', 'in_progress']).order('id', { ascending: false }),
  )
  if (trips.length === 0) return { planned: [], in_progress: [] }

  const [vehicles, drivers, orders] = await Promise.all([
    unwrap(supabase.from('vehicles').select('*').in('id', [...new Set(trips.map((t) => t.vehicle_id))])),
    unwrap(supabase.from('drivers').select('*').in('id', [...new Set(trips.map((t) => t.driver_id))])),
    unwrap(supabase.from('orders').select('*').in('trip_id', trips.map((t) => t.id)).order('scheduled_at')),
  ])

  const vById = new Map(vehicles.map((v) => [v.id, v]))
  const dById = new Map(drivers.map((d) => [d.id, d]))

  const cards: BoardTrip[] = trips.map((t) => {
    const mine = orders.filter((o) => o.trip_id === t.id)
    const v = vById.get(t.vehicle_id)
    return {
      id: t.id,
      trip_no: t.trip_no,
      status: t.status,
      departed_at: t.departed_at,
      vehicle_plate: v?.plate_no ?? '—',
      vehicle_type: v?.vehicle_type ?? '',
      vehicle_capacity: v?.capacity_kg ?? 0,
      driver_name: dById.get(t.driver_id)?.name ?? '—',
      /* ใบที่ยกเลิกไม่นับน้ำหนัก ไม่งั้นแถบความจุจะโชว์เต็มทั้งที่ของไม่ได้อยู่บนรถ */
      total_weight: mine.reduce((s, o) => (o.status === 'cancelled' ? s : s + o.weight_kg), 0),
      freight_cost: t.freight_actual_cost ?? t.freight_cost,
      orders: mine,
    }
  })

  return {
    planned: cards.filter((t) => t.status === 'planned'),
    in_progress: cards.filter((t) => t.status === 'in_progress'),
  }
}

/* ---------- การกระทำ (RPC ทั้งหมด) ---------- */

export interface CreateTripResult {
  trip_id: number
  trip_no: string
  /** น้ำหนักเกินความจุ — เตือน ไม่ใช่ห้าม คนจัดรถรู้หน้างานดีกว่าตัวเลขที่กรอกไว้ */
  warning: string | null
}

export async function createTrip(input: {
  vehicleId: number
  driverId: number
  orderIds: number[]
  notes?: string | null
}): Promise<CreateTripResult> {
  const { data, error } = await supabase.rpc('create_trip', {
    p_vehicle_id: input.vehicleId,
    p_driver_id: input.driverId,
    p_order_ids: input.orderIds,
    p_notes: input.notes ?? null,
  })
  if (error) throw toDataError(error)
  return data as CreateTripResult
}

export async function addOrdersToTrip(tripId: number, orderIds: number[]): Promise<{ warning: string | null }> {
  const { data, error } = await supabase.rpc('add_orders_to_trip', {
    p_trip_id: tripId,
    p_order_ids: orderIds,
  })
  if (error) throw toDataError(error)
  return data as { warning: string | null }
}

async function call(
  fn: 'remove_order_from_trip' | 'dispatch_start_trip' | 'dispatch_complete_trip' | 'dispatch_cancel_trip',
  args: Record<string, number>,
): Promise<void> {
  const { error } = await supabase.rpc(fn, args as never)
  if (error) throw toDataError(error)
}

export const removeOrderFromTrip = (tripId: number, orderId: number) =>
  call('remove_order_from_trip', { p_trip_id: tripId, p_order_id: orderId })

export const startTrip = (tripId: number) => call('dispatch_start_trip', { p_trip_id: tripId })

/** ปิดเที่ยวจากฝั่งออฟฟิศ — ไม่บังคับว่าต้องส่งครบก่อน ต่างจากปุ่มของคนขับ
 *  มีไว้สำหรับตอนที่หน้างานปิดเองไม่ได้ (เน็ตหลุด แบตหมด) ไม่ใช่ทางลัดปกติ */
export const completeTrip = (tripId: number) => call('dispatch_complete_trip', { p_trip_id: tripId })

/** ยกเลิกเที่ยว — ออเดอร์กลับไปรอจัดใหม่ ไม่ได้ถูกยกเลิกตาม */
export const cancelTrip = (tripId: number) => call('dispatch_cancel_trip', { p_trip_id: tripId })

/** ค่าน้ำมัน/ทางด่วน/อื่น ๆ — แตะตาราง trips ตารางเดียว ยิงตรงได้
 *  คนขับมองไม่เห็นตัวเลขพวกนี้เพราะอ่านผ่าน view my_trips ที่ไม่มีคอลัมน์ต้นทุน */
export async function updateTripCosts(
  id: number,
  costs: { fuel_cost?: number; toll_cost?: number; other_cost?: number; notes?: string | null },
): Promise<TripRow> {
  return unwrap(supabase.from('trips').update(costs).eq('id', id).select().single())
}
