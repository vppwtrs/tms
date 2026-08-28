import { todayIso } from './format'

/**
 * ตะแกรงปฏิทินหนึ่งเดือน — แยกออกจากคอมโพเนนต์เพราะเป็นการคิดวันที่ล้วน ๆ
 * ซึ่งเป็นที่ที่บั๊กชอบอยู่ (เดือนที่ขึ้นต้นวันอาทิตย์ เดือนกุมภาพันธ์ปีอธิกสุรทิน
 * เดือนที่ต้องใช้หกแถว) และเป็นสิ่งที่เทสต์ได้ตรง ๆ โดยไม่ต้องเรนเดอร์อะไรเลย
 */

/** ชื่อวันในสัปดาห์แบบสั้น เรียงตามที่ปฏิทินไทยขึ้นต้น: อาทิตย์ก่อน */
export const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const

export const MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const

export interface CalendarCell {
  /** null = ช่องเติมของเดือนข้างเคียง ไม่ใช่วันที่กดได้ */
  iso: string | null
  day: number | null
}

/** ปี-เดือนของวันที่ ISO ในรูป {y, m} โดย m เริ่มที่ 0 ตามแบบของ Date */
export function ymOf(iso: string): { y: number; m: number } {
  const d = new Date(`${iso}T00:00:00`)
  return { y: d.getFullYear(), m: d.getMonth() }
}

/** ชื่อเดือนพร้อมปี พ.ศ. — ปฏิทินไทยใช้พุทธศักราชเสมอ ใช้ ค.ศ. แล้วคนอ่านผิดทันที */
export function monthTitle(y: number, m: number): string {
  return `${MONTHS[m]} ${y + 543}`
}

/** ตะแกรงหกแถว เจ็ดช่อง — ความสูงคงที่ทุกเดือน
 *
 *  ปฏิทินที่สูงไม่เท่ากันแต่ละเดือนทำให้ปุ่มด้านล่างขยับตอนกดเปลี่ยนเดือน
 *  ซึ่งเป็นสาเหตุที่คนกดพลาด — เดือนที่ใช้ห้าแถวจึงเติมแถวที่หกเป็นช่องว่าง
 */
export function monthGrid(y: number, m: number): CalendarCell[] {
  const first = new Date(y, m, 1)
  const lead = first.getDay()
  const days = new Date(y, m + 1, 0).getDate()

  const cells: CalendarCell[] = []
  for (let i = 0; i < lead; i++) cells.push({ iso: null, day: null })
  for (let d = 1; d <= days; d++) cells.push({ iso: todayIso(new Date(y, m, d)), day: d })
  while (cells.length < 42) cells.push({ iso: null, day: null })
  return cells
}

/** เลื่อนเดือนไปข้างหน้า/ถอยหลัง โดยไม่ให้ปีเพี้ยนตอนข้ามธันวาคม-มกราคม */
export function shiftMonth(y: number, m: number, by: number): { y: number; m: number } {
  const d = new Date(y, m + by, 1)
  return { y: d.getFullYear(), m: d.getMonth() }
}

/** เดือนนี้อยู่ในอนาคตทั้งเดือนหรือยัง — ใช้ปิดปุ่มเดือนถัดไป
 *  ปล่อยให้กดไปเดือนหน้าได้ทั้งที่ทุกวันกดไม่ได้ คือปุ่มที่หลอกให้กดแล้วไม่ได้อะไร */
export function isFutureMonth(y: number, m: number, today = new Date()): boolean {
  return y > today.getFullYear() || (y === today.getFullYear() && m > today.getMonth())
}

/** วันในอนาคตเลือกไม่ได้ — ยังไม่มีข้อมูลของวันที่ยังไม่เกิด */
export function isFutureDay(iso: string, today = new Date()): boolean {
  return iso > todayIso(today)
}

/** ป้ายของปุ่มเลือกวัน — วันนี้กับเมื่อวานเรียกด้วยคำ ไม่ใช่วันที่
 *  เพราะคนคิดเป็น "เมื่อวาน" ไม่ได้คิดเป็น "27 ส.ค." เวลาย้อนดูงานเมื่อวาน */
export function dayButtonLabel(iso: string, today = new Date()): string {
  const t = todayIso(today)
  if (iso === t) return 'วันนี้'
  const y = new Date(today)
  y.setDate(y.getDate() - 1)
  if (iso === todayIso(y)) return 'เมื่อวาน'

  const d = new Date(`${iso}T00:00:00`)
  const sameYear = d.getFullYear() === today.getFullYear()
  return d.toLocaleDateString('th-TH', sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' })
}
