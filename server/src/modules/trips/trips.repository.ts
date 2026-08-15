import type Database from 'better-sqlite3'
import type { TripStatus } from '../../core/constants.js'

export interface TripRow {
  id: number
  trip_no: string
  vehicle_id: number
  vehicle_plate: string
  vehicle_type: string | null
  vehicle_capacity: number
  driver_id: number
  driver_name: string
  driver_phone: string | null
  status: TripStatus
  departed_at: string | null
  arrived_at: string | null
  fuel_cost: number
  toll_cost: number
  other_cost: number
  notes: string | null
  created_at: string
}

export interface TripInput {
  fuel_cost?: number
  toll_cost?: number
  other_cost?: number
  notes?: string | null
}

const BASE_SELECT = `
  SELECT t.*, v.plate_no AS vehicle_plate, v.vehicle_type AS vehicle_type, v.capacity_kg AS vehicle_capacity,
         d.name AS driver_name, d.phone AS driver_phone
  FROM trips t
  JOIN vehicles v ON v.id = t.vehicle_id
  JOIN drivers d ON d.id = t.driver_id
`

export class TripsRepository {
  constructor(private readonly db: Database.Database) {}

  list(status: TripStatus | undefined, limit: number, offset: number): { rows: TripRow[]; total: number } {
    const clause = status ? `WHERE t.status = ?` : ''
    const params = status ? [status] : []
    const total = this.db
      .prepare(`SELECT COUNT(*) AS c FROM trips t ${clause}`)
      .get(...params) as { c: number }
    const rows = this.db
      .prepare(`${BASE_SELECT} ${clause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as TripRow[]
    return { rows, total: total.c }
  }

  listByStatuses(statuses: TripStatus[]): TripRow[] {
    if (statuses.length === 0) return []
    const placeholders = statuses.map(() => '?').join(',')
    return this.db
      .prepare(`${BASE_SELECT} WHERE t.status IN (${placeholders}) ORDER BY t.created_at DESC`)
      .all(...statuses) as TripRow[]
  }

  findById(id: number): TripRow | undefined {
    return this.db.prepare(`${BASE_SELECT} WHERE t.id = ?`).get(id) as TripRow | undefined
  }

  countByYear(prefix: string, year: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM trips WHERE trip_no LIKE ?`)
      .get(`${prefix}-${year}-%`) as { c: number }
    return row.c
  }

  create(data: { vehicle_id: number; driver_id: number; notes?: string | null }, tripNo: string): TripRow {
    const info = this.db
      .prepare(`INSERT INTO trips (trip_no, vehicle_id, driver_id, notes) VALUES (@trip_no, @vehicle_id, @driver_id, @notes)`)
      .run({ ...data, notes: data.notes ?? null, trip_no: tripNo })
    return this.findById(Number(info.lastInsertRowid))!
  }

  update(id: number, data: TripInput): TripRow | undefined {
    this.db
      .prepare(
        `UPDATE trips
         SET fuel_cost = @fuel_cost, toll_cost = @toll_cost, other_cost = @other_cost, notes = @notes
         WHERE id = @id`,
      )
      .run({ id, ...data, fuel_cost: data.fuel_cost ?? 0, toll_cost: data.toll_cost ?? 0, other_cost: data.other_cost ?? 0, notes: data.notes ?? null })
    return this.findById(id)
  }

  setStatus(id: number, status: TripStatus, extra: Partial<TripRow> = {}): TripRow | undefined {
    const sets: string[] = ['status = @status']
    const params: Record<string, unknown> = { id, status }
    if ('departed_at' in extra) {
      sets.push('departed_at = @departed_at')
      params.departed_at = extra.departed_at
    }
    if ('arrived_at' in extra) {
      sets.push('arrived_at = @arrived_at')
      params.arrived_at = extra.arrived_at
    }
    this.db.prepare(`UPDATE trips SET ${sets.join(', ')} WHERE id = @id`).run(params)
    return this.findById(id)
  }

  /** รถ/คนขับกำลังทำงานในทริปที่ยังไม่จบหรือยังไม่ถูกยกเลิกหรือไม่ */
  hasActiveTrip(vehicleId: number, driverId: number): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM trips
         WHERE status IN ('planned','in_progress') AND (vehicle_id = @v OR driver_id = @d)`,
      )
      .get({ v: vehicleId, d: driverId }) as { c: number }
    return row.c > 0
  }

  sumWeightByTrip(tripId: number): number {
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(weight_kg), 0) AS s FROM orders WHERE trip_id = ? AND status != 'cancelled'`)
      .get(tripId) as { s: number }
    return row.s
  }

  delete(id: number): void {
    this.db.prepare(`DELETE FROM trips WHERE id = ?`).run(id)
  }
}
