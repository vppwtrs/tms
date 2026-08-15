import { err } from '../../core/errors.js'
import type { OrderStatus } from '../../core/constants.js'
import { buildPagination, generateDocNo, parseLimit, parsePage, type Pagination } from '../../utils/helpers.js'
import { OrdersRepository, type OrderInput, type OrderRow } from './orders.repository.js'
import type { SettingsRepository } from '../settings/settings.repository.js'

/**
 * กฎธุรกิจของออเดอร์:
 * - pending → assigned (ผ่านทริป) → in_transit (เริ่มทริป) → delivered (ทริปเสร็จ)
 * - ยกเลิกได้เฉพาะ pending / assigned; ถ้าทริปเริ่มแล้วจะบล็อก
 */
export class OrdersService {
  constructor(
    private readonly repo: OrdersRepository,
    private readonly settings?: SettingsRepository,
  ) {}

  list(query: Record<string, unknown>): { rows: OrderRow[]; pagination: Pagination } {
    const page = parsePage(query.page)
    const limit = parseLimit(query.limit)
    const filters = {
      q: String(query.q ?? '').trim(),
      status: query.status as OrderStatus | undefined,
      priority: query.priority as never,
      customer_id: query.customer_id ? Number(query.customer_id) : undefined,
      from: query.from ? String(query.from) : undefined,
      to: query.to ? String(query.to) : undefined,
      trip_id: query.trip_id ? Number(query.trip_id) : undefined,
      driver_id: query.driver_id ? Number(query.driver_id) : undefined,
    }
    const { rows, total } = this.repo.list(filters, limit, (page - 1) * limit)
    return { rows, pagination: buildPagination(total, page, limit) }
  }

  getById(id: number): OrderRow {
    const row = this.repo.findById(id)
    if (!row) throw err.notFound('ไม่พบออเดอร์นี้')
    return row
  }

  /** ข้อมูลสำหรับพิมพ์ใบนำส่ง (BOL) — ออเดอร์ + ลูกค้า + รถ/คนขับ + ชื่อองค์กรจากตั้งค่า */
  getBol(id: number): import('./orders.repository.js').BolRow & { org: { org_name: string; currency_symbol: string } } {
    const row = this.repo.getBol(id)
    if (!row) throw err.notFound('ไม่พบออเดอร์นี้')
    const s = this.settings?.getAll() ?? { org_name: 'บริษัท ขนส่ง จำกัด', currency_code: 'THB', currency_symbol: '฿' }
    return { ...row, org: { org_name: s.org_name, currency_symbol: s.currency_symbol } }
  }

  listPendingUnassigned(q: string): OrderRow[] {
    return this.repo.listPendingUnassigned(q)
  }

  create(data: OrderInput): OrderRow {
    const year = new Date().getFullYear()
    const seq = this.repo.countByYear('ORD', year) + 1
    return this.repo.create(data, generateDocNo('ORD', seq, year))
  }

  update(id: number, data: OrderInput): OrderRow {
    const order = this.getById(id)
    if (order.status === 'in_transit' || order.status === 'delivered') {
      throw err.invalidState('ไม่สามารถแก้ไขออเดอร์ที่กำลังขนส่งหรือส่งเสร็จแล้วได้')
    }
    const updated = this.repo.update(id, data)
    if (!updated) throw err.notFound('ไม่พบออเดอร์นี้')
    return updated
  }

  cancel(id: number): OrderRow {
    const order = this.getById(id)
    if (order.status === 'delivered' || order.status === 'cancelled' || order.status === 'in_transit') {
      throw err.invalidState('ยกเลิกได้เฉพาะออเดอร์ที่ยังไม่เริ่มขนส่ง (รอจัดคิว / จัดคิวแล้ว)')
    }
    // ถ้าอยู่ในทริปที่เริ่มเดินทางแล้ว → ห้ามยกเลิก
    if (order.trip_id && order.trip_status === 'in_progress') {
      throw err.invalidState('ออเดอร์นี้อยู่ระหว่างการขนส่ง ไม่สามารถยกเลิกได้')
    }
    // ถ้าอยู่ในทริปที่ยังไม่เริ่ม → ถอนออกจากทริปก่อน
    const extra: Partial<OrderRow> = order.trip_id ? { trip_id: null } : {}
    const updated = this.repo.setStatus(id, 'cancelled', extra)
    if (!updated) throw err.notFound('ไม่พบออเดอร์นี้')
    return updated
  }

}
