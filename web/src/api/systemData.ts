import { supabase, toDataError } from './supabase.js'

export type DataSummary = { table: string; label: string; count: number }

const sources = [
  ['tms_shipments', 'ข้อมูลจาก TMS'],
  ['tms_trips', 'เที่ยวจาก TMS'],
  ['customers', 'ลูกค้า'],
  ['orders', 'ออเดอร์'],
  ['trips', 'เที่ยวขนส่ง'],
  ['drivers', 'พนักงานขับ'],
  ['vehicles', 'รถยนต์'],
  ['users', 'ผู้ใช้'],
] as const

export async function loadDataSummary(): Promise<DataSummary[]> {
  const results = await Promise.all(sources.map(async ([table, label]) => {
    const { count, error } = await supabase.from(table as never).select('*', { count: 'exact', head: true })
    if (error) throw toDataError(error)
    return { table, label, count: count ?? 0 }
  }))
  return results
}
