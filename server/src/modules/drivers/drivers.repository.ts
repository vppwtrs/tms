import type Database from 'better-sqlite3'
import type { DriverStatus } from '../../core/constants.js'

export interface DriverRow {
  id: number
  name: string
  phone: string | null
  license_no: string | null
  license_type: string | null
  status: DriverStatus
  joined_at: string | null
  /** บัญชีผู้ใช้ที่ผูกไว้ — คนขับเห็น "งานของฉัน" ได้ก็ต่อเมื่อช่องนี้ไม่ว่าง */
  user_id: number | null
  created_at: string
}

export interface DriverInput {
  name: string
  phone?: string | null
  license_no?: string | null
  license_type?: string | null
  joined_at?: string | null
  user_id?: number | null
}

export class DriversRepository {
  constructor(private readonly db: Database.Database) {}

  list(q: string, status: DriverStatus | undefined, limit: number, offset: number): {
    rows: DriverRow[]
    total: number
  } {
    const where: string[] = []
    const params: unknown[] = []
    if (q) {
      where.push('(name LIKE ? OR phone LIKE ? OR license_no LIKE ?)')
      params.push(`%${q}%`, `%${q}%`, `%${q}%`)
    }
    if (status) {
      where.push('status = ?')
      params.push(status)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = this.db.prepare(`SELECT COUNT(*) AS c FROM drivers ${clause}`).get(...params) as { c: number }
    const rows = this.db
      .prepare(`SELECT * FROM drivers ${clause} ORDER BY status, name COLLATE NOCASE LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as DriverRow[]
    return { rows, total: total.c }
  }

  findAvailable(): DriverRow[] {
    return this.db.prepare(`SELECT * FROM drivers WHERE status = 'available' ORDER BY name`).all() as DriverRow[]
  }

  findById(id: number): DriverRow | undefined {
    return this.db.prepare(`SELECT * FROM drivers WHERE id = ?`).get(id) as DriverRow | undefined
  }

  create(data: DriverInput): DriverRow {
    const info = this.db
      .prepare(
        `INSERT INTO drivers (name, phone, license_no, license_type, joined_at, user_id)
         VALUES (@name, @phone, @license_no, @license_type, @joined_at, @user_id)`,
      )
      .run({
        ...data,
        phone: data.phone ?? null,
        license_no: data.license_no ?? null,
        license_type: data.license_type ?? null,
        joined_at: data.joined_at ?? null,
        user_id: data.user_id ?? null,
      })
    return this.findById(Number(info.lastInsertRowid))!
  }

  update(id: number, data: DriverInput): DriverRow | undefined {
    this.db
      .prepare(
        `UPDATE drivers
         SET name = @name, phone = @phone, license_no = @license_no, license_type = @license_type,
             joined_at = @joined_at, user_id = @user_id
         WHERE id = @id`,
      )
      .run({
        id,
        ...data,
        phone: data.phone ?? null,
        license_no: data.license_no ?? null,
        license_type: data.license_type ?? null,
        joined_at: data.joined_at ?? null,
        user_id: data.user_id ?? null,
      })
    return this.findById(id)
  }

  setStatus(id: number, status: DriverStatus): DriverRow | undefined {
    this.db.prepare(`UPDATE drivers SET status = ? WHERE id = ?`).run(status, id)
    return this.findById(id)
  }

  tripCount(id: number): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM trips WHERE driver_id = ?`).get(id) as { c: number }
    return row.c
  }

  delete(id: number): void {
    this.db.prepare(`DELETE FROM drivers WHERE id = ?`).run(id)
  }
}
