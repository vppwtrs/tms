import { supabase, unwrap, toDataError } from './supabase.js'
import type { MyOrderRow, MyTripRow } from '../types/database.js'
import type { MyJob, MyJobOrder } from '../types.js'

/**
 * ฝั่งคนขับ — แทน server/src/modules/myjobs + pod (เฉพาะส่วนที่คนขับใช้)
 *
 * ทุกฟังก์ชันในไฟล์นี้ยิงไปที่ view หรือ RPC เท่านั้น **ไม่แตะตาราง orders/trips ตรง ๆ**
 * เพราะสองตารางนั้นมีคอลัมน์เงิน (fee, fuel_cost, toll_cost, other_cost)
 * และคนขับไม่มี policy ให้ select อยู่แล้ว ยิงตรงไปก็ได้ศูนย์แถว
 *
 * กฎเดิมของโปรเจ็ค "ห้ามให้ตัวเลขเงินโผล่ในหน้าคนขับ" ยังอยู่ครบ
 * เปลี่ยนแค่วิธีบังคับ: เดิมคือ repository ไม่ SELECT มาให้ ตอนนี้คือ view ไม่มีคอลัมน์นั้น
 */

export async function listMyTrips(): Promise<MyTripRow[]> {
  return unwrap(
    supabase.from('my_trips').select('*').order('departed_at', { ascending: false, nullsFirst: true }),
  )
}

export async function listMyOrders(tripIds: number[]): Promise<MyOrderRow[]> {
  if (tripIds.length === 0) return []
  return unwrap(
    supabase.from('my_orders').select('*').in('trip_id', tripIds).order('scheduled_at'),
  )
}

async function rpc(fn: 'start_trip' | 'complete_trip', args: { p_trip_id: number }): Promise<void> {
  const { error } = await supabase.rpc(fn, args)
  if (error) throw toDataError(error)
}

export const startTrip = (tripId: number) => rpc('start_trip', { p_trip_id: tripId })

/** ปิดเที่ยว — ฝั่ง DB จะปฏิเสธถ้ายังส่งไม่ครบ ไม่ต้องเช็คซ้ำตรงนี้
 *  (เช็คในหน้าจอไว้เพื่อ disable ปุ่มได้ แต่นั่นเป็นเรื่อง UX ไม่ใช่การป้องกัน) */
export const completeTrip = (tripId: number) => rpc('complete_trip', { p_trip_id: tripId })

/** ปิดการส่งทีละจุด แล้วเด้งเข้าฟอร์ม POD ต่อ — ตรงกับ POST /api/my-jobs/orders/:id/deliver เดิม */
export async function deliverOrder(orderId: number): Promise<void> {
  const { error } = await supabase.rpc('deliver_order', { p_order_id: orderId })
  if (error) throw toDataError(error)
}

/* ---------- ประกอบเป็นรูปที่หน้าจอเดิมใช้อยู่ ----------
 *
 * ระบบเดิมส่ง "เที่ยวพร้อมออเดอร์ข้างใน" มาเป็นก้อนเดียว (MyJob) ส่วน Supabase
 * ให้มาเป็นสอง view แยกกัน — ประกอบที่นี่ครั้งเดียว แทนที่จะไปแก้ MyJobs.tsx
 * กับ JobFocus.tsx ให้รับรูปแบบใหม่
 *
 * ตั้งใจเลือกทางนี้เพราะหน้าคนขับคือหน้าที่ผ่านการปรับจนลงตัวกับการใช้งานจริงในรถแล้ว
 * (ปุ่มตรึงล่างจอ ขนาดนิ้วโป้ง หนึ่งงานเต็มจอ) การไปรื้อมันเพื่อเปลี่ยนแหล่งข้อมูล
 * คือเอาของที่ใช้ได้ดีอยู่แล้วไปเสี่ยง โดยผู้ใช้ไม่ได้อะไรเพิ่มเลย
 */

export async function listMyJobs(includeDone = false): Promise<MyJob[]> {
  const trips = await listMyTrips()
  /* ปกติเอาเฉพาะงานที่ยังไม่จบ — คนขับเปิดมาเพื่อดูว่า "ตอนนี้ต้องทำอะไร"
     ไม่ใช่เพื่อทบทวนงานเมื่อวาน ประวัติอยู่หลังปุ่มอีกที */
  const visible = includeDone ? trips : trips.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
  if (visible.length === 0) return []

  const orders = await listMyOrders(visible.map((t) => t.id))
  const byTrip = new Map<number, MyJobOrder[]>()
  for (const o of orders) {
    if (o.trip_id == null) continue
    const list = byTrip.get(o.trip_id) ?? []
    list.push({
      id: o.id,
      order_no: o.order_no,
      trip_id: o.trip_id,
      status: o.status,
      priority: o.priority,
      origin: o.origin,
      destination: o.destination,
      distance_km: o.distance_km,
      goods_desc: o.goods_desc,
      weight_kg: o.weight_kg,
      scheduled_at: o.scheduled_at,
      delivered_at: o.delivered_at,
      notes: o.notes,
      customer_name: o.customer_name,
      customer_phone: o.customer_phone,
      customer_address: o.customer_address,
      /* ระบบเดิมส่ง has_pod มาเป็น 0/1 ไม่ใช่ boolean — คงรูปเดิมไว้
         เพื่อไม่ต้องแก้ทุกที่ในหน้าจอที่เช็คค่านี้ */
      has_pod: o.has_pod ? 1 : 0,
    })
    byTrip.set(o.trip_id, list)
  }

  return visible.map((t) => {
    const list = byTrip.get(t.id) ?? []
    return {
      id: t.id,
      trip_no: t.trip_no,
      status: t.status,
      departed_at: t.departed_at,
      arrived_at: t.arrived_at,
      notes: t.notes,
      vehicle_plate: t.plate_no,
      vehicle_type: t.vehicle_type,
      orders: list,
      total_weight: list.reduce((s, o) => s + (o.weight_kg || 0), 0),
    }
  })
}

/** โหลดเที่ยวเดียวใหม่หลังกดปุ่ม — หน้าจอเดิมคาดว่าจะได้ MyJob ที่อัปเดตแล้วกลับมา
 *  คืน null ถ้าเที่ยวนั้นหลุดจากรายการไปแล้ว (เช่น เพิ่งปิดงานตอนดูเฉพาะงานค้าง) */
export async function reloadJob(tripId: number, includeDone: boolean): Promise<MyJob | null> {
  const jobs = await listMyJobs(includeDone)
  return jobs.find((j) => j.id === tripId) ?? null
}

export interface PodInput {
  orderId: number
  recipientName: string
  signatureData: string
  photoPath?: string | null
  notes?: string | null
  lat?: number | null
  lng?: number | null
}

export async function savePod(input: PodInput): Promise<number> {
  const { data, error } = await supabase.rpc('save_pod', {
    p_order_id: input.orderId,
    p_recipient_name: input.recipientName,
    p_signature_data: input.signatureData,
    p_photo_path: input.photoPath ?? null,
    p_notes: input.notes ?? null,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
  })
  if (error) throw toDataError(error)
  return data as number
}
