import { supabase, unwrap } from './supabase.js'
import type { CustomerRow, CustomerInteractionRow, CustomerTaskRow, InteractionType } from '../types/database.js'

/**
 * ลูกค้า + CRM — แทน server/src/modules/customers
 *
 * ตารางพวกนี้เป็น CRUD ล้วน ไม่มีอะไรต้องอะตอมมิก จึงยิง PostgREST ตรง ไม่ผ่าน RPC
 * สิทธิ์คุมด้วย policy ใน 0003 (customers.view / customers.write / customers.delete)
 * ยิงเกินสิทธิ์จะได้ 42501 ซึ่ง toDataError() แปลเป็น "ไม่มีสิทธิ์ทำรายการนี้" ให้แล้ว
 */

export interface CustomerFilter {
  q?: string
  segment?: string
  page?: number
  limit?: number
}

export interface Paged<T> {
  rows: T[]
  total: number
  page: number
  limit: number
}

export async function listCustomers(f: CustomerFilter = {}): Promise<Paged<CustomerRow>> {
  const page = f.page ?? 1
  const limit = f.limit ?? 20
  const from = (page - 1) * limit

  let q = supabase.from('customers').select('*', { count: 'exact' })
  /* ค้นหลายคอลัมน์พร้อมกัน — or() ของ PostgREST ใช้ comma คั่น ห้ามเว้นวรรค
     ilike ไม่ใช่ like เพราะชื่อลูกค้าพิมพ์ใหญ่เล็กปนกัน */
  if (f.q) q = q.or(`name.ilike.%${f.q}%,contact_person.ilike.%${f.q}%,phone.ilike.%${f.q}%`)
  if (f.segment) q = q.eq('segment', f.segment)

  const { data, count, error } = await q.order('name').range(from, from + limit - 1)
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0, page, limit }
}

/** สำหรับ dropdown — ไม่แบ่งหน้า ใช้ตอนสร้างออเดอร์/ใบเสนอราคา */
export async function listAllCustomers(): Promise<CustomerRow[]> {
  return unwrap(supabase.from('customers').select('*').order('name'))
}

export async function getCustomer(id: number): Promise<CustomerRow> {
  return unwrap(supabase.from('customers').select('*').eq('id', id).single())
}

export type CustomerInput = Omit<CustomerRow, 'id' | 'created_at'>

export async function createCustomer(input: Partial<CustomerInput> & { name: string }): Promise<CustomerRow> {
  return unwrap(supabase.from('customers').insert(input).select().single())
}

export async function updateCustomer(id: number, input: Partial<CustomerInput>): Promise<CustomerRow> {
  return unwrap(supabase.from('customers').update(input).eq('id', id).select().single())
}

/** ลบจริง — ต่างจากออเดอร์/เที่ยวที่ยกเลิกด้วยการเปลี่ยนสถานะ
 *  ลูกค้าที่มีออเดอร์ผูกอยู่จะลบไม่ผ่านเพราะ foreign key (23503) ซึ่งถูกแล้ว */
export async function removeCustomer(id: number): Promise<void> {
  const { error } = await supabase.from('customers').delete().eq('id', id)
  if (error) throw error
}

/* ---------- บันทึกการติดต่อ ---------- */

export async function listInteractions(customerId: number): Promise<CustomerInteractionRow[]> {
  return unwrap(
    supabase
      .from('customer_interactions')
      .select('*')
      .eq('customer_id', customerId)
      .order('happened_at', { ascending: false }),
  )
}

export async function createInteraction(input: {
  customer_id: number
  type?: InteractionType
  subject: string
  note?: string | null
  happened_at: string
  created_by: number | null
}): Promise<CustomerInteractionRow> {
  return unwrap(supabase.from('customer_interactions').insert(input).select().single())
}

/* ---------- งานติดตาม ---------- */

export async function listTasks(customerId: number): Promise<CustomerTaskRow[]> {
  return unwrap(
    supabase
      .from('customer_tasks')
      .select('*')
      .eq('customer_id', customerId)
      .order('due_at', { nullsFirst: false }),
  )
}

export async function createTask(input: {
  customer_id: number
  title: string
  due_at?: string | null
  note?: string | null
  created_by: number | null
}): Promise<CustomerTaskRow> {
  return unwrap(supabase.from('customer_tasks').insert(input).select().single())
}

export async function setTaskStatus(id: number, status: 'pending' | 'done'): Promise<CustomerTaskRow> {
  return unwrap(supabase.from('customer_tasks').update({ status }).eq('id', id).select().single())
}
