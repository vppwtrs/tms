import { err } from '../../core/errors.js'
import type { CustomerSegment } from '../../core/constants.js'
import { buildPagination, parseLimit, parsePage, type Pagination } from '../../utils/helpers.js'
import {
  CustomersRepository,
  type CustomerDetailRow,
  type CustomerInput,
  type CustomerRow,
  type CustomerTaskInput,
  type InteractionInput,
} from './customers.repository.js'

/** กฎธุรกิจของลูกค้า + CRM — การลบถูกบล็อกถ้ายังมีออเดอร์อ้างอิง */
export class CustomersService {
  constructor(private readonly repo: CustomersRepository) {}

  list(query: { q?: string; segment?: string; page?: unknown; limit?: unknown }): { rows: CustomerRow[]; pagination: Pagination } {
    const q = (query.q ?? '').trim()
    const segment = (query.segment as CustomerSegment | undefined) || undefined
    const page = parsePage(query.page)
    const limit = parseLimit(query.limit)
    const { rows, total } = this.repo.list(q, segment, limit, (page - 1) * limit)
    return { rows, pagination: buildPagination(total, page, limit) }
  }

  listAll(): CustomerRow[] {
    return this.repo.findAll()
  }

  getById(id: number): CustomerRow {
    const row = this.repo.findById(id)
    if (!row) throw err.notFound('ไม่พบลูกค้านี้')
    return row
  }

  getDetail(id: number): CustomerDetailRow {
    const row = this.repo.findDetail(id)
    if (!row) throw err.notFound('ไม่พบลูกค้านี้')
    return row
  }

  create(data: CustomerInput): CustomerRow {
    return this.repo.create(data)
  }

  update(id: number, data: CustomerInput): CustomerRow {
    this.getById(id)
    const updated = this.repo.update(id, data)
    if (!updated) throw err.notFound('ไม่พบลูกค้านี้')
    return updated
  }

  remove(id: number): void {
    this.getById(id)
    const count = this.repo.orderCount(id)
    if (count > 0) {
      throw err.conflict(`ไม่สามารถลบได้ — ลูกค้านี้มีออเดอร์ ${count} รายการในระบบ`)
    }
    this.repo.delete(id)
  }

  /* ===== CRM: การติดต่อ ===== */

  createInteraction(customerId: number, data: InteractionInput, createdBy: number | null) {
    this.getById(customerId)
    return this.repo.createInteraction(customerId, data, createdBy)
  }

  listInteractions(customerId: number) {
    this.getById(customerId)
    return this.repo.listInteractions(customerId)
  }

  removeInteraction(customerId: number, interactionId: number): void {
    this.getById(customerId)
    this.repo.removeInteraction(interactionId)
  }

  /* ===== CRM: งานติดตาม ===== */

  createTask(customerId: number, data: CustomerTaskInput, createdBy: number | null) {
    this.getById(customerId)
    return this.repo.createTask(customerId, data, createdBy)
  }

  listTasks(customerId: number) {
    this.getById(customerId)
    return this.repo.listTasks(customerId)
  }

  setTaskStatus(customerId: number, taskId: number, status: 'pending' | 'done') {
    this.getById(customerId)
    const updated = this.repo.setTaskStatus(taskId, status)
    if (!updated) throw err.notFound('ไม่พบงานติดตามนี้')
    return updated
  }

  removeTask(customerId: number, taskId: number): void {
    this.getById(customerId)
    this.repo.removeTask(taskId)
  }
}
