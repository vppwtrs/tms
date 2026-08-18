import { supabase, unwrap, toDataError } from './supabase.js'
import type { VehicleRow, VehicleStatus, VehicleType, DriverRow, DriverStatus } from '../types/database.js'
import type { Paged } from './customers.js'

/**
 * รถ + พนักงานขับ — แทน server/src/modules/vehicles + drivers
 *
 * สองเรื่องนี้อยู่ไฟล์เดียวกันเพราะหน้าจัดเที่ยวเรียกพร้อมกันเสมอ
 * (เลือกรถว่าง + คนขับว่าง ในฟอร์มเดียว) แยกไฟล์แล้วได้แค่ import เพิ่มบรรทัด
 *
 * **ห้ามเปลี่ยน status ของรถ/คนขับเองตอนจัดเที่ยว** — create_trip() ใน 0007 ทำให้แล้ว
 * ถ้าหน้าจอมาสั่ง setVehicleStatus('on_trip') ซ้ำ จะกลายเป็นสองแหล่งความจริง
 * ตัวที่นี่มีไว้สำหรับกรณีคนตั้งใจเปลี่ยนเอง เช่น ส่งรถเข้าซ่อม
 */

export interface VehicleFilter {
  q?: string
  status?: VehicleStatus
  type?: VehicleType
  page?: number
  limit?: number
}

export async function listVehicles(f: VehicleFilter = {}): Promise<Paged<VehicleRow>> {
  const page = f.page ?? 1
  const limit = f.limit ?? 20
  const from = (page - 1) * limit

  let q = supabase.from('vehicles').select('*', { count: 'exact' })
  if (f.q) q = q.or(`plate_no.ilike.%${f.q}%,brand.ilike.%${f.q}%,model.ilike.%${f.q}%`)
  if (f.status) q = q.eq('status', f.status)
  if (f.type) q = q.eq('vehicle_type', f.type)

  const { data, count, error } = await q.order('plate_no').order('id').range(from, from + limit - 1)
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0, page, limit }
}

export async function listAvailableVehicles(): Promise<VehicleRow[]> {
  return unwrap(supabase.from('vehicles').select('*').eq('status', 'available').order('plate_no'))
}

export type VehicleInput = Omit<VehicleRow, 'id' | 'created_at'>

export async function createVehicle(input: Partial<VehicleInput> & { plate_no: string }): Promise<VehicleRow> {
  return unwrap(supabase.from('vehicles').insert(input).select().single())
}

export async function updateVehicle(id: number, input: Partial<VehicleInput>): Promise<VehicleRow> {
  return unwrap(supabase.from('vehicles').update(input).eq('id', id).select().single())
}

export async function setVehicleStatus(id: number, status: VehicleStatus): Promise<VehicleRow> {
  return unwrap(supabase.from('vehicles').update({ status }).eq('id', id).select().single())
}

/** ลบรถ — ผ่าน RPC ด้วยเหตุผลเดียวกับ removeDriver: ได้เหตุผลเป็นภาษาคน
 *  และเก็บกวาดคีย์ใน tms_vehicle_map ให้ในคำสั่งเดียว */
export async function removeVehicle(id: number): Promise<void> {
  const { error } = await supabase.rpc('delete_vehicle', { p_id: id })
  /* ต้องผ่าน toDataError — error ของ postgrest เป็น object ธรรมดา ไม่ใช่ Error
     หน้าจอเช็ค `e instanceof Error` จึงตกไปใช้ข้อความสำรองว่า "ลบไม่สำเร็จ"
     แล้วเหตุผลจริง (มีประวัติเที่ยวกี่เที่ยว) หายไปทั้งที่ฝั่งฐานส่งมาให้แล้ว */
  if (error) throw toDataError(error)
}

/* ---------- พนักงานขับ ---------- */

export interface DriverFilter {
  q?: string
  status?: DriverStatus
  page?: number
  limit?: number
}

export async function listDrivers(f: DriverFilter = {}): Promise<Paged<DriverRow>> {
  const page = f.page ?? 1
  const limit = f.limit ?? 20
  const from = (page - 1) * limit

  let q = supabase.from('drivers').select('*', { count: 'exact' })
  if (f.q) q = q.or(`name.ilike.%${f.q}%,phone.ilike.%${f.q}%,license_no.ilike.%${f.q}%`)
  if (f.status) q = q.eq('status', f.status)

  /* ชื่อคนขับซ้ำกันได้จริง — TMS ส่งชื่อซ้ำมาจนเคยเกิดแถวคู่มาแล้ว
     ต้องมีตัวตัดสินที่ไม่ซ้ำ ไม่งั้นแบ่งหน้าแล้วแถวสลับกันเอง */
  const { data, count, error } = await q.order('name').order('id').range(from, from + limit - 1)
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0, page, limit }
}

export async function listAvailableDrivers(): Promise<DriverRow[]> {
  return unwrap(supabase.from('drivers').select('*').eq('status', 'available').order('name'))
}

export type DriverInput = Omit<DriverRow, 'id' | 'created_at'>

export async function createDriver(input: Partial<DriverInput> & { name: string }): Promise<DriverRow> {
  return unwrap(supabase.from('drivers').insert(input).select().single())
}

export async function updateDriver(id: number, input: Partial<DriverInput>): Promise<DriverRow> {
  return unwrap(supabase.from('drivers').update(input).eq('id', id).select().single())
}

export async function setDriverStatus(id: number, status: DriverStatus): Promise<DriverRow> {
  return unwrap(supabase.from('drivers').update({ status }).eq('id', id).select().single())
}

/** ลบพนักงานขับ — ผ่าน RPC เพื่อให้ได้เหตุผลเป็นภาษาคน
 *
 *  ลบตรงจากตารางแล้วชนคนที่มีประวัติเที่ยว จะได้ error ของ FK ดิบ ๆ ที่บอกแค่ชื่อ
 *  constraint ไม่ได้บอกว่าต้องไปเปลี่ยนสถานะเป็น "พักงาน" แทน
 *  ฝั่ง RPC ยังเก็บกวาดคีย์ใน tms_driver_map ให้ด้วย ไม่ให้เหลือคีย์ที่ไม่มีคนผูก */
export async function removeDriver(id: number): Promise<void> {
  const { error } = await supabase.rpc('delete_driver', { p_id: id })
  if (error) throw toDataError(error)
}
