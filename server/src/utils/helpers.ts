/** รวม helper ทั่วไป: เลขที่เอกสาร, วันที่, หน้า, เงิน */

export function pad(n: number, len = 4): string {
  return String(n).padStart(len, '0')
}

export function generateDocNo(prefix: string, seq: number, year = new Date().getFullYear()): string {
  return `${prefix}-${year}-${pad(seq)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

export function startOfMonth(date: Date): Date {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

export function daysAgo(days: number, hour = 8): Date {
  const d = addDays(new Date(), -days)
  d.setHours(hour, 0, 0, 0)
  return d
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export function buildPagination(total: number, page: number, limit: number): Pagination {
  return {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  }
}

/** แปลงค่า query ที่อาจเป็น string | string[] เป็นตัวเลขปลอดภัย */
export function parsePage(raw: unknown, fallback = 1, max = 1000): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), max)
}

export function parseLimit(raw: unknown, fallback = 20, max = 100): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), max)
}
