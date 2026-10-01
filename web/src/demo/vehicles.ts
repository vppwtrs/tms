/**
 * แทน api/vehicles เฉพาะรายชื่อคนขับ (ตัวกรองหน้าออเดอร์)
 * ที่ไม่ได้แทน re-export ของจริง (พาธ './../' กัน alias วน)
 */
import type { DriverRow } from '../types/database.js'
import type { Paged } from './customers.js'
import type { DriverFilter } from './../api/vehicles.js'

export * from './../api/vehicles.js'

const d = (id: number, name: string): DriverRow => ({
  id,
  name,
  phone: `02-000-010${id}`,
  license_no: null,
  license_type: null,
  status: 'available',
  joined_at: null,
  user_id: null,
  created_at: '2026-01-01T00:00:00Z',
})

export const DEMO_DRIVERS: DriverRow[] = [
  d(1, 'คนขับ (สาธิต)'),
  d(2, 'คนขับสมมติ สอง'),
  d(3, 'คนขับสมมติ สาม'),
]

export async function listDrivers(f: DriverFilter = {}): Promise<Paged<DriverRow>> {
  const page = f.page ?? 1
  const limit = f.limit ?? 20
  return { rows: DEMO_DRIVERS.slice((page - 1) * limit, page * limit), total: DEMO_DRIVERS.length, page, limit }
}
