import { supabase, unwrap, toDataError } from './supabase.js'
import type { MyOrderRow, MyTripRow } from '../types/database.js'

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
