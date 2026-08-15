import type Database from 'better-sqlite3'
import { err } from '../../core/errors.js'
import type { QuoteStatus } from '../../core/constants.js'
import { buildPagination, generateDocNo, parseLimit, parsePage, type Pagination } from '../../utils/helpers.js'
import { QuotesRepository, type QuoteInput, type QuoteRow } from './quotes.repository.js'
import { OrdersRepository, type OrderInput } from '../orders/orders.repository.js'

/** สถานะที่แปลงเป็นออเดอร์ได้ */
const CONVERTIBLE = new Set<QuoteStatus>(['sent', 'accepted'])

/**
 * กฎธุรกิจของใบเสนอราคา (CRM):
 * - สถานะ: ร่าง → ส่งแล้ว → ตกลงราคา / ปัดตก / หมดอายุ (เปลี่ยนย้อนกลับได้ก่อนตกลง)
 * - แปลงเป็นออเดอร์ได้เฉพาะที่ "ส่งแล้ว/ตกลงราคา" และยังไม่เคยแปลง (1 quote = 1 ออเดอร์)
 * - การแปลงใช้ transaction เดียว: สร้างออเดอร์ + ล็อก quote เป็น accepted + ผูก converted_order_id
 */
export class QuotesService {
  private readonly ordersRepo: OrdersRepository

  constructor(private readonly repo: QuotesRepository, private readonly db: Database.Database) {
    this.ordersRepo = new OrdersRepository(db)
  }

  list(query: Record<string, unknown>): { rows: QuoteRow[]; pagination: Pagination } {
    const q = String(query.q ?? '').trim()
    const status = query.status as QuoteStatus | undefined
    const page = parsePage(query.page)
    const limit = parseLimit(query.limit)
    const { rows, total } = this.repo.list(q, status, limit, (page - 1) * limit)
    return { rows, pagination: buildPagination(total, page, limit) }
  }

  listByCustomer(customerId: number): QuoteRow[] {
    return this.repo.listByCustomer(customerId)
  }

  getById(id: number): QuoteRow {
    const row = this.repo.findById(id)
    if (!row) throw err.notFound('ไม่พบใบเสนอราคานี้')
    return row
  }

  create(data: QuoteInput, createdBy: number | null): QuoteRow {
    const year = new Date().getFullYear()
    const seq = this.repo.countByYear('QOT', year) + 1
    return this.repo.create(data, generateDocNo('QOT', seq, year), createdBy)
  }

  update(id: number, data: QuoteInput): QuoteRow {
    const quote = this.getById(id)
    if (quote.status !== 'draft' && quote.status !== 'sent') {
      throw err.invalidState('แก้ไขได้เฉพาะใบเสนอราคาที่เป็นร่างหรือส่งแล้วเท่านั้น')
    }
    const updated = this.repo.update(id, data)
    if (!updated) throw err.notFound('ไม่พบใบเสนอราคานี้')
    return updated
  }

  /** เปลี่ยนสถานะ: ร่าง ↔ ส่งแล้ว → ตกลงราคา / ปัดตก / หมดอายุ */
  setStatus(id: number, status: QuoteStatus): QuoteRow {
    const quote = this.getById(id)
    if (quote.converted_order_id) {
      throw err.invalidState('ใบเสนอราคานี้แปลงเป็นออเดอร์แล้ว ไม่สามารถเปลี่ยนสถานะได้')
    }
    if (quote.status === status) return quote
    const updated = this.repo.setStatus(id, status)
    if (!updated) throw err.notFound('ไม่พบใบเสนอราคานี้')
    return updated
  }

  /** แปลงใบเสนอราคาเป็นออเดอร์ขนส่ง (transaction เดียว) */
  convertToOrder(id: number, scheduledAt: string, notes?: string | null): { quote: QuoteRow; order_no: string } {
    const quote = this.getById(id)
    if (!CONVERTIBLE.has(quote.status)) {
      throw err.invalidState('แปลงเป็นออเดอร์ได้เฉพาะใบเสนอราคาที่ส่งแล้วหรือตกลงราคาเท่านั้น')
    }
    if (quote.converted_order_id) {
      throw err.conflict('ใบเสนอราคานี้แปลงเป็นออเดอร์ไปแล้ว')
    }
    if (!scheduledAt) {
      throw err.badRequest('ระบุกำหนดส่ง (scheduled_at) ก่อนแปลงเป็นออเดอร์')
    }

    const year = new Date().getFullYear()
    const seq = this.ordersRepo.countByYear('ORD', year) + 1
    const orderNo = generateDocNo('ORD', seq, year)

    const input: OrderInput = {
      customer_id: quote.customer_id,
      origin: quote.origin,
      destination: quote.destination,
      distance_km: quote.distance_km,
      goods_desc: quote.goods_desc,
      weight_kg: quote.weight_kg,
      fee: quote.fee,
      priority: 'normal',
      scheduled_at: scheduledAt,
      notes: notes || `จากใบเสนอราคา ${quote.quote_no}`,
    }

    const result = this.db.transaction(() => {
      const order = this.ordersRepo.create(input, orderNo)
      this.repo.markConverted(id, order.id)
      return order
    })()

    const updatedQuote = this.repo.findById(id)!
    return { quote: updatedQuote, order_no: result.order_no }
  }
}
