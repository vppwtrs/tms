import { supabase } from './supabase'

/**
 * งานวันนี้ + งานรายคัน + ปริมาณงานตามช่วงเวลา (หน้าภาพรวม v6)
 *
 * แยกจาก `opsOverview` เพราะตอบคนละคำถามและเปลี่ยนคนละจังหวะ:
 * ops_overview ตอบภาพรวมของช่วงวัน (ความคืบหน้า Issues กำลังรับงาน)
 * ส่วนสองตัวนี้ตอบ "วันนี้ใช้รถกี่คัน แต่ละคันถึงไหน" กับ "ปริมาณงานเป็นยังไง"
 * ซึ่งผู้ใช้สลับช่วงเวลาได้เองโดยไม่ควรต้องโหลดทั้งหน้าใหม่
 *
 * เหตุผลที่ให้ฐานคำนวณทั้งหมดเหมือนเดิม: การจับกลุ่มร้านมีกติกาของมันอยู่แล้ว
 * (app.stop_key = storeKey) ถ้าหน้านี้นับเอง เลขจะไม่ตรงกับหน้าออเดอร์
 * โดยไม่มีอะไรฟ้อง — ดูคำอธิบายเต็มใน api/opsOverview.ts
 */

/** null = ยังไม่มีตัวเลข ไม่ใช่ศูนย์บาท — ค่าเงินทุกช่องในไฟล์นี้ถือกติกานี้ */
export interface TodayStats {
  vehicles_used: number
  vehicles_usable: number
  vehicles_free: number
  trips: number
  /** หนึ่งใบ = หนึ่ง picking list · ออเดอร์ที่สร้างเองนับเป็นหนึ่งใบ */
  shipments: number
  stops: number
  stops_done: number
  cost_plan: number | null
  cost_actual: number | null
  /** เที่ยวที่ยังไม่ปิดตัวเลขจริง — ถ้ามี ยอดจริงยังไม่ครบ ต้องเขียนกำกับ */
  trips_open_cost: number | null
  bonus_total: number | null
  bonus_trips: number
}

export interface UnitKind {
  /** 'box' | 'vehicle' — ฐานคืนเท่าที่มีจริง ไม่เติมประเภทที่ไม่มีข้อมูล */
  kind: string
  orders: number
  units: number
}

export interface FleetRow {
  vehicle_id: number
  plate: string
  /** ชื่อคนขับทั้งชุด คั่นด้วย " + " · null เมื่อเที่ยวยังไม่มีคนขับ */
  crew: string | null
  crew_size: number
  trips: number
  stops: number
  stops_done: number
  over_free: boolean
  /** ร้านของจุดที่ปิดล่าสุด — ไม่ใช่ตำแหน่ง GPS (ดูหมายเหตุใน FleetTable) */
  last_stop: string | null
  last_at: string | null
  cost_plan: number | null
  cost_actual: number | null
  /** เที่ยวของคันนี้ที่ยังไม่ปิดตัวเลขจริง */
  cost_open: number
  bonus: number | null
}

export interface OpsToday {
  date: string
  /** สิทธิ์ถึงตัวเลขเงินหรือไม่ — ไม่ถึงแล้วช่องเงินเป็น null ทั้งหมด */
  money: boolean
  today: TodayStats
  units: UnitKind[]
  fleet: FleetRow[]
  bonus_rule: { free_stops: number; rate: number }
}

export type VolumeGrain = 'day' | 'month' | 'year'

export interface VolumePoint {
  key: string
  stops: number
  trips: number
  /** ช่วงสุดท้ายที่ยังไม่จบ — เทียบเต็มช่วงกับช่วงก่อนหน้าไม่ได้ */
  partial: boolean
}

export interface OpsVolume {
  grain: VolumeGrain
  points: VolumePoint[]
}

/* supabase-js ผูก `this` ไว้กับตัว client — ดึง .rpc ออกมาเป็นตัวแปรแล้วเรียก
   จะได้ `Cannot read properties of undefined (reading 'rest')` ตอนรันจริง
   ต้องเรียกผ่านตัว client เสมอ (เคยพังบนหน้าแรกมาแล้ว ดู opsOverview.rpc.test.ts) */
const client = supabase as unknown as {
  rpc: (fn: string, args: Record<string, unknown>) =>
    Promise<{ data: unknown; error: { message: string } | null }>
}

export async function opsToday(date?: string): Promise<OpsToday> {
  const { data, error } = await client.rpc('ops_today', { p_date: date ?? null })
  if (error) throw new Error(error.message)
  return data as OpsToday
}

export async function opsVolume(grain: VolumeGrain = 'day'): Promise<OpsVolume> {
  const { data, error } = await client.rpc('ops_volume', { p_grain: grain })
  if (error) throw new Error(error.message)
  return data as OpsVolume
}

/** ชื่อไทยของประเภทงาน — ฐานเก็บเป็นคำอังกฤษสั้น ๆ ที่ไม่ได้ตั้งใจให้คนอ่าน
 *  ประเภทที่ยังไม่รู้จักคืนค่าเดิมกลับไป ดีกว่าเขียนว่า "อื่น ๆ" แล้วซ่อนว่ามันคืออะไร */
export function unitLabel(kind: string): string {
  if (kind === 'box') return 'BOX'
  if (kind === 'vehicle') return 'งานคัน'
  if (kind === 'pallet') return 'พาเรท'
  return kind
}

/** ส่วนต่างค่าขนส่ง — บวก = จ่ายเกินแผน
 *  คืน null เมื่อขาดข้างใดข้างหนึ่ง เพราะ "เกินแผน 0 บาท" กับ "ยังไม่รู้" ไม่เหมือนกัน */
export function costVariance(plan: number | null, actual: number | null): number | null {
  if (plan === null || actual === null) return null
  return actual - plan
}

/** สัดส่วนจุดที่ปิดแล้วของรถคันหนึ่ง — 0 เมื่อยังไม่มีจุด (กันหารศูนย์) */
export function rowProgress(row: FleetRow): number {
  if (row.stops <= 0) return 0
  return Math.min(1, row.stops_done / row.stops)
}

/** "เมื่อ 12 นาทีที่แล้ว" — เวลาสัมพัทธ์อ่านง่ายกว่านาฬิกาเมื่อคำถามคือ "ยังขยับอยู่ไหม"
 *  เกินหนึ่งวันคืนวันที่ไปเลย เพราะ "1,440 นาทีที่แล้ว" ไม่ได้ช่วยใคร */
export function sinceText(iso: string | null, now: Date = new Date()): string {
  if (!iso) return ''
  const then = new Date(iso)
  const mins = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (!Number.isFinite(mins) || mins < 0) return ''
  if (mins < 1) return 'เมื่อครู่'
  if (mins < 60) return `${mins} นาทีที่แล้ว`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} ชม.ที่แล้ว`
  return then.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

/** ป้ายแกนนอนของกราฟ — คนละรูปแบบตามช่วงเวลา วันที่เต็มบนแกนรายปีคือขยะ */
export function volumeLabel(key: string, grain: VolumeGrain): string {
  const d = new Date(`${key}T00:00:00`)
  if (grain === 'year') return String(d.getFullYear() + 543)
  if (grain === 'month') return d.toLocaleDateString('th-TH', { month: 'short' })
  return String(d.getDate())
}
