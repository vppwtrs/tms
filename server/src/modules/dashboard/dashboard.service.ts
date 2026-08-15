import { startOfDay, daysAgo } from '../../utils/helpers.js'
import { DashboardRepository, type DayPoint } from './dashboard.repository.js'

export interface DashboardSummary {
  kpis: {
    orders_today: number
    in_transit: number
    delivered_month: number
    revenue_month: number
    pending: number
    urgent_unassigned: number
    overdue: number
  }
  trend: DayPoint[]
  orders_by_status: { status: string; count: number }[]
  vehicles_by_status: { status: string; count: number }[]
  drivers_by_status: { status: string; count: number }[]
  alerts: {
    urgent_unassigned: { id: number; order_no: string; destination: string; scheduled_at: string }[]
    overdue: { id: number; order_no: string; destination: string; scheduled_at: string }[]
  }
  recent_orders: { id: number; order_no: string; destination: string; status: string; created_at: string }[]
}

/** รวมข้อมูลภาพรวมทั้งหมดสำหรับหน้า Dashboard — คำนวณจากข้อมูลจริง ไม่มีตัวเลขลอย */
export class DashboardService {
  constructor(private readonly repo: DashboardRepository) {}

  summary(): DashboardSummary {
    const now = new Date()
    const todayStart = startOfDay(now).toISOString()
    const tomorrow = new Date(startOfDay(now))
    tomorrow.setDate(tomorrow.getDate() + 1)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const trendFrom = daysAgo(29).toISOString()

    const pending = this.repo.pendingCounts()
    const month = this.repo.deliveredInRange(monthStart, tomorrow.toISOString())

    return {
      kpis: {
        orders_today: this.repo.countScheduledToday(todayStart, tomorrow.toISOString()),
        in_transit: this.repo.countInTransit(),
        delivered_month: month.count,
        revenue_month: month.revenue,
        pending: pending.pending,
        urgent_unassigned: pending.urgent_unassigned,
        overdue: pending.overdue,
      },
      trend: this.repo.trend(trendFrom),
      orders_by_status: this.repo.ordersByStatus(),
      vehicles_by_status: this.repo.vehiclesByStatus(),
      drivers_by_status: this.repo.driversByStatus(),
      alerts: this.repo.alerts(),
      recent_orders: this.repo.recentOrders(8),
    }
  }
}
