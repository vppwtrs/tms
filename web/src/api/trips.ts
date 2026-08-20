import { supabase, unwrap, toDataError } from './supabase.js'
import { removePodPhotos } from './storage.js'
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
    supabase.from('trips').select('*').in('status', ['planned', 'in_progress', 'returning']).order('id', { ascending: false }),
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
  /* เลขเที่ยวของ TMS — เลขเดียวกับที่คลังและคนขับใช้เรียกงานนี้
     null = เที่ยวที่สร้างเองในระบบ ซึ่งมีแต่ trip_no ของเรา */
  tms_trip_no: string | null
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
  /* null บนเที่ยวที่ยังไม่จบ = ยังไม่ถึงมือคนขับ คือประตูที่กันงานไม่ให้วิ่งเอง */
  accepted_at: string | null
  /* เที่ยวที่ไปหลายคน: รับแล้วกี่คนจากกี่คน — accepted_at บอกแค่ว่ามีคนแรกรับแล้ว */
  crew_size: number
  crew_accepted: number
  /* ปัญหาที่คนขับแจ้ง — ไม่ใช่การปฏิเสธงาน */
  issue_note: string | null
  issue_at: string | null
  /* คนขับที่ยังไม่มีบัญชีผู้ใช้ เปิดแอปดูงานไม่ได้ ต่อให้จ่ายงานสำเร็จ */
  driver_has_account: boolean
  orders: OrderRow[]
}

/* ยิงสี่คิวรีแล้วประกอบเองแทน nested select — เหตุผลเดียวกับ getTripDetail()
   คือ database.ts เขียน Relationships ไว้เป็น [] postgrest-js จึง infer ก้อนซ้อนไม่ได้
   สี่คิวรีต่อการโหลดกระดานหนึ่งครั้งไม่ใช่ต้นทุนที่รู้สึกได้ เที่ยวที่ยังไม่จบมีไม่กี่สิบใบ */
/** กระดานงาน — แบ่งตาม "งานเดินไปถึงไหน" ไม่ใช่ตามสถานะดิบของตาราง
 *
 *  waiting = เที่ยวที่คนขับยังไม่กดรับ คือช่องที่คนวางแผนต้องดูก่อนเพื่อน
 *  เพราะงานถูกจ่ายไปแล้วแต่ยังไม่มีใครยืนยันว่าเห็น
 *  done = เฉพาะที่จบวันนี้ ไม่ใช่ทั้งหมด กระดานคือของวันนี้ ไม่ใช่คลังประวัติ */
export async function getTripBoardDetailed(): Promise<{
  waiting: BoardTrip[]
  running: BoardTrip[]
  done: BoardTrip[]
}> {
  const today = new Date()
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset())
  const from = `${today.toISOString().slice(0, 10)}T00:00:00`

  const trips: TripRow[] = await unwrap(
    supabase.from('trips').select('*')
      .or(`status.in.(planned,in_progress,returning),and(status.eq.completed,arrived_at.gte.${from})`)
      .order('id', { ascending: false }),
  )
  if (trips.length === 0) return { waiting: [], running: [], done: [] }

  /* เที่ยวที่ไปสองคนเก็บคนที่สองไว้ที่ trip_drivers — trips.driver_id เป็นแค่คนขับหลัก
     กระดานต้องขึ้นชื่อครบ ไม่งั้นคนที่ไปด้วยหายไปจากหน้าจอทั้งที่สถานะถูกจองไว้แล้ว */
  const [vehicles, tripDrivers, orders] = await Promise.all([
    unwrap(supabase.from('vehicles').select('*').in('id', [...new Set(trips.map((t) => t.vehicle_id))])),
    unwrap(
      supabase
        .from('trip_drivers')
        .select('trip_id, driver_id, accepted_at')
        .in('trip_id', trips.map((t) => t.id))
        .order('seq'),
    ),
    unwrap(supabase.from('orders').select('*').in('trip_id', trips.map((t) => t.id)).order('scheduled_at')),
  ])

  const links = tripDrivers as { trip_id: number; driver_id: number; accepted_at: string | null }[]
  const driverIds = [...new Set([...trips.map((t) => t.driver_id), ...links.map((r) => r.driver_id)])]
    .filter((id): id is number => id != null)
  const drivers = driverIds.length
    ? await unwrap(supabase.from('drivers').select('*').in('id', driverIds))
    : []

  const vById = new Map(vehicles.map((v) => [v.id, v]))
  const dById = new Map(drivers.map((d) => [d.id, d]))
  const crewOf = new Map<number, number[]>()
  for (const r of links) {
    const cur = crewOf.get(r.trip_id)
    if (cur) cur.push(r.driver_id)
    else crewOf.set(r.trip_id, [r.driver_id])
  }

  const cards: BoardTrip[] = trips.map((t) => {
    const mine = orders.filter((o) => o.trip_id === t.id)
    const v = vById.get(t.vehicle_id)
    /* เที่ยวเก่าที่ยังไม่มีแถวใน trip_drivers ถอยไปใช้คนขับหลักคนเดียวเหมือนเดิม */
    const crew = crewOf.get(t.id) ?? (t.driver_id != null ? [t.driver_id] : [])
    const crewNames = crew.map((id) => dById.get(id)?.name).filter(Boolean) as string[]
    return {
      id: t.id,
      trip_no: t.trip_no,
      /* ตาราง trips ไม่ได้เก็บเลขของ TMS ไว้ ใบในเที่ยวเก็บไว้ทุกใบ เอาใบแรกที่มีก็พอ
         ทุกใบในเที่ยวเดียวกันมาจากเที่ยวเดียวกันของ TMS อยู่แล้ว */
      tms_trip_no: mine.find((o) => o.tms_trip_no)?.tms_trip_no ?? null,
      status: t.status,
      departed_at: t.departed_at,
      vehicle_plate: v?.plate_no ?? '—',
      vehicle_type: v?.vehicle_type ?? '',
      vehicle_capacity: v?.capacity_kg ?? 0,
      driver_name: crewNames.length ? crewNames.join(', ') : '—',
      /* ใบที่ยกเลิกไม่นับน้ำหนัก ไม่งั้นแถบความจุจะโชว์เต็มทั้งที่ของไม่ได้อยู่บนรถ */
      total_weight: mine.reduce((s, o) => (o.status === 'cancelled' ? s : s + o.weight_kg), 0),
      freight_cost: t.freight_actual_cost ?? t.freight_cost,
      accepted_at: t.accepted_at,
      /* "รับแล้ว 2/3" — คำถามแรกของคนวางแผนตอนเช้าคือคนครบหรือยัง ไม่ใช่รถออกหรือยัง
         เที่ยวคนเดียวก็ยังตอบได้ตามปกติ (1/1) หน้าจอเป็นคนตัดสินว่าจะโชว์ไหม */
      crew_size: crew.length,
      crew_accepted: links.filter((r) => r.trip_id === t.id && r.accepted_at != null).length,
      issue_note: t.issue_note,
      issue_at: t.issue_at,
      driver_has_account: dById.get(t.driver_id)?.user_id != null,
      orders: mine,
    }
  })

  return {
    /* ยังไม่กดรับ = ยังไม่ถึงมือคนขับ ไม่ว่าสถานะจะเป็น planned หรือ in_progress
       (เที่ยวที่ TMS ดันไปก่อนมีประตู ยังค้างเป็น in_progress ที่ไม่มีใครรับ) */
    waiting: cards.filter((t) => t.status !== 'completed' && !t.accepted_at),
    running: cards.filter((t) => t.status !== 'completed' && t.accepted_at),
    done: cards.filter((t) => t.status === 'completed'),
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
  fn: 'remove_order_from_trip' | 'dispatch_start_trip' | 'dispatch_complete_trip'
    | 'dispatch_cancel_trip' | 'clear_trip_issue' | 'accept_trip',
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

/** คนขับกดรับงาน — ประตูที่กันไม่ให้งานวิ่งข้ามหัวคนขับ
 *  สถานะจาก TMS ที่ค้างอยู่จะมีผลก็ต่อเมื่อผ่านประตูนี้แล้ว */
export const acceptTrip = (tripId: number) => call('accept_trip', { p_trip_id: tripId })

/** คนวางแผนเคลียร์ปัญหาที่คนขับแจ้งไว้ หลังคุยกันจบแล้ว */
export const clearTripIssue = (tripId: number) => call('clear_trip_issue', { p_trip_id: tripId })

/** ยกเลิกเที่ยว — ออเดอร์กลับไปรอจัดใหม่ ไม่ได้ถูกยกเลิกตาม */
export const cancelTrip = (tripId: number) => call('dispatch_cancel_trip', { p_trip_id: tripId })

/** ลบเที่ยวถาวร — สำหรับเก็บกวาดข้อมูลทดสอบเท่านั้น ฐานจำกัดไว้ที่ผู้ดูแลระบบ
 *  ต่างจาก cancelTrip ตรงที่ลบได้แม้มี POD แล้ว ซึ่งเป็นเหตุผลที่มันไม่ใช่ปุ่มของคนทั่วไป */
export async function forceDeleteTrip(tripId: number): Promise<{ trip_no: string; deleted_orders: number; deleted_pods: number; deleted_photos: number }> {
  const { data, error } = await supabase.rpc('admin_force_delete_trip', { p_trip_id: tripId })
  if (error) throw toDataError(error)
  const res = data as unknown as { trip_no: string; deleted_orders: number; deleted_pods: number; orphan_photo_paths: string[] }
  /* ไฟล์ในถังไม่หายตามแถวที่ถูกลบ และไม่มีอะไรในระบบเคยเก็บกวาดมันเลย
     ลบหลังฐานจบแล้ว ไม่ใช่ก่อน — ลบไฟล์สำเร็จแต่ลบแถวไม่ผ่าน จะเหลือหลักฐาน
     ที่อ้างถึงรูปซึ่งไม่มีอยู่ ซึ่งแย่กว่าไฟล์กำพร้าที่ไม่มีใครเห็น */
  const deleted_photos = await removePodPhotos(res.orphan_photo_paths ?? [])
  return { ...res, deleted_photos }
}

/** ค่าน้ำมัน/ทางด่วน/อื่น ๆ — แตะตาราง trips ตารางเดียว ยิงตรงได้
 *  คนขับมองไม่เห็นตัวเลขพวกนี้เพราะอ่านผ่าน view my_trips ที่ไม่มีคอลัมน์ต้นทุน */
export async function updateTripCosts(
  id: number,
  costs: { fuel_cost?: number; toll_cost?: number; other_cost?: number; notes?: string | null },
): Promise<TripRow> {
  return unwrap(supabase.from('trips').update(costs).eq('id', id).select().single())
}
