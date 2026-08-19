import { supabase, toDataError } from './supabase.js'

/**
 * โควตาแพลนที่ใช้อยู่ — ตัวเลขจาก dashboard ของ Supabase
 *
 * เก็บไว้ที่เดียวตรงนี้ ไม่กระจายไปอยู่ในหน้าจอ เพราะวันที่อัปเป็นแพลนอื่น
 * ต้องแก้ที่เดียวจบ และคนที่มาแก้ต้องเห็นทันทีว่าตัวเลขมาจากไหน
 *
 * egress ไม่มีทางอ่านจากในฐานได้ — Supabase นับที่ชั้น network ไม่ใช่ใน Postgres
 * ค่านี้จึงมีไว้เป็นเพดานให้เทียบ ส่วนตัวเลขที่ใช้ไปต้องเปิด dashboard เอง
 * จนกว่าจะมีตัวต่อกับ Management API
 */
export const PLAN = {
  name: 'Free',
  egressBytes: 5 * 1024 ** 3,
  dbBytes: 500 * 1024 ** 2,
  mau: 50_000,
  fileBytes: 1 * 1024 ** 3,
} as const

export interface UsageTable {
  name: string
  bytes: number
  approx_rows: number
}

export interface UsageBucket {
  name: string
  objects: number
  bytes: number
}

export interface UsageStats {
  db_bytes: number
  file_bytes: number
  file_objects: number
  /** นับจาก last_sign_in_at ย้อนหลัง 30 วัน — ใกล้เคียงตัวที่ Supabase คิด ไม่ใช่ตัวเดียวกัน
   *  คนที่เปิดแอปค้างแล้ว refresh token เงียบ ๆ นับเป็น MAU ของ Supabase แต่ไม่ขยับค่านี้ */
  mau_estimate: number
  tables: UsageTable[]
  buckets: UsageBucket[]
  measured_at: string
}

export async function loadUsageStats(): Promise<UsageStats> {
  const { data, error } = await supabase.rpc('usage_stats')
  if (error) throw toDataError(error)
  return data as unknown as UsageStats
}

/** ขนาดไฟล์แบบที่คนอ่านออก — ใช้ฐาน 1024 ให้ตรงกับที่ dashboard ของ Supabase แสดง */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`
}
