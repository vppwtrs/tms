import type Database from 'better-sqlite3'

export interface ReportKpis {
  total_orders: number
  delivered: number
  cancelled: number
  revenue: number
  costs: number
  profit: number
  on_time: number
  avg_delivery_hours: number | null
  pod_collected: number
  pod_verified: number
}

export interface MonthlyPoint {
  month: string
  count: number
  revenue: number
}

export interface CustomerStat {
  name: string
  orders: number
  revenue: number
}

export interface DriverStat {
  id: number
  name: string
  trips: number
  orders: number
  revenue: number
  costs: number
  on_time: number
}

export interface LaneStat {
  origin: string
  destination: string
  orders: number
  revenue: number
}

export interface AtRiskCustomer {
  id: number
  name: string
  segment: string | null
  last_order_at: string | null
  days_since: number
  order_count: number
  total_revenue: number
}

export interface QuoteStat {
  created: number
  accepted: number
  rejected: number
  conversion_rate: number | null
}

export interface CustomerValuePoint {
  name: string
  orders: number
  revenue: number
}

/** SQL aggregation ทั้งหมดของหน้า Report */
export class ReportsRepository {
  constructor(private readonly db: Database.Database) {}

  kpis(from: string, to: string): ReportKpis {
    const total = this.db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE created_at >= ? AND created_at < ?`)
      .get(from, to) as { c: number }
    const delivered = this.db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(fee), 0) AS s,
                SUM(CASE WHEN delivered_at <= scheduled_at THEN 1 ELSE 0 END) AS ot,
                AVG((julianday(delivered_at) - julianday(created_at)) * 24) AS avg_hours
         FROM orders WHERE status = 'delivered' AND delivered_at >= ? AND delivered_at < ?`,
      )
      .get(from, to) as { c: number; s: number; ot: number; avg_hours: number | null }
    const cancelled = this.db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE status = 'cancelled' AND created_at >= ? AND created_at < ?`)
      .get(from, to) as { c: number }
    const costs = this.db
      .prepare(
        `SELECT COALESCE(SUM(fuel_cost + toll_cost + other_cost), 0) AS s
         FROM trips WHERE status = 'completed' AND arrived_at >= ? AND arrived_at < ?`,
      )
      .get(from, to) as { s: number }

    const revenue = delivered.s
    const costSum = costs.s
    return {
      total_orders: total.c,
      delivered: delivered.c,
      cancelled: cancelled.c,
      revenue,
      costs: costSum,
      profit: revenue - costSum,
      on_time: delivered.ot ?? 0,
      avg_delivery_hours: delivered.avg_hours == null ? null : Math.round(delivered.avg_hours * 10) / 10,
      pod_collected: 0, // reports.service เติมให้จาก PodRepository
      pod_verified: 0,
    }
  }

  /** 12 เดือนล่าสุด: ออเดอร์ + รายได้ (ตามวันที่ส่งสำเร็จ) */
  monthlySeries(): MonthlyPoint[] {
    const from = new Date()
    from.setMonth(from.getMonth() - 11)
    from.setDate(1)
    return this.db
      .prepare(
        `SELECT strftime('%Y-%m', delivered_at) AS month, COUNT(*) AS count, COALESCE(SUM(fee), 0) AS revenue
         FROM orders WHERE status = 'delivered' AND delivered_at >= ?
         GROUP BY month ORDER BY month`,
      )
      .all(from.toISOString()) as MonthlyPoint[]
  }

  topCustomers(from: string, to: string, limit: number): CustomerStat[] {
    return this.db
      .prepare(
        `SELECT c.name, COUNT(o.id) AS orders, COALESCE(SUM(o.fee), 0) AS revenue
         FROM orders o JOIN customers c ON c.id = o.customer_id
         WHERE o.status = 'delivered' AND o.delivered_at >= ? AND o.delivered_at < ?
         GROUP BY c.id ORDER BY revenue DESC LIMIT ?`,
      )
      .all(from, to, limit) as CustomerStat[]
  }

  driverPerformance(from: string, to: string): DriverStat[] {
    return this.db
      .prepare(
        `SELECT d.id, d.name,
                COUNT(DISTINCT t.id) AS trips,
                COUNT(o.id) AS orders,
                COALESCE(SUM(o.fee), 0) AS revenue,
                COALESCE(SUM(t.fuel_cost + t.toll_cost + t.other_cost), 0) AS costs,
                COALESCE(SUM(CASE WHEN o.delivered_at <= o.scheduled_at THEN 1 ELSE 0 END), 0) AS on_time
         FROM drivers d
         JOIN trips t ON t.driver_id = d.id AND t.status = 'completed' AND t.arrived_at >= ? AND t.arrived_at < ?
         LEFT JOIN orders o ON o.trip_id = t.id AND o.status = 'delivered'
         GROUP BY d.id
         HAVING COUNT(DISTINCT t.id) > 0
         ORDER BY trips DESC`,
      )
      .all(from, to) as DriverStat[]
  }

  lanes(from: string, to: string, limit: number): LaneStat[] {
    return this.db
      .prepare(
        `SELECT origin, destination, COUNT(*) AS orders, COALESCE(SUM(fee), 0) AS revenue
         FROM orders WHERE status = 'delivered' AND delivered_at >= ? AND delivered_at < ?
         GROUP BY origin, destination ORDER BY orders DESC LIMIT ?`,
      )
      .all(from, to, limit) as LaneStat[]
  }

  statusBreakdown(from: string, to: string): { status: string; count: number }[] {
    return this.db
      .prepare(
        `SELECT status, COUNT(*) AS count FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY status`,
      )
      .all(from, to) as { status: string; count: number }[]
  }

  /* ===== CRM analytics ===== */

  /** ลูกค้าที่เคยมีออเดอร์ แต่เงียบเกิน 30 วัน (เสี่ยงย้ายไปคู่แข่ง) */
  atRiskCustomers(days = 30, limit = 10): AtRiskCustomer[] {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString()
    return this.db
      .prepare(
        `SELECT c.id, c.name, c.segment,
                MAX(o.created_at) AS last_order_at,
                CAST(julianday('now') - julianday(MAX(o.created_at)) AS INTEGER) AS days_since,
                COUNT(o.id) AS order_count,
                COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.fee ELSE 0 END), 0) AS total_revenue
         FROM customers c
         JOIN orders o ON o.customer_id = c.id
         WHERE o.status != 'cancelled'
         GROUP BY c.id
         HAVING MAX(o.created_at) < ?
         ORDER BY days_since DESC LIMIT ?`,
      )
      .all(cutoff, limit) as AtRiskCustomer[]
  }

  /** ลูกค้าใหม่ (ออเดอร์แรกในรอบนี้) vs ลูกค้าประจำ (มีออเดอร์ก่อนรอบนี้) */
  newVsRepeat(from: string, to: string): { new_customers: number; repeat_customers: number; new_revenue: number; repeat_revenue: number } {
    // ใช้ named parameter (@from/@to) เพราะ better-sqlite3 นับ ? แต่ละจุดแยกกัน
    const row = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN o.created_at >= @from AND o.created_at < @to
                             AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.customer_id = o.customer_id AND o2.created_at < @from)
                        THEN 1 ELSE 0 END), 0) AS new_customers,
           COALESCE(SUM(CASE WHEN o.created_at >= @from AND o.created_at < @to
                             AND EXISTS (SELECT 1 FROM orders o2 WHERE o2.customer_id = o.customer_id AND o2.created_at < @from)
                        THEN 1 ELSE 0 END), 0) AS repeat_customers,
           COALESCE(SUM(CASE WHEN o.created_at >= @from AND o.created_at < @to
                             AND o.status = 'delivered'
                             AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.customer_id = o.customer_id AND o2.created_at < @from)
                        THEN o.fee ELSE 0 END), 0) AS new_revenue,
           COALESCE(SUM(CASE WHEN o.created_at >= @from AND o.created_at < @to
                             AND o.status = 'delivered'
                             AND EXISTS (SELECT 1 FROM orders o2 WHERE o2.customer_id = o.customer_id AND o2.created_at < @from)
                        THEN o.fee ELSE 0 END), 0) AS repeat_revenue
         FROM orders o`,
      )
      .get({ from, to }) as { new_customers: number; repeat_customers: number; new_revenue: number; repeat_revenue: number }
    return row
  }

  quoteStats(from: string, to: string): QuoteStat {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS created,
           COALESCE(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted,
           COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected
         FROM quotes WHERE created_at >= ? AND created_at < ?`,
      )
      .get(from, to) as { created: number; accepted: number; rejected: number }
    const conversion_rate = row.created > 0 ? Math.round((row.accepted / row.created) * 100) : null
    return { created: row.created, accepted: row.accepted, rejected: row.rejected, conversion_rate }
  }

  /** ลูกค้าที่ให้มูลค่าสูงสุดในช่วง (ตามรายได้) */
  customerValue(from: string, to: string, limit: number): CustomerValuePoint[] {
    return this.db
      .prepare(
        `SELECT c.name, COUNT(o.id) AS orders, COALESCE(SUM(o.fee), 0) AS revenue
         FROM orders o JOIN customers c ON c.id = o.customer_id
         WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled'
         GROUP BY c.id ORDER BY revenue DESC LIMIT ?`,
      )
      .all(from, to, limit) as CustomerValuePoint[]
  }
}
