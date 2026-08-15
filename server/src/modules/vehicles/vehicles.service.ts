import { err } from '../../core/errors.js'
import type { VehicleStatus } from '../../core/constants.js'
import { buildPagination, parseLimit, parsePage, type Pagination } from '../../utils/helpers.js'
import { VehiclesRepository, type VehicleInput, type VehicleRow } from './vehicles.repository.js'

/** กฎธุรกิจของรถ — สถานะ on_trip ถูกควบคุมโดยทริปเท่านั้น */
export class VehiclesService {
  constructor(private readonly repo: VehiclesRepository) {}

  list(query: { q?: string; status?: VehicleStatus; type?: string; page?: unknown; limit?: unknown }): {
    rows: VehicleRow[]
    pagination: Pagination
  } {
    const page = parsePage(query.page)
    const limit = parseLimit(query.limit)
    const { rows, total } = this.repo.list(
      { q: (query.q ?? '').trim(), status: query.status, type: query.type as never },
      limit,
      (page - 1) * limit,
    )
    return { rows, pagination: buildPagination(total, page, limit) }
  }

  listAvailable(): VehicleRow[] {
    return this.repo.findAvailable()
  }

  getById(id: number): VehicleRow {
    const row = this.repo.findById(id)
    if (!row) throw err.notFound('ไม่พบรถคันนี้')
    return row
  }

  create(data: VehicleInput): VehicleRow {
    return this.repo.create(data)
  }

  update(id: number, data: VehicleInput): VehicleRow {
    this.getById(id)
    const updated = this.repo.update(id, data)
    if (!updated) throw err.notFound('ไม่พบรถคันนี้')
    return updated
  }

  /** เปลี่ยนสถานะด้วยมือ (ซ่อมบำรุง/ว่าง/ไม่ใช้งาน) — on_trip ต้องผ่านทริปเท่านั้น */
  setStatus(id: number, status: VehicleStatus): VehicleRow {
    this.getById(id)
    if (status === 'on_trip') {
      throw err.invalidState('สถานะ "กำลังขนส่ง" ถูกกำหนดโดยระบบผ่านเที่ยวขนส่งเท่านั้น')
    }
    const updated = this.repo.setStatus(id, status)
    if (!updated) throw err.notFound('ไม่พบรถคันนี้')
    return updated
  }

  remove(id: number): void {
    const vehicle = this.getById(id)
    if (vehicle.status === 'on_trip') {
      throw err.invalidState('รถกำลังขนส่งอยู่ ไม่สามารถลบได้')
    }
    const count = this.repo.tripCount(id)
    if (count > 0) {
      throw err.conflict('ไม่สามารถลบได้ — รถคันนี้มีประวัติเที่ยวขนส่งในระบบ ให้เปลี่ยนสถานะเป็น "ไม่ใช้งาน" แทน')
    }
    this.repo.delete(id)
  }
}
