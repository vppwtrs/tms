import { ReportsRepository, type ReportKpis } from './reports.repository.js'
import { PodRepository } from '../pod/pod.repository.js'
import type { XlsxSheet } from '../../utils/xlsx.js'

export interface ReportsResult {
  from: string
  to: string
  kpis: ReportKpis
  by_status: { status: string; count: number }[]
  monthly: import('./reports.repository.js').MonthlyPoint[]
  top_customers: import('./reports.repository.js').CustomerStat[]
  driver_performance: import('./reports.repository.js').DriverStat[]
  lanes: import('./reports.repository.js').LaneStat[]
  crm: {
    at_risk: import('./reports.repository.js').AtRiskCustomer[]
    new_vs_repeat: { new_customers: number; repeat_customers: number; new_revenue: number; repeat_revenue: number }
    quotes: import('./reports.repository.js').QuoteStat
    customer_value: import('./reports.repository.js').CustomerValuePoint[]
  }
}

/** สรุปรายงานตามช่วงวันที่ — ทุกชุดคำนวณจากข้อมูลจริง */
export class ReportsService {
  constructor(
    private readonly repo: ReportsRepository,
    private readonly pod: PodRepository,
  ) {}

  generate(fromIso: string, toIso: string): ReportsResult {
    const to = new Date(toIso)
    to.setDate(to.getDate() + 1) // รวมทั้งวันสุดท้าย
    const toIsoExclusive = to.toISOString()

    const kpis = this.repo.kpis(fromIso, toIsoExclusive)
    // ความครบถ้วนของหลักฐาน POD — ต่อออเดอร์ที่ส่งสำเร็จในช่วงเวลา
    kpis.pod_collected = this.pod.countDeliveredInRange(fromIso, toIsoExclusive)
    kpis.pod_verified = this.pod.countDeliveredInRange(fromIso, toIsoExclusive, 'verified')

    return {
      from: fromIso,
      to: toIso,
      kpis,
      by_status: this.repo.statusBreakdown(fromIso, toIsoExclusive),
      monthly: this.repo.monthlySeries(),
      top_customers: this.repo.topCustomers(fromIso, toIsoExclusive, 8),
      driver_performance: this.repo.driverPerformance(fromIso, toIsoExclusive),
      lanes: this.repo.lanes(fromIso, toIsoExclusive, 8),
      crm: {
        at_risk: this.repo.atRiskCustomers(30, 8),
        new_vs_repeat: this.repo.newVsRepeat(fromIso, toIsoExclusive),
        quotes: this.repo.quoteStats(fromIso, toIsoExclusive),
        customer_value: this.repo.customerValue(fromIso, toIsoExclusive, 8),
      },
    }
  }

  /** ข้อมูลสำหรับส่งออก Excel — ชีตแต่ละชุดใช้ตัวเลขจริง (คำนวณต่อใน Excel ได้) */
  exportData(fromIso: string, toIso: string): XlsxSheet[] {
    const r = this.generate(fromIso, toIso)
    const kpis: XlsxSheet = {
      name: 'สรุปภาพรวม',
      rows: [
        ['ตัวชี้วัด', 'ค่า'],
        ['ออเดอร์ทั้งหมด', r.kpis.total_orders],
        ['ส่งสำเร็จ', r.kpis.delivered],
        ['ตรงเวลา', r.kpis.on_time],
        ['ยกเลิก', r.kpis.cancelled],
        ['รายได้', r.kpis.revenue],
        ['ค่าใช้จ่าย', r.kpis.costs],
        ['กำไรสุทธิ', r.kpis.profit],
        ['เวลาส่งเฉลี่ย (ชม.)', r.kpis.avg_delivery_hours],
        ['POD ที่เก็บ', r.kpis.pod_collected],
        ['POD ยืนยันแล้ว', r.kpis.pod_verified],
      ],
    }
    const monthly: XlsxSheet = {
      name: 'ออเดอร์รายเดือน',
      rows: [
        ['เดือน', 'ออเดอร์', 'รายได้'],
        ...r.monthly.map((m) => [m.month, m.count, m.revenue]),
      ],
    }
    const status: XlsxSheet = {
      name: 'สถานะออเดอร์',
      rows: [['สถานะ', 'จำนวน'], ...r.by_status.map((s) => [s.status, s.count])],
    }
    const topCustomers: XlsxSheet = {
      name: 'ลูกค้าอันดับสูงสุด',
      rows: [['ลูกค้า', 'ออเดอร์', 'รายได้'], ...r.top_customers.map((c) => [c.name, c.orders, c.revenue])],
    }
    const drivers: XlsxSheet = {
      name: 'พนักงานขับ',
      rows: [
        ['พนักงานขับ', 'เที่ยว', 'ออเดอร์', 'ตรงเวลา', 'รายได้', 'ค่าใช้จ่าย'],
        ...r.driver_performance.map((d) => [d.name, d.trips, d.orders, d.on_time, d.revenue, d.costs]),
      ],
    }
    const lanes: XlsxSheet = {
      name: 'เส้นทางยอดนิยม',
      rows: [['เส้นทาง', 'ออเดอร์', 'รายได้'], ...r.lanes.map((l) => [`${l.origin} → ${l.destination}`, l.orders, l.revenue])],
    }
    const atRisk: XlsxSheet = {
      name: 'CRM-ลูกค้าเสี่ยง',
      rows: [
        ['ลูกค้า', 'กลุ่ม', 'เงียบ (วัน)', 'รายได้รวม'],
        ...r.crm.at_risk.map((c) => [c.name, c.segment ?? '', c.days_since, c.total_revenue]),
      ],
    }
    const newVsRepeat: XlsxSheet = {
      name: 'CRM-ลูกค้าใหม่/ซ้ำ',
      rows: [
        ['ลูกค้าใหม่', r.crm.new_vs_repeat.new_customers, `รายได้ ${r.crm.new_vs_repeat.new_revenue}`],
        ['ลูกค้าซ้ำ', r.crm.new_vs_repeat.repeat_customers, `รายได้ ${r.crm.new_vs_repeat.repeat_revenue}`],
        ['ใบเสนอราคา', r.crm.quotes.created, ''],
        ['ยอมรับ', r.crm.quotes.accepted, ''],
        ['ปฏิเสธ', r.crm.quotes.rejected, ''],
        ['อัตราแปลง (%)', r.crm.quotes.conversion_rate, ''],
      ],
    }
    const value: XlsxSheet = {
      name: 'CRM-มูลค่าลูกค้า',
      rows: [['ลูกค้า', 'ออเดอร์', 'รายได้'], ...r.crm.customer_value.map((c) => [c.name, c.orders, c.revenue])],
    }
    return [kpis, monthly, status, topCustomers, drivers, lanes, atRisk, newVsRepeat, value]
  }
}
