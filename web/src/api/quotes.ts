import { supabase, unwrap, toDataError } from './supabase.js'
import type { QuoteRow, QuoteStatus } from '../types/database.js'
import type { Paged } from './customers.js'

/**
 * ใบเสนอราคา — แทน server/src/modules/quotes
 *
 * CRUD ยิงตารางตรง ยกเว้น convertToOrder() ที่ต้องเป็น RPC
 * เพราะมันสร้างออเดอร์ใหม่ + มาร์คใบเสนอราคาว่าแปลงแล้ว ในก้อนเดียว
 * และต้องกันสองคนกดแปลงใบเดียวกันพร้อมกัน (ฟังก์ชันใช้ for update ล็อกแถวไว้)
 * ปล่อยให้หน้าจอยิงสอง request = ได้ออเดอร์สองใบจากใบเสนอราคาเดียว
 */

export interface QuoteFilter {
  q?: string
  status?: QuoteStatus
  customerId?: number
  page?: number
  limit?: number
}

export async function listQuotes(f: QuoteFilter = {}): Promise<Paged<QuoteRow>> {
  const page = f.page ?? 1
  const limit = f.limit ?? 20
  const start = (page - 1) * limit

  let q = supabase.from('quotes').select('*', { count: 'exact' })
  if (f.q) q = q.or(`quote_no.ilike.%${f.q}%,origin.ilike.%${f.q}%,destination.ilike.%${f.q}%`)
  if (f.status) q = q.eq('status', f.status)
  if (f.customerId) q = q.eq('customer_id', f.customerId)

  const { data, count, error } = await q.order('id', { ascending: false }).range(start, start + limit - 1)
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0, page, limit }
}

export async function listQuotesByCustomer(customerId: number): Promise<QuoteRow[]> {
  return unwrap(
    supabase.from('quotes').select('*').eq('customer_id', customerId).order('id', { ascending: false }),
  )
}

export async function getQuote(id: number): Promise<QuoteRow> {
  return unwrap(supabase.from('quotes').select('*').eq('id', id).single())
}

export type QuoteInput = Omit<
  QuoteRow,
  'id' | 'quote_no' | 'created_at' | 'updated_at' | 'status' | 'converted_order_id'
>

export async function createQuote(input: Partial<QuoteInput> & {
  origin: string
  destination: string
  goods_desc: string
}): Promise<QuoteRow> {
  return unwrap(supabase.from('quotes').insert(input).select().single())
}

/** แก้ได้เฉพาะใบที่ยังไม่แปลงเป็นออเดอร์ — เงื่อนไขอยู่ใน query ไม่ใช่ในหน้าจอ */
export async function updateQuote(id: number, input: Partial<QuoteInput>): Promise<QuoteRow> {
  return unwrap(
    supabase
      .from('quotes')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', id)
      .is('converted_order_id', null)
      .select()
      .single(),
  )
}

export async function setQuoteStatus(id: number, status: QuoteStatus): Promise<QuoteRow> {
  return unwrap(
    supabase
      .from('quotes')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .is('converted_order_id', null)
      .select()
      .single(),
  )
}

export async function convertQuoteToOrder(
  id: number,
  scheduledAt: string,
  notes?: string | null,
): Promise<{ order_id: number; order_no: string }> {
  const { data, error } = await supabase.rpc('convert_quote', {
    p_quote_id: id,
    p_scheduled_at: scheduledAt,
    p_notes: notes ?? null,
  })
  if (error) throw toDataError(error)
  return data as { order_id: number; order_no: string }
}
