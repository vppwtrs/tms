import type Database from 'better-sqlite3'

export interface OrderPressure {
  pending: number
  urgent_unassigned: number
  overdue: number
}

export interface QuoteSample {
  quote_no: string
  customer_name: string | null
  valid_until: string
}

export interface Availability {
  vehicles_available: number
  vehicles_total: number
  drivers_available: number
  drivers_total: number
  trips_in_progress: number
}

export interface DeliveredToday {
  count: number
  revenue: number
  prev_revenue: number
}

/** SQL ทั้งหมดของ "AI สรุปประจำวัน" — รวมข้อมูลจากหลายตาราง (orders/trips/quotes/customers/vehicles/drivers) */
export class InsightsRepository {
  constructor(private readonly db: Database.Database) {}

  /** ออเดอร์ที่ยังค้างในคิว + ที่สร้างแรงกดดัน (ด่วน/เลยกำหนด) */
  orderPressure(): OrderPressure {
    const pending = this.db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending','assigned')`).get() as {
      c: number
    }
    const urgent = this.db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending','assigned') AND priority = 'urgent'`)
      .get() as { c: number }
    const overdue = this.db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending','assigned') AND scheduled_at < ?`)
      .get(new Date().toISOString()) as { c: number }
    return { pending: pending.c, urgent_unassigned: urgent.c, overdue: overdue.c }
  }

  /** ใบเสนอราคาสถานะ "ส่งแล้ว" ที่หมดอายุภายใน cutoff (รวมที่เลยมาแล้ว) */
  expiringQuotes(cutoffIso: string): QuoteSample[] {
    return this.db
      .prepare(
        `SELECT q.quote_no, c.name AS customer_name, q.valid_until
         FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id
         WHERE q.status = 'sent' AND q.valid_until IS NOT NULL AND q.valid_until <= ?
         ORDER BY q.valid_until ASC LIMIT 10`,
      )
      .all(cutoffIso) as QuoteSample[]
  }

  /** จำนวนใบเสนอราคาที่ส่งแล้วทั้งหมด (ยังไม่ปิด) */
  sentQuoteCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM quotes WHERE status = 'sent'`).get() as { c: number }
    return row.c
  }

  /** ลูกค้าที่เคยมีออเดอร์แต่เงียบเกิน N วัน */
  atRiskCustomers(days: number, limit = 5): { name: string; days_since: number }[] {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString()
    return this.db
      .prepare(
        `SELECT c.name, CAST(julianday('now') - julianday(MAX(o.created_at)) AS INTEGER) AS days_since
         FROM customers c
         JOIN orders o ON o.customer_id = c.id
         WHERE o.status != 'cancelled'
         GROUP BY c.id
         HAVING MAX(o.created_at) < ?
         ORDER BY days_since DESC LIMIT ?`,
      )
      .all(cutoff, limit) as { name: string; days_since: number }[]
  }

  /** ความพร้อมของทรัพยากร + เที่ยวที่กำลังวิ่ง */
  availability(): Availability {
    const v = this.db
      .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END), 0) AS avail FROM vehicles WHERE status != 'inactive'`)
      .get() as { total: number; avail: number }
    const d = this.db
      .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END), 0) AS avail FROM drivers`)
      .get() as { total: number; avail: number }
    const t = this.db.prepare(`SELECT COUNT(*) AS c FROM trips WHERE status = 'in_progress'`).get() as { c: number }
    return {
      vehicles_available: v.avail,
      vehicles_total: v.total,
      drivers_available: d.avail,
      drivers_total: d.total,
      trips_in_progress: t.c,
    }
  }

  /** ส่งสำเร็จวันนี้ vs เมื่อวาน (จำนวน + รายได้) */
  deliveredToday(todayStartIso: string, tomorrowIso: string, yesterdayStartIso: string): DeliveredToday {
    const today = this.db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(fee), 0) AS s
         FROM orders WHERE status = 'delivered' AND delivered_at >= ? AND delivered_at < ?`,
      )
      .get(todayStartIso, tomorrowIso) as { c: number; s: number }
    const prev = this.db
      .prepare(
        `SELECT COALESCE(SUM(fee), 0) AS s
         FROM orders WHERE status = 'delivered' AND delivered_at >= ? AND delivered_at < ?`,
      )
      .get(yesterdayStartIso, todayStartIso) as { s: number }
    return { count: today.c, revenue: today.s, prev_revenue: prev.s }
  }
}
