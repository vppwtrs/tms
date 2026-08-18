import { supabase, unwrap, toDataError } from './supabase.js'
import type { OrderRow, OrderStatus, OrderPriority } from '../types/database.js'
import type { Paged } from './customers.js'

/**
 * ออเดอร์ — แทน server/src/modules/orders
 *
 * order_no ไม่ต้องส่งมา trigger ใน 0007 เติมให้เป็น ORD-2026-0001 ต่อจากใบล่าสุดของปี (ปี ค.ศ. ตามของเดิม)
 * ส่งมาเองก็ได้ถ้าจะยัดข้อมูลเก่า แต่ปกติปล่อยว่าง
 *
 * **ยกเลิกออเดอร์ = เปลี่ยน status ไม่ใช่ลบแถว** เหมือนของเดิม
 * 0003 ไม่มี policy delete บนตารางนี้เลย ยิง delete ไปก็ได้ 0 แถว ไม่ error ด้วยซ้ำ
 * ประวัติงานที่ยกเลิกคือข้อมูลที่ต้องใช้ตอบลูกค้าทีหลัง ไม่ใช่ขยะ
 */

export interface OrderFilter {
  q?: string
  status?: OrderStatus
  priority?: OrderPriority
  customerId?: number
  /** กรองตามคนขับที่รับผิดชอบ — ผ่านเที่ยวที่ออเดอร์ถูกจัดเข้าไป ออเดอร์ไม่ได้ผูกคนขับตรง ๆ */
  driverId?: number
  from?: string
  to?: string
  page?: number
  limit?: number
}

/** แถวออเดอร์พร้อมชื่อที่มาจากตารางอื่น — ของเดิมบน Express JOIN มาให้ในคิวรีเดียว
 *  ที่นี่ใช้ embedded resource ของ PostgREST ซึ่งได้ผลเท่ากันแต่คืนเป็นก้อนซ้อน
 *  จึงต้องแบนก่อนส่งออก หน้าจอจะได้ไม่ต้องรู้ว่าข้อมูลมาจากกี่ตาราง */
export interface OrderItem {
  item_no: string
  item_name: string | null
  qty: number
}

export interface OrderListRow extends OrderRow {
  customer_name: string | null
  driver_name: string | null
  trip_no: string | null
  pod_status: string | null
  /* รายการของในใบ — เดิมมีแต่ goods_desc ซึ่งเป็นชื่อสินค้าต่อกันเป็นข้อความ
     ค้นตามรหัสไม่ได้ และไม่รู้ว่าอย่างละกี่ชิ้น */
  items: OrderItem[]
}

interface OrderJoined extends OrderRow {
  customers: { name: string } | null
  trips: { trip_no: string; drivers: { name: string } | null } | null
  pod: { status: string }[] | null
  order_items: OrderItem[] | null
}

const flatten = (r: OrderJoined): OrderListRow => ({
  ...r,
  customer_name: r.customers?.name ?? null,
  driver_name: r.trips?.drivers?.name ?? null,
  trip_no: r.trips?.trip_no ?? null,
  pod_status: r.pod?.[0]?.status ?? null,
  items: r.order_items ?? [],
})

export async function listOrders(f: OrderFilter = {}): Promise<Paged<OrderListRow>> {
  const page = f.page ?? 1
  const limit = f.limit ?? 20
  const start = (page - 1) * limit

  /* !inner เฉพาะตอนกรองตามคนขับ — ถ้าใส่ไว้ตลอด ออเดอร์ที่ยังไม่ได้จัดเที่ยว
     จะหายไปจากตารางทั้งหมด ซึ่งคือใบที่ฝ่ายวางแผนต้องเห็นมากที่สุด */
  const tripJoin = f.driverId ? 'trips!inner' : 'trips'
  /* ต้องระบุชื่อ FK ให้ชัด — ตอนนี้ trips ชี้ไป drivers ได้สามทาง (driver_id, accepted_by
     และผ่านตาราง trip_drivers) PostgREST เลยเลือกไม่ถูกแล้วตอบ PGRST201 ทั้งคำขอ
     ซึ่งบนหน้าเว็บคือ "โหลดออเดอร์ไม่สำเร็จ" ทั้งหน้า */
  const driverJoin = 'drivers!trips_driver_id_fkey(name)'
  let q = supabase
    .from('orders')
    .select(`*, customers(name), ${tripJoin}(trip_no, driver_id, ${driverJoin}), pod(status), order_items(item_no, item_name, qty)`, { count: 'exact' })
  if (f.driverId) q = q.eq('trips.driver_id', f.driverId)
  if (f.q) q = q.or(`order_no.ilike.%${f.q}%,origin.ilike.%${f.q}%,destination.ilike.%${f.q}%,goods_desc.ilike.%${f.q}%`)
  if (f.status) q = q.eq('status', f.status)
  if (f.priority) q = q.eq('priority', f.priority)
  if (f.customerId) q = q.eq('customer_id', f.customerId)
  if (f.from) q = q.gte('scheduled_at', f.from)
  if (f.to) q = q.lte('scheduled_at', f.to)

  const { data, count, error } = await q
    /* ใบในเที่ยวเดียวกันมีกำหนดส่งวันเดียวกันทั้งก้อน เรียงด้วยวันอย่างเดียว
       ลำดับภายในวันจึงสลับไปมาทุกครั้งที่โหลด อ่านแล้วเหมือนข้อมูลมั่ว */
    .order('scheduled_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, start + limit - 1)
  if (error) throw error
  return { rows: ((data ?? []) as unknown as OrderJoined[]).map(flatten), total: count ?? 0, page, limit }
}

export async function getOrder(id: number): Promise<OrderRow> {
  return unwrap(supabase.from('orders').select('*').eq('id', id).single())
}

/** ออเดอร์ที่รอจัดเที่ยว — ฟีดให้หน้า Dispatch เลือกใส่เที่ยว
 *  เงื่อนไขต้องตรงกับที่ create_trip() ยอมรับ (pending + ยังไม่มี trip_id)
 *  ไม่งั้นหน้าจอโชว์ใบที่กดแล้วฟังก์ชันปฏิเสธ */
export interface DispatchOrderRow extends OrderRow {
  tms_pl_no?: string | null
  tms_kind?: 'vehicle' | 'box' | null
  tms_units?: number | null
}

export async function listUnassignedOrders(q?: string): Promise<DispatchOrderRow[]> {
  let query = supabase.from('orders').select('*, tms_shipments(picking_list_no, pl_type, item_qty, unit)').eq('status', 'pending').is('trip_id', null)
  if (q) query = query.or(`order_no.ilike.%${q}%,destination.ilike.%${q}%`)
  const rows = await unwrap(query.order('scheduled_at')) as unknown as (OrderRow & {
    tms_shipments?: { picking_list_no?: string | null; pl_type?: string | null; item_qty?: number | null; unit?: number | null }[]
  })[]
  return rows.map((o) => {
    const t = o.tms_shipments?.[0]
    return {
      ...o,
      tms_pl_no: o.tms_picking_list_no ?? t?.picking_list_no ?? null,
      tms_kind: o.work_kind ?? (/^box\b/i.test(o.goods_desc.trim()) ? 'box' : 'vehicle'),
      tms_units: o.tms_unit_count ?? t?.unit ?? t?.item_qty ?? null,
    }
  })
}

export async function listOrdersByTrip(tripId: number): Promise<OrderRow[]> {
  return unwrap(supabase.from('orders').select('*').eq('trip_id', tripId).order('scheduled_at'))
}

export type OrderInput = Omit<OrderRow, 'id' | 'order_no' | 'created_at' | 'updated_at' | 'status' | 'trip_id' | 'delivered_at'>

export async function createOrder(input: Partial<OrderInput> & {
  origin: string
  destination: string
  goods_desc: string
  scheduled_at: string
}): Promise<OrderRow> {
  return unwrap(supabase.from('orders').insert(input).select().single())
}

export async function updateOrder(id: number, input: Partial<OrderInput>): Promise<OrderRow> {
  return unwrap(
    supabase.from('orders').update({ ...input, updated_at: new Date().toISOString() }).eq('id', id).select().single(),
  )
}

/**
 * ลบใบทิ้ง แล้วคืนใบดิบจาก TMS ให้สั่งงานใหม่ได้
 *
 * ของเดิมแค่ตั้งสถานะเป็น "ยกเลิก" ค้างไว้ ใบดิบยังถูกจองว่าแปลงเป็นออเดอร์ไปแล้ว
 * สั่งใหม่จึงไม่มีใบตามมา และหน้าออเดอร์รกด้วยใบยกเลิกที่ไม่มีใครใช้ต่อ
 * สาเหตุของการยกเลิกส่วนใหญ่คือกดพลาด ทางออกที่ถูกคือถอยกลับไปเป็นเหมือนไม่เคยกด
 *
 * ใบที่เก็บหลักฐานการส่งมอบไปแล้วลบไม่ได้ — ฝั่งฐานเป็นคนกัน ไม่ใช่หน้าจอ
 */
export async function removeOrder(id: number): Promise<{ deleted: number; order_no: string }> {
  const { data, error } = await supabase.rpc('remove_order', { p_order_id: id })
  if (error) throw toDataError(error)
  return data as { deleted: number; order_no: string }
}
