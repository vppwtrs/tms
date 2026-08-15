import { supabase, unwrap, toDataError } from './supabase.js'
import type { TmsShipmentRow, TmsDealerMapRow } from '../types/database.js'

/**
 * สะพานจาก TMS บริษัท — ไม่มีของเดิมใน server/ ให้แทน นี่เป็นของใหม่ทั้งก้อน
 *
 * ลำดับที่ตั้งใจให้เป็น: sync (Edge Function ตอนตี 1) -> preview -> คนจับคู่ร้าน -> import
 *
 * **ห้ามข้าม preview** ปุ่มนำเข้าที่กดแล้วเข้าเลยโดยไม่ให้ดูก่อน คือปุ่มที่คนกดแล้วเสียใจ
 * ชื่อร้านใน TMS ไม่ตรงกับชื่อลูกค้าในระบบเรา จับคู่ผิด = ออเดอร์ไปโผล่ผิดลูกค้าแบบเงียบ ๆ
 */

export async function listShipments(date: string): Promise<TmsShipmentRow[]> {
  return unwrap(
    supabase.from('tms_shipments').select('*').eq('trip_date', date).order('picking_list_no'),
  )
}

export interface ImportPreview {
  date: string
  picking_lists: number
  trips: number
  already_imported: number
  unmapped_dealers: { dealer_code: string; dealer_name: string; picking_lists: number }[]
  unknown_plates: string[]
}

export async function previewImport(date: string): Promise<ImportPreview> {
  const { data, error } = await supabase.rpc('preview_tms_import', { p_date: date })
  if (error) throw toDataError(error)
  return data as ImportPreview
}

/** ใบที่ร้านยังไม่จับคู่จะถูก "ข้าม" ไม่ใช่ทำให้ทั้งวันล้ม — ดู skipped ในผลลัพธ์
 *  เรียกซ้ำวันเดิมได้ ใบที่เข้าไปแล้วจะไม่ถูกสร้างซ้ำ */
export async function importShipments(date: string): Promise<{ date: string; created: number; skipped: number }> {
  const { data, error } = await supabase.rpc('import_tms_shipments', { p_date: date })
  if (error) throw toDataError(error)
  return data as { date: string; created: number; skipped: number }
}

/* ---------- ตารางจับคู่ร้าน ---------- */

export async function listDealerMap(): Promise<TmsDealerMapRow[]> {
  return unwrap(supabase.from('tms_dealer_map').select('*').order('dealer_name'))
}

export async function mapDealer(input: {
  dealer_code: string
  dealer_name: string
  customer_id: number | null
  ignored?: boolean
  mapped_by: number | null
}): Promise<TmsDealerMapRow> {
  return unwrap(
    supabase
      .from('tms_dealer_map')
      .upsert({ ...input, mapped_at: new Date().toISOString() }, { onConflict: 'dealer_code' })
      .select()
      .single(),
  )
}
