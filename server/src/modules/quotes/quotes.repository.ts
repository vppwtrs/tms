import type Database from 'better-sqlite3'
import type { QuoteStatus } from '../../core/constants.js'

export interface QuoteRow {
  id: number
  quote_no: string
  customer_id: number | null
  customer_name: string | null
  origin: string
  destination: string
  distance_km: number
  goods_desc: string
  weight_kg: number
  fee: number
  status: QuoteStatus
  valid_until: string | null
  notes: string | null
  created_by: number | null
  created_by_name: string | null
  converted_order_id: number | null
  converted_order_no: string | null
  created_at: string
  updated_at: string
}

export interface QuoteInput {
  customer_id?: number | null
  origin: string
  destination: string
  distance_km: number
  goods_desc: string
  weight_kg: number
  fee: number
  status?: QuoteStatus
  valid_until?: string | null
  notes?: string | null
}

const BASE_SELECT = `
  SELECT q.*, c.name AS customer_name, u.name AS created_by_name, o.order_no AS converted_order_no
  FROM quotes q
  LEFT JOIN customers c ON c.id = q.customer_id
  LEFT JOIN users u ON u.id = q.created_by
  LEFT JOIN orders o ON o.id = q.converted_order_id
`

/** ชั้น data access ของใบเสนอราคา (CRM) */
export class QuotesRepository {
  constructor(private readonly db: Database.Database) {}

  list(q: string, status: QuoteStatus | undefined, limit: number, offset: number): { rows: QuoteRow[]; total: number } {
    const where: string[] = []
    const params: unknown[] = []
    if (q) {
      where.push('(q.quote_no LIKE ? OR c.name LIKE ? OR q.origin LIKE ? OR q.destination LIKE ? OR q.goods_desc LIKE ?)')
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
    }
    if (status) {
      where.push('q.status = ?')
      params.push(status)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = this.db
      .prepare(`SELECT COUNT(*) AS c FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id ${clause}`)
      .get(...params) as { c: number }
    const rows = this.db
      .prepare(`${BASE_SELECT} ${clause} ORDER BY q.created_at DESC, q.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as QuoteRow[]
    return { rows, total: total.c }
  }

  listByCustomer(customerId: number): QuoteRow[] {
    return this.db
      .prepare(`${BASE_SELECT} WHERE q.customer_id = ? ORDER BY q.created_at DESC, q.id DESC`)
      .all(customerId) as QuoteRow[]
  }

  findById(id: number): QuoteRow | undefined {
    return this.db.prepare(`${BASE_SELECT} WHERE q.id = ?`).get(id) as QuoteRow | undefined
  }

  countByYear(prefix: string, year: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM quotes WHERE quote_no LIKE ?`)
      .get(`${prefix}-${year}-%`) as { c: number }
    return row.c
  }

  create(data: QuoteInput, quoteNo: string, createdBy: number | null): QuoteRow {
    const info = this.db
      .prepare(
        `INSERT INTO quotes (quote_no, customer_id, origin, destination, distance_km, goods_desc, weight_kg, fee, status, valid_until, notes, created_by)
         VALUES (@quote_no, @customer_id, @origin, @destination, @distance_km, @goods_desc, @weight_kg, @fee, @status, @valid_until, @notes, @created_by)`,
      )
      .run({
        quote_no: quoteNo,
        customer_id: data.customer_id ?? null,
        origin: data.origin,
        destination: data.destination,
        distance_km: data.distance_km,
        goods_desc: data.goods_desc,
        weight_kg: data.weight_kg,
        fee: data.fee,
        status: data.status ?? 'sent',
        valid_until: data.valid_until ?? null,
        notes: data.notes ?? null,
        created_by: createdBy,
      })
    return this.findById(Number(info.lastInsertRowid))!
  }

  update(id: number, data: QuoteInput): QuoteRow | undefined {
    this.db
      .prepare(
        `UPDATE quotes
         SET customer_id = @customer_id, origin = @origin, destination = @destination, distance_km = @distance_km,
             goods_desc = @goods_desc, weight_kg = @weight_kg, fee = @fee, valid_until = @valid_until,
             notes = @notes, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ id, ...data, customer_id: data.customer_id ?? null, valid_until: data.valid_until ?? null, notes: data.notes ?? null })
    return this.findById(id)
  }

  setStatus(id: number, status: QuoteStatus): QuoteRow | undefined {
    this.db
      .prepare(`UPDATE quotes SET status = @status, updated_at = datetime('now') WHERE id = @id`)
      .run({ id, status })
    return this.findById(id)
  }

  /** บันทึกออเดอร์ที่แปลงจาก quote นี้ + เปลี่ยนสถานะเป็นตกลงราคา */
  markConverted(id: number, orderId: number): QuoteRow | undefined {
    this.db
      .prepare(
        `UPDATE quotes SET status = 'accepted', converted_order_id = @orderId, updated_at = datetime('now') WHERE id = @id`,
      )
      .run({ id, orderId })
    return this.findById(id)
  }
}
