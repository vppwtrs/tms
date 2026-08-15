import { err } from '../../core/errors.js'
import type { DriverStatus } from '../../core/constants.js'
import { buildPagination, parseLimit, parsePage, type Pagination } from '../../utils/helpers.js'
import { DriversRepository, type DriverInput, type DriverRow } from './drivers.repository.js'

export class DriversService {
  constructor(private readonly repo: DriversRepository) {}

  list(query: { q?: string; status?: DriverStatus; page?: unknown; limit?: unknown }): {
    rows: DriverRow[]
    pagination: Pagination
  } {
    const page = parsePage(query.page)
    const limit = parseLimit(query.limit)
    const { rows, total } = this.repo.list((query.q ?? '').trim(), query.status, limit, (page - 1) * limit)
    return { rows, pagination: buildPagination(total, page, limit) }
  }

  listAvailable(): DriverRow[] {
    return this.repo.findAvailable()
  }

  getById(id: number): DriverRow {
    const row = this.repo.findById(id)
    if (!row) throw err.notFound('ไม่พบพนักงานขับนี้')
    return row
  }

  create(data: DriverInput): DriverRow {
    return this.repo.create(data)
  }

  update(id: number, data: DriverInput): DriverRow {
    this.getById(id)
    const updated = this.repo.update(id, data)
    if (!updated) throw err.notFound('ไม่พบพนักงานขับนี้')
    return updated
  }

  setStatus(id: number, status: DriverStatus): DriverRow {
    this.getById(id)
    if (status === 'on_trip') {
      throw err.invalidState('สถานะ "กำลังขนส่ง" ถูกกำหนดโดยระบบผ่านเที่ยวขนส่งเท่านั้น')
    }
    const updated = this.repo.setStatus(id, status)
    if (!updated) throw err.notFound('ไม่พบพนักงานขับนี้')
    return updated
  }

  remove(id: number): void {
    const driver = this.getById(id)
    if (driver.status === 'on_trip') {
      throw err.invalidState('พนักงานขับกำลังขนส่งอยู่ ไม่สามารถลบได้')
    }
    const count = this.repo.tripCount(id)
    if (count > 0) {
      throw err.conflict('ไม่สามารถลบได้ — พนักงานขับนี้มีประวัติเที่ยวขนส่งในระบบ ให้เปลี่ยนสถานะเป็น "หยุดงาน" แทน')
    }
    this.repo.delete(id)
  }
}
