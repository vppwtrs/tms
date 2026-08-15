import { supabase, unwrap } from './supabase.js'
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

  const { data, count, error } = await q.order('plate_no').range(from, from + limit - 1)
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

export async function removeVehicle(id: number): Promise<void> {
  const { error } = await supabase.from('vehicles').delete().eq('id', id)
  if (error) throw error
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

  const { data, count, error } = await q.order('name').range(from, from + limit - 1)
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

export async function removeDriver(id: number): Promise<void> {
  const { error } = await supabase.from('drivers').delete().eq('id', id)
  if (error) throw error
}
