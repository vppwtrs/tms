import type Database from 'better-sqlite3'
import type { VehicleStatus, VehicleType } from '../../core/constants.js'

export interface VehicleRow {
  id: number
  plate_no: string
  brand: string | null
  model: string | null
  vehicle_type: VehicleType
  capacity_kg: number
  status: VehicleStatus
  created_at: string
}

export interface VehicleInput {
  plate_no: string
  brand?: string | null
  model?: string | null
  vehicle_type: VehicleType
  capacity_kg: number
}

export interface VehicleFilters {
  q: string
  status?: VehicleStatus
  type?: VehicleType
}

export class VehiclesRepository {
  constructor(private readonly db: Database.Database) {}

  list(f: VehicleFilters, limit: number, offset: number): { rows: VehicleRow[]; total: number } {
    const where: string[] = []
    const params: unknown[] = []
    if (f.q) {
      where.push('(plate_no LIKE ? OR brand LIKE ? OR model LIKE ?)')
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`)
    }
    if (f.status) {
      where.push('status = ?')
      params.push(f.status)
    }
    if (f.type) {
      where.push('vehicle_type = ?')
      params.push(f.type)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = this.db.prepare(`SELECT COUNT(*) AS c FROM vehicles ${clause}`).get(...params) as { c: number }
    const rows = this.db
      .prepare(`SELECT * FROM vehicles ${clause} ORDER BY status, plate_no LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as VehicleRow[]
    return { rows, total: total.c }
  }

  findAvailable(): VehicleRow[] {
    return this.db
      .prepare(`SELECT * FROM vehicles WHERE status = 'available' ORDER BY plate_no`)
      .all() as VehicleRow[]
  }

  findById(id: number): VehicleRow | undefined {
    return this.db.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(id) as VehicleRow | undefined
  }

  create(data: VehicleInput): VehicleRow {
    const info = this.db
      .prepare(
        `INSERT INTO vehicles (plate_no, brand, model, vehicle_type, capacity_kg)
         VALUES (@plate_no, @brand, @model, @vehicle_type, @capacity_kg)`,
      )
      .run({ ...data, brand: data.brand ?? null, model: data.model ?? null })
    return this.findById(Number(info.lastInsertRowid))!
  }

  update(id: number, data: VehicleInput): VehicleRow | undefined {
    this.db
      .prepare(
        `UPDATE vehicles
         SET plate_no = @plate_no, brand = @brand, model = @model, vehicle_type = @vehicle_type, capacity_kg = @capacity_kg
         WHERE id = @id`,
      )
      .run({ id, ...data, brand: data.brand ?? null, model: data.model ?? null })
    return this.findById(id)
  }

  setStatus(id: number, status: VehicleStatus): VehicleRow | undefined {
    this.db.prepare(`UPDATE vehicles SET status = ? WHERE id = ?`).run(status, id)
    return this.findById(id)
  }

  tripCount(id: number): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM trips WHERE vehicle_id = ?`).get(id) as { c: number }
    return row.c
  }

  delete(id: number): void {
    this.db.prepare(`DELETE FROM vehicles WHERE id = ?`).run(id)
  }
}
