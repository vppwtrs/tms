import type Database from 'better-sqlite3'
import type { InteractionType, CustomerSegment } from '../../core/constants.js'

export interface CustomerRow {
  id: number
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  segment: CustomerSegment | null
  tax_id: string | null
  credit_terms: number | null
  tags: string | null
  price_note: string | null
  created_at: string
}

export interface CustomerDetailRow extends CustomerRow {
  order_count: number
  total_revenue: number
  last_order_at: string | null
  open_tasks_count: number
  pending_quotes_count: number
}

export interface CustomerInput {
  name: string
  contact_person?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  segment?: CustomerSegment | null
  tax_id?: string | null
  credit_terms?: number | null
  tags?: string | null
  price_note?: string | null
}

export interface InteractionRow {
  id: number
  customer_id: number
  type: InteractionType
  subject: string
  note: string | null
  happened_at: string
  created_by: number | null
  created_by_name: string | null
  created_at: string
}

export interface InteractionInput {
  type: InteractionType
  subject: string
  note?: string | null
  happened_at: string
}

export interface CustomerTaskRow {
  id: number
  customer_id: number
  title: string
  due_at: string | null
  status: 'pending' | 'done'
  note: string | null
  created_by: number | null
  created_by_name: string | null
  created_at: string
}

export interface CustomerTaskInput {
  title: string
  due_at?: string | null
  note?: string | null
}

/** ชั้น data access ของลูกค้า + CRM (การติดต่อ, งานติดตาม) */
export class CustomersRepository {
  constructor(private readonly db: Database.Database) {}

  list(q: string, segment: CustomerSegment | undefined, limit: number, offset: number): { rows: CustomerRow[]; total: number } {
    const where: string[] = []
    const params: unknown[] = []
    if (q) {
      where.push('(name LIKE ? OR contact_person LIKE ? OR phone LIKE ? OR tags LIKE ?)')
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
    }
    if (segment) {
      where.push('segment = ?')
      params.push(segment)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = this.db
      .prepare(`SELECT COUNT(*) AS c FROM customers ${clause}`)
      .get(...params) as { c: number }
    const rows = this.db
      .prepare(
        `SELECT * FROM customers ${clause}
         ORDER BY CASE segment WHEN 'VIP' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END, name COLLATE NOCASE
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as CustomerRow[]
    return { rows, total: total.c }
  }

  findAll(): CustomerRow[] {
    return this.db.prepare(`SELECT * FROM customers ORDER BY name COLLATE NOCASE`).all() as CustomerRow[]
  }

  findById(id: number): CustomerRow | undefined {
    return this.db.prepare(`SELECT * FROM customers WHERE id = ?`).get(id) as CustomerRow | undefined
  }

  /** รายละเอียดเต็ม: ข้อมูล + สถิติออเดอร์/รายได้ + งานค้าง + ใบเสนอราคาค้าง */
  findDetail(id: number): CustomerDetailRow | undefined {
    const base = this.db
      .prepare(
        `SELECT c.*,
          (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count,
          (SELECT COALESCE(SUM(o.fee),0) FROM orders o WHERE o.customer_id = c.id AND o.status = 'delivered') AS total_revenue,
          (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id) AS last_order_at,
          (SELECT COUNT(*) FROM customer_tasks t WHERE t.customer_id = c.id AND t.status = 'pending') AS open_tasks_count,
          (SELECT COUNT(*) FROM quotes q WHERE q.customer_id = c.id AND q.status IN ('draft','sent')) AS pending_quotes_count
         FROM customers c WHERE c.id = ?`,
      )
      .get(id) as CustomerDetailRow | undefined
    return base
  }

  create(data: CustomerInput): CustomerRow {
    const info = this.db
      .prepare(
        `INSERT INTO customers (name, contact_person, phone, email, address, segment, tax_id, credit_terms, tags, price_note)
         VALUES (@name, @contact_person, @phone, @email, @address, @segment, @tax_id, @credit_terms, @tags, @price_note)`,
      )
      .run({
        name: data.name,
        contact_person: data.contact_person ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        address: data.address ?? null,
        segment: data.segment ?? 'B',
        tax_id: data.tax_id ?? null,
        credit_terms: data.credit_terms ?? null,
        tags: data.tags ?? null,
        price_note: data.price_note ?? null,
      })
    return this.findById(Number(info.lastInsertRowid))!
  }

  update(id: number, data: CustomerInput): CustomerRow | undefined {
    this.db
      .prepare(
        `UPDATE customers
         SET name = @name, contact_person = @contact_person, phone = @phone, email = @email, address = @address,
             segment = @segment, tax_id = @tax_id, credit_terms = @credit_terms, tags = @tags, price_note = @price_note
         WHERE id = @id`,
      )
      .run({
        id,
        name: data.name,
        contact_person: data.contact_person ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        address: data.address ?? null,
        segment: data.segment ?? 'B',
        tax_id: data.tax_id ?? null,
        credit_terms: data.credit_terms ?? null,
        tags: data.tags ?? null,
        price_note: data.price_note ?? null,
      })
    return this.findById(id)
  }

  orderCount(id: number): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE customer_id = ?`).get(id) as { c: number }
    return row.c
  }

  delete(id: number): void {
    this.db.prepare(`DELETE FROM customers WHERE id = ?`).run(id)
  }

  /* ===== การติดต่อ (interactions) ===== */

  createInteraction(customerId: number, data: InteractionInput, createdBy: number | null): InteractionRow {
    const info = this.db
      .prepare(
        `INSERT INTO customer_interactions (customer_id, type, subject, note, happened_at, created_by)
         VALUES (@customer_id, @type, @subject, @note, @happened_at, @created_by)`,
      )
      .run({
        customer_id: customerId,
        type: data.type,
        subject: data.subject,
        note: data.note ?? null,
        happened_at: data.happened_at,
        created_by: createdBy,
      })
    return this.findInteraction(Number(info.lastInsertRowid))!
  }

  findInteraction(id: number): InteractionRow | undefined {
    return this.db
      .prepare(
        `SELECT i.*, u.name AS created_by_name
         FROM customer_interactions i LEFT JOIN users u ON u.id = i.created_by
         WHERE i.id = ?`,
      )
      .get(id) as InteractionRow | undefined
  }

  listInteractions(customerId: number, limit = 50): InteractionRow[] {
    return this.db
      .prepare(
        `SELECT i.*, u.name AS created_by_name
         FROM customer_interactions i LEFT JOIN users u ON u.id = i.created_by
         WHERE i.customer_id = ? ORDER BY i.happened_at DESC, i.id DESC LIMIT ?`,
      )
      .all(customerId, limit) as InteractionRow[]
  }

  removeInteraction(id: number): void {
    this.db.prepare(`DELETE FROM customer_interactions WHERE id = ?`).run(id)
  }

  /* ===== งานติดตาม (tasks) ===== */

  createTask(customerId: number, data: CustomerTaskInput, createdBy: number | null): CustomerTaskRow {
    const info = this.db
      .prepare(
        `INSERT INTO customer_tasks (customer_id, title, due_at, status, note, created_by)
         VALUES (@customer_id, @title, @due_at, 'pending', @note, @created_by)`,
      )
      .run({
        customer_id: customerId,
        title: data.title,
        due_at: data.due_at ?? null,
        note: data.note ?? null,
        created_by: createdBy,
      })
    return this.findTask(Number(info.lastInsertRowid))!
  }

  findTask(id: number): CustomerTaskRow | undefined {
    return this.db
      .prepare(
        `SELECT t.*, u.name AS created_by_name
         FROM customer_tasks t LEFT JOIN users u ON u.id = t.created_by
         WHERE t.id = ?`,
      )
      .get(id) as CustomerTaskRow | undefined
  }

  listTasks(customerId: number): CustomerTaskRow[] {
    return this.db
      .prepare(
        `SELECT t.*, u.name AS created_by_name
         FROM customer_tasks t LEFT JOIN users u ON u.id = t.created_by
         WHERE t.customer_id = ?
         ORDER BY CASE t.status WHEN 'pending' THEN 0 ELSE 1 END, COALESCE(t.due_at, '9999') ASC, t.id DESC`,
      )
      .all(customerId) as CustomerTaskRow[]
  }

  setTaskStatus(id: number, status: 'pending' | 'done'): CustomerTaskRow | undefined {
    this.db.prepare(`UPDATE customer_tasks SET status = @status WHERE id = @id`).run({ id, status })
    return this.findTask(id)
  }

  removeTask(id: number): void {
    this.db.prepare(`DELETE FROM customer_tasks WHERE id = ?`).run(id)
  }
}
