import type Database from 'better-sqlite3'

export type PodStatus = 'collected' | 'verified'

export interface PodRow {
  id: number
  order_id: number
  recipient_name: string
  signature_data: string
  photo_path: string | null
  notes: string | null
  status: PodStatus
  lat: number | null
  lng: number | null
  collected_by: number
  collected_by_name: string
  collected_at: string
  updated_at: string
}

export interface PodInput {
  recipient_name: string
  signature_data?: string
  notes?: string | null
  lat?: number | null
  lng?: number | null
  photo_path?: string | null
}

const BASE_SELECT = `
  SELECT p.*, u.name AS collected_by_name
  FROM pod p
  JOIN users u ON u.id = p.collected_by
`

/** ชั้น data access ของ POD — SQL เท่านั้น */
export class PodRepository {
  constructor(private readonly db: Database.Database) {}

  findByOrderId(orderId: number): PodRow | undefined {
    return this.db.prepare(`${BASE_SELECT} WHERE p.order_id = ?`).get(orderId) as PodRow | undefined
  }

  findById(id: number): PodRow | undefined {
    return this.db.prepare(`${BASE_SELECT} WHERE p.id = ?`).get(id) as PodRow | undefined
  }

  create(data: {
    order_id: number
    recipient_name: string
    signature_data: string
    notes?: string | null
    lat?: number | null
    lng?: number | null
    photo_path?: string | null
    collected_by: number
    collected_at: string
  }): PodRow {
    const info = this.db
      .prepare(
        `INSERT INTO pod (order_id, recipient_name, signature_data, photo_path, notes, lat, lng, collected_by, collected_at)
         VALUES (@order_id, @recipient_name, @signature_data, @photo_path, @notes, @lat, @lng, @collected_by, @collected_at)`,
      )
      .run({
        ...data,
        photo_path: data.photo_path ?? null,
        notes: data.notes ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
      })
    return this.findById(Number(info.lastInsertRowid))!
  }

  update(id: number, data: PodInput): PodRow | undefined {
    const sets: string[] = ['recipient_name = @recipient_name', "updated_at = datetime('now')"]
    const params: Record<string, unknown> = { id, recipient_name: data.recipient_name }
    if (data.signature_data !== undefined) {
      sets.push('signature_data = @signature_data')
      params.signature_data = data.signature_data
    }
    if (data.photo_path !== undefined) {
      sets.push('photo_path = @photo_path')
      params.photo_path = data.photo_path
    }
    if (data.notes !== undefined) {
      sets.push('notes = @notes')
      params.notes = data.notes
    }
    if (data.lat !== undefined) {
      sets.push('lat = @lat')
      params.lat = data.lat
    }
    if (data.lng !== undefined) {
      sets.push('lng = @lng')
      params.lng = data.lng
    }
    this.db.prepare(`UPDATE pod SET ${sets.join(', ')} WHERE id = @id`).run(params)
    return this.findById(id)
  }

  setStatus(id: number, status: PodStatus): PodRow | undefined {
    this.db.prepare(`UPDATE pod SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id)
    return this.findById(id)
  }

  /** ข้อมูล POD ของออเดอร์ที่ส่งสำเร็จในช่วงเวลา (สำหรับรายงาน) */
  countDeliveredInRange(from: string, to: string, status?: PodStatus): number {
    const clause = status ? 'AND p.status = ?' : ''
    const params: unknown[] = [from, to]
    if (status) params.push(status)
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM pod p
         JOIN orders o ON o.id = p.order_id
         WHERE o.status = 'delivered' AND o.delivered_at >= ? AND o.delivered_at < ? ${clause}`,
      )
      .get(...params) as { c: number }
    return row.c
  }
}
