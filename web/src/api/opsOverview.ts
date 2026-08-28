import { supabase } from './supabase'

/**
 * หน้าภาพรวม — ตัวเลขทั้งหน้ามาจากการเรียกครั้งเดียว
 *
 * ฐานคำนวณให้หมด (public.ops_overview) หน้านี้ไม่นับอะไรเอง ด้วยเหตุผลสองข้อ
 *   1. ช้า — จุดส่งวันเดียวเป็นหลักร้อยแถว และต้องจับกลุ่มร้านก่อนถึงจะนับได้
 *   2. จะได้เลขไม่ตรงกับหน้าอื่น — การจับกลุ่มร้านมีกติกาของมันอยู่แล้ว (storeKey)
 *      ถ้าหน้านี้นับด้วยกติกาของตัวเอง หน้าภาพรวมกับหน้าออเดอร์จะบอกจำนวนจุด
 *      ไม่เท่ากันโดยไม่มีอะไรฟ้อง แล้วคนอ่านจะเลิกเชื่อทั้งสองหน้า
 *
 * ต่างจาก opsInsights ที่เป็นกฎฝั่งเบราว์เซอร์ — ตัวนั้นตอบว่า "มีอะไรต้องรีบ"
 * จากข้อมูลที่หน้าอื่นดึงอยู่แล้ว ตัวนี้ตอบว่า "วันนี้ไปถึงไหน" ซึ่งต้องนับทั้งฐาน
 *
 * ก้อนที่สิทธิ์ไม่ถึงจะเป็น null ไม่ใช่หน้าพัง — ตัวเลขเงินขอ dispatch.view เพิ่ม
 */

/** ตัวเลขที่คิดจากข้อมูลบางส่วน ต้องบอกเสมอว่าคิดจากฐานเท่าไหร่
 *
 *  ไม่ใช่การกันตัว — freight_cost ที่เป็น null แปลว่า "ยังไม่ปิดตัวเลข" ไม่ใช่
 *  "ศูนย์บาท" ค่าเฉลี่ยที่คิดจาก 40% ของเที่ยวกับที่คิดจาก 95% เป็นคนละความมั่นใจ
 *  และคนอ่านต้องรู้ว่ากำลังอ่านอันไหน */
export interface Coverage {
  /** คิดจากกี่ % ของเที่ยวในช่วง */
  coverage_pct: number
  /** จำนวนเที่ยวที่มีตัวเลขจริง */
  trips: number
}

export interface OverviewProgress {
  stops_done: number
  stops_total: number
  /** จุดที่รถถือของอยู่แล้ว รอถึงร้าน */
  stops_running: number
  /** จุดที่ยังไม่ออกจากคลัง — คนละปัญหากับ stops_running และแก้คนละวิธี */
  stops_waiting: number
  stops_cancelled: number
}

export interface OverviewKpis {
  /** จบครบภายในวัน — เทียบ *วัน* ไม่ใช่เวลา ดูเหตุผลใน migration ของ ops_overview */
  same_day: { pct: number; base: number } | null
  /** จุดต่อเที่ยว — ตัวที่ทำให้ค่าเหมาคุ้มหรือไม่คุ้ม (งานส่วนใหญ่เป็นเหมาจ่าย) */
  stops_per_trip: { value: number; trips: number } | null
  /** ค่าเหมาต่อจุด — บาท · null เมื่อสิทธิ์ไม่ถึงหรือไม่มีเที่ยวที่ปิดตัวเลข */
  cost_per_stop: (Coverage & { value: number }) | null
  /** ส่วนต่างสัญญากับที่ปิดจริง — บวก = จ่ายเกินสัญญา */
  cost_variance: (Coverage & { total: number; per_trip: number }) | null
}

export interface ChartPoint {
  day: string
  stops: number
}

/** ประมาณการ — ขีดคร่อมคือช่วงที่เคยแกว่งจริง ไม่ใช่ช่วงความเชื่อมั่นทางสถิติ
 *  ต้องเขียนกำกับบนหน้าจอแบบนั้นด้วย ไม่งั้นมันอ่านเป็นคำสัญญา */
export interface ChartEstimate extends ChartPoint {
  low: number
  high: number
  /** ใช้ข้อมูลกี่สัปดาห์ — น้อยกว่า 4 แปลว่าเพิ่งมีข้อมูล อย่าเชื่อมาก */
  samples: number
}

export interface OverviewChart {
  /** เกิดขึ้นจริง */
  actual: ChartPoint[]
  /** ยืนยันแล้วจาก TMS (plan_delivery_date) */
  planned: ChartPoint[]
  /** ประมาณการจากค่าเฉลี่ยเคลื่อนที่ 4 สัปดาห์ แยกตามวันในสัปดาห์ */
  estimate: ChartEstimate[]
}

export interface OverviewCapacity {
  vehicles: number
  vehicles_running: number
  vehicles_free: number
  /** ซ่อม + ปลดระวาง — สำหรับหน้านี้คือ "วันนี้เอาไปใช้ไม่ได้" เหมือนกัน */
  vehicles_off: number
  drivers: number
  drivers_free: number
  /** มีงานจริงกี่วันใน 28 วันล่าสุด — ฐานของค่าเฉลี่ยต่อคันต่อวัน */
  sample_days: number
  stops_per_vehicle_day: number
  /** เส้นแดงบนแผนภูมิ — แท่งที่ชนเส้นคือคำถามที่ต้องตอบวันนี้ ไม่ใช่วันจันทร์ */
  max_stops_per_day: number
}

/** จุดหนึ่งวันของเส้นแนวโน้มใต้ KPI — ค่าที่เป็น null คือวันที่ไม่มีของให้คิด
 *  ไม่ใช่ศูนย์ เส้นต้องขาดตรงนั้น ไม่ใช่ดิ่งลงพื้น */
export interface KpiTrendPoint {
  day: string
  same_day_pct: number | null
  stops_per_trip: number | null
  cost_per_stop: number | null
}

export interface CancelReason {
  reason: string
  orders: number
}

export interface OpsOverview {
  range: { from: string; to: string; today: string }
  progress: OverviewProgress | null
  kpis: OverviewKpis
  chart: OverviewChart
  capacity: OverviewCapacity | null
  kpi_trend: KpiTrendPoint[]
  cancel_reasons: CancelReason[]
}

/** ไม่ส่งวันมา = วันนี้ · ส่ง from อย่างเดียว = ตั้งแต่วันนั้นถึงวันนี้ */
export async function opsOverview(from?: string, to?: string): Promise<OpsOverview> {
  /* ฟังก์ชันนี้เพิ่งเกิด ยังไม่อยู่ใน types ที่ generate มาจากฐาน — cast ตรงนี้จุดเดียว
     แล้วให้ทุกคนที่เรียกได้ type จริง เมื่อ regenerate types แล้วให้ลบ cast ทิ้ง */
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>

  const { data, error } = await rpc('ops_overview', { p_from: from ?? null, p_to: to ?? null })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('ฐานข้อมูลไม่ได้ส่งสรุปกลับมา')
  return data as OpsOverview
}

/** ความคืบหน้าเป็นสัดส่วน 0–1 — ยังไม่มีจุดในวันนั้นให้ตอบ 0 ไม่ใช่ NaN
 *
 *  เช้าตรู่ที่ยังไม่มีเที่ยวออก ตัวหารเป็นศูนย์ ถ้าปล่อย NaN ไปถึงหน้าจอ
 *  แถบความคืบหน้าจะยาวสุดกรอบ ซึ่งอ่านว่า "เสร็จหมดแล้ว" — ผิดคนละทาง */
export function progressRatio(p: OverviewProgress | null): number {
  if (!p || p.stops_total <= 0) return 0
  return Math.min(1, p.stops_done / p.stops_total)
}

/** ข้อความกำกับใต้ตัวเลขที่คิดจากข้อมูลบางส่วน
 *
 *  ครบทุกเที่ยวก็ไม่ต้องเขียนอะไร การเขียน "จาก 100%" ทุกใบทำให้คำเตือนกลายเป็น
 *  ของประดับที่ไม่มีใครอ่าน แล้ววันที่มันเหลือ 40% จริง ๆ ก็ไม่มีใครสังเกต */
export function coverageNote(c: Coverage | null, unit = 'ของเที่ยวที่มีตัวเลข'): string {
  if (!c || c.coverage_pct >= 100) return ''
  return `จาก ${Math.round(c.coverage_pct)}% ${unit}`
}

/** ประมาณการที่ข้อมูลยังไม่ครบ 4 สัปดาห์ ต้องบอกให้รู้ ไม่ใช่ซ่อน */
export function isThinEstimate(e: ChartEstimate): boolean {
  return e.samples < 4
}

/** ต้องมีงานอย่างน้อยเท่านี้วันใน 28 วันล่าสุด ถึงจะวาดเส้น "กำลังรับงาน" ได้ */
const CAPACITY_MIN_DAYS = 10

/** เส้นกำลังรับงานเชื่อถือได้หรือยัง
 *
 *  ยิงกับฐานจริงครั้งแรกได้ 5 เที่ยวใน 30 วัน จุดเฉลี่ยต่อคันต่อวันออกมา 0.47
 *  เส้นแดงเลยตกที่ 3 จุด/วัน ต่ำกว่าแท่งประมาณการเกือบทุกวัน หน้าจอจะเตือนว่า
 *  "เกินกำลังรับงาน" ทุกวันทั้งที่รถว่างทั้งอู่ — เส้นนั้นไม่ได้วัดกำลังรถ
 *  มันวัดว่าเดือนที่แล้วมีงานเข้ามาน้อย
 *
 *  คำเตือนที่ดังทุกวันเท่ากับไม่มีคำเตือน วันที่มันดังเพราะเรื่องจริงจะไม่มีใครอ่าน */
export function hasReliableCapacity(c: OverviewCapacity | null): boolean {
  return c !== null && c.sample_days >= CAPACITY_MIN_DAYS && c.max_stops_per_day > 0
}

/** พิกัด polyline ของ sparkline จากชุดแนวโน้ม
 *
 *  วันที่ไม่มีค่าถูกข้าม ไม่ใช่วาดเป็นศูนย์ — วันหยุดที่ไม่มีงานเลยแล้วเส้นดิ่งลงพื้น
 *  จะอ่านว่า "วันนั้นทำได้แย่มาก" ทั้งที่ความจริงคือวันนั้นไม่มีงาน
 *
 *  จุดเดียวหรือไม่มีเลย = ไม่มีเส้น (คืน '') เส้นตรงแบนจากจุดเดียวสื่อว่า "นิ่ง"
 *  ทั้งที่ยังไม่รู้อะไรเลย
 */
export function sparkPoints(
  trend: KpiTrendPoint[],
  pick: (p: KpiTrendPoint) => number | null,
  w = 150,
  h = 22,
): string {
  const vals = trend.map(pick).filter((v): v is number => v !== null)
  if (vals.length < 2) return ''

  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const step = w / (vals.length - 1)
  /* เว้นขอบบนล่างอย่างละ 2px เส้นจะได้ไม่ถูกตัดตรงยอด */
  return vals
    .map((v, i) => `${(i * step).toFixed(1)},${(2 + (h - 4) * (1 - (v - min) / span)).toFixed(1)}`)
    .join(' ')
}
