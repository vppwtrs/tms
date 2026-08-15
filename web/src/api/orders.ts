import { supabase, unwrap } from './supabase.js'
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
  from?: string
  to?: string
  page?: number
  limit?: number
}

export async function listOrders(f: OrderFilter = {}): Promise<Paged<OrderRow>> {
  const page = f.page ?? 1
  const limit = f.limit ?? 20
  const start = (page - 1) * limit

  let q = supabase.from('orders').select('*', { count: 'exact' })
  if (f.q) q = q.or(`order_no.ilike.%${f.q}%,origin.ilike.%${f.q}%,destination.ilike.%${f.q}%,goods_desc.ilike.%${f.q}%`)
  if (f.status) q = q.eq('status', f.status)
  if (f.priority) q = q.eq('priority', f.priority)
  if (f.customerId) q = q.eq('customer_id', f.customerId)
  if (f.from) q = q.gte('scheduled_at', f.from)
  if (f.to) q = q.lte('scheduled_at', f.to)

  const { data, count, error } = await q
    .order('scheduled_at', { ascending: false })
    .range(start, start + limit - 1)
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0, page, limit }
}

export async function getOrder(id: number): Promise<OrderRow> {
  return unwrap(supabase.from('orders').select('*').eq('id', id).single())
}

/** ออเดอร์ที่รอจัดเที่ยว — ฟีดให้หน้า Dispatch เลือกใส่เที่ยว
 *  เงื่อนไขต้องตรงกับที่ create_trip() ยอมรับ (pending + ยังไม่มี trip_id)
 *  ไม่งั้นหน้าจอโชว์ใบที่กดแล้วฟังก์ชันปฏิเสธ */
export async function listUnassignedOrders(q?: string): Promise<OrderRow[]> {
  let query = supabase.from('orders').select('*').eq('status', 'pending').is('trip_id', null)
  if (q) query = query.or(`order_no.ilike.%${q}%,destination.ilike.%${q}%`)
  return unwrap(query.order('scheduled_at'))
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

/** ยกเลิกใบที่ยังไม่ได้จัดเข้าเที่ยวเท่านั้น — ใบที่อยู่ในเที่ยวแล้วต้องเอาออกจากเที่ยวก่อน
 *  เงื่อนไขอยู่ใน .eq() ไม่ใช่ if ในหน้าจอ ยิงตรงมาก็ได้ 0 แถวเหมือนกัน */
export async function cancelOrder(id: number): Promise<OrderRow> {
  return unwrap(
    supabase
      .from('orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .is('trip_id', null)
      .select()
      .single(),
  )
}
