import type Database from 'better-sqlite3'

export interface DayPoint {
  d: string
  count: number
  revenue: number
}

/** SQL aggregation ทั้งหมดของหน้า Dashboard */
export class DashboardRepository {
  constructor(private readonly db: Database.Database) {}

  countScheduledToday(from: string, to: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE scheduled_at >= ? AND scheduled_at < ? AND status != 'cancelled'`)
      .get(from, to) as { c: number }
    return row.c
  }

  countInTransit(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status = 'in_transit'`).get() as { c: number }
    return row.c
  }

  deliveredInRange(from: string, to: string): { count: number; revenue: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(fee), 0) AS s FROM orders WHERE status = 'delivered' AND delivered_at >= ? AND delivered_at < ?`,
      )
      .get(from, to) as { c: number; s: number }
    return { count: row.c, revenue: row.s }
  }

  pendingCounts(): { pending: number; urgent_unassigned: number; overdue: number } {
    const pending = this.db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'`).get() as { c: number }
    const urgent = this.db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending','assigned') AND priority = 'urgent'`)
      .get() as { c: number }
    const overdue = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending','assigned') AND scheduled_at < ?`,
      )
      .get(new Date().toISOString()) as { c: number }
    return { pending: pending.c, urgent_unassigned: urgent.c, overdue: overdue.c }
  }

  /** 30 วันล่าสุด: จำนวน + รายได้ของออเดอร์ที่ส่งสำเร็จต่อวัน */
  trend(from: string): DayPoint[] {
    return this.db
      .prepare(
        `SELECT date(delivered_at) AS d, COUNT(*) AS count, COALESCE(SUM(fee), 0) AS revenue
         FROM orders WHERE status = 'delivered' AND delivered_at >= ?
         GROUP BY d ORDER BY d`,
      )
      .all(from) as DayPoint[]
  }

  ordersByStatus(): { status: string; count: number }[] {
    return this.db.prepare(`SELECT status, COUNT(*) AS count FROM orders GROUP BY status`).all() as {
      status: string
      count: number
    }[]
  }

  vehiclesByStatus(): { status: string; count: number }[] {
    return this.db.prepare(`SELECT status, COUNT(*) AS count FROM vehicles GROUP BY status`).all() as {
      status: string
      count: number
    }[]
  }

  driversByStatus(): { status: string; count: number }[] {
    return this.db.prepare(`SELECT status, COUNT(*) AS count FROM drivers GROUP BY status`).all() as {
      status: string
      count: number
    }[]
  }

  alerts(): {
    urgent_unassigned: { id: number; order_no: string; destination: string; scheduled_at: string }[]
    overdue: { id: number; order_no: string; destination: string; scheduled_at: string }[]
  } {
    const urgent = this.db
      .prepare(
        `SELECT id, order_no, destination, scheduled_at FROM orders
         WHERE status IN ('pending','assigned') AND priority = 'urgent'
         ORDER BY scheduled_at ASC LIMIT 8`,
      )
      .all() as { id: number; order_no: string; destination: string; scheduled_at: string }[]
    const overdue = this.db
      .prepare(
        `SELECT id, order_no, destination, scheduled_at FROM orders
         WHERE status IN ('pending','assigned') AND scheduled_at < ?
         ORDER BY scheduled_at ASC LIMIT 8`,
      )
      .all(new Date().toISOString()) as { id: number; order_no: string; destination: string; scheduled_at: string }[]
    return { urgent_unassigned: urgent, overdue }
  }

  recentOrders(limit: number): { id: number; order_no: string; destination: string; status: string; created_at: string }[] {
    return this.db
      .prepare(
        `SELECT id, order_no, destination, status, created_at FROM orders ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(limit) as { id: number; order_no: string; destination: string; status: string; created_at: string }[]
  }
}
