import type Database from 'better-sqlite3'
import type { OrderStatus, Priority } from '../../core/constants.js'

export interface OrderRow {
  id: number
  order_no: string
  customer_id: number | null
  customer_name: string | null
  origin: string
  destination: string
  distance_km: number
  goods_desc: string
  weight_kg: number
  fee: number
  status: OrderStatus
  priority: Priority
  scheduled_at: string
  delivered_at: string | null
  trip_id: number | null
  trip_no: string | null
  trip_status: string | null
  /** คนขับที่รับผิดชอบ — มาจากเที่ยววิ่ง ไม่ใช่ช่องในตาราง orders */
  driver_id: number | null
  driver_name: string | null
  pod_id: number | null
  pod_status: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface BolRow {
  id: number
  order_no: string
  customer_id: number | null
  customer_name: string | null
  customer_address: string | null
  customer_contact: string | null
  customer_phone: string | null
  customer_tax_id: string | null
  origin: string
  destination: string
  distance_km: number
  goods_desc: string
  weight_kg: number
  fee: number
  status: OrderStatus
  priority: Priority
  scheduled_at: string
  delivered_at: string | null
  notes: string | null
  trip_no: string | null
  vehicle_plate: string | null
  vehicle_type: string | null
  driver_name: string | null
  driver_phone: string | null
  created_at: string
}

export interface OrderInput {
  customer_id?: number | null
  origin: string
  destination: string
  distance_km: number
  goods_desc: string
  weight_kg: number
  fee: number
  priority?: Priority
  scheduled_at: string
  notes?: string | null
}

export interface OrderFilters {
  q: string
  status?: OrderStatus
  priority?: Priority
  customer_id?: number
  from?: string
  to?: string
  trip_id?: number
  driver_id?: number
}

/* ออเดอร์ไม่ได้ผูกกับคนขับโดยตรง — ผูกผ่านเที่ยววิ่ง (orders.trip_id → trips.driver_id)
   join ถึงคนขับไว้ใน select หลักเลย เพราะคำถามแรกของฝ่ายวางแผนคือ "ใบนี้ใครวิ่ง"
   ถ้าไม่มีในตาราง ต้องเปิดทีละใบดู */
const ORDER_JOINS = `
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  LEFT JOIN trips t ON t.id = o.trip_id
  LEFT JOIN drivers d ON d.id = t.driver_id
  LEFT JOIN pod p ON p.order_id = o.id
`

const BASE_SELECT = `
  SELECT o.*, c.name AS customer_name, t.status AS trip_status, t.trip_no,
         d.id AS driver_id, d.name AS driver_name,
         p.id AS pod_id, p.status AS pod_status
  ${ORDER_JOINS}
`

export class OrdersRepository {
  constructor(private readonly db: Database.Database) {}

  list(f: OrderFilters, limit: number, offset: number): { rows: OrderRow[]; total: number } {
    const where: string[] = []
    const params: unknown[] = []
    if (f.q) {
      where.push('(o.order_no LIKE ? OR c.name LIKE ? OR o.origin LIKE ? OR o.destination LIKE ? OR o.goods_desc LIKE ?)')
      params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`)
    }
    if (f.status) {
      where.push('o.status = ?')
      params.push(f.status)
    }
    if (f.priority) {
      where.push('o.priority = ?')
      params.push(f.priority)
    }
    if (f.customer_id) {
      where.push('o.customer_id = ?')
      params.push(f.customer_id)
    }
    if (f.from) {
      where.push('o.scheduled_at >= ?')
      params.push(f.from)
    }
    if (f.to) {
      where.push('o.scheduled_at <= ?')
      params.push(f.to)
    }
    if (f.trip_id) {
      where.push('o.trip_id = ?')
      params.push(f.trip_id)
    }
    if (f.driver_id) {
      where.push('t.driver_id = ?')
      params.push(f.driver_id)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    /* นับด้วย join ชุดเดียวกับตอนดึงแถวเสมอ — ก่อนหน้านี้ count join แค่ customers
       พอกรองด้วยคนขับ (อยู่คนละตาราง) ตัวเลขหน้าเพจกับแถวจริงจะไม่ตรงกัน */
    const total = this.db.prepare(`SELECT COUNT(*) AS c ${ORDER_JOINS} ${clause}`).get(...params) as { c: number }
    const rows = this.db
      .prepare(`${BASE_SELECT} ${clause} ORDER BY o.scheduled_at DESC, o.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as OrderRow[]
    return { rows, total: total.c }
  }

  findById(id: number): OrderRow | undefined {
    return this.db.prepare(`${BASE_SELECT} WHERE o.id = ?`).get(id) as OrderRow | undefined
  }

  /** ข้อมูลครบสำหรับพิมพ์ใบนำส่ง (BOL) — ออเดอร์ + ลูกค้า + รถ + คนขับ + เที่ยว */
  getBol(id: number): BolRow | undefined {
    return this.db
      .prepare(
        `SELECT o.id, o.order_no, o.customer_id, o.origin, o.destination, o.distance_km, o.goods_desc,
                o.weight_kg, o.fee, o.status, o.priority, o.scheduled_at, o.delivered_at, o.notes, o.created_at,
                c.name AS customer_name, c.address AS customer_address,
                c.contact_person AS customer_contact, c.phone AS customer_phone, c.tax_id AS customer_tax_id,
                t.trip_no, v.plate_no AS vehicle_plate, v.vehicle_type, d.name AS driver_name, d.phone AS driver_phone
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id
         LEFT JOIN trips t ON t.id = o.trip_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
         LEFT JOIN drivers d ON d.id = t.driver_id
         WHERE o.id = ?`,
      )
      .get(id) as BolRow | undefined
  }

  findByTrip(tripId: number): OrderRow[] {
    return this.db.prepare(`${BASE_SELECT} WHERE o.trip_id = ? ORDER BY o.id`).all(tripId) as OrderRow[]
  }

  listByTripIds(tripIds: number[]): OrderRow[] {
    if (tripIds.length === 0) return []
    const placeholders = tripIds.map(() => '?').join(',')
    return this.db
      .prepare(`${BASE_SELECT} WHERE o.trip_id IN (${placeholders}) ORDER BY o.id`)
      .all(...tripIds) as OrderRow[]
  }

  /** หาออเดอร์ pending ที่ยังไม่ถูกจัดคิว (สำหรับหน้าวางแผน) */
  listPendingUnassigned(q: string): OrderRow[] {
    const like = `%${q}%`
    return this.db
      .prepare(
        `${BASE_SELECT}
         WHERE o.status = 'pending' AND o.trip_id IS NULL
           AND (o.order_no LIKE ? OR c.name LIKE ? OR o.destination LIKE ?)
         ORDER BY o.priority DESC, o.scheduled_at ASC, o.id ASC`,
      )
      .all(like, like, like) as OrderRow[]
  }

  countByYear(prefix: string, year: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE order_no LIKE ?`)
      .get(`${prefix}-${year}-%`) as { c: number }
    return row.c
  }

  create(data: OrderInput, orderNo: string): OrderRow {
    const info = this.db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, origin, destination, distance_km, goods_desc, weight_kg, fee, priority, scheduled_at, notes)
         VALUES (@order_no, @customer_id, @origin, @destination, @distance_km, @goods_desc, @weight_kg, @fee, @priority, @scheduled_at, @notes)`,
      )
      .run({
        ...data,
        order_no: orderNo,
        customer_id: data.customer_id ?? null,
        priority: data.priority ?? 'normal',
        notes: data.notes ?? null,
      })
    return this.findById(Number(info.lastInsertRowid))!
  }

  update(id: number, data: OrderInput): OrderRow | undefined {
    this.db
      .prepare(
        `UPDATE orders
         SET customer_id = @customer_id, origin = @origin, destination = @destination, distance_km = @distance_km,
             goods_desc = @goods_desc, weight_kg = @weight_kg, fee = @fee, priority = @priority,
             scheduled_at = @scheduled_at, notes = @notes, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ id, ...data, customer_id: data.customer_id ?? null, notes: data.notes ?? null })
    return this.findById(id)
  }

  setStatus(id: number, status: OrderStatus, extra: Partial<OrderRow> = {}): OrderRow | undefined {
    const sets: string[] = ['status = @status', "updated_at = datetime('now')"]
    const params: Record<string, unknown> = { id, status }
    if ('delivered_at' in extra) {
      sets.push('delivered_at = @delivered_at')
      params.delivered_at = extra.delivered_at
    }
    if ('trip_id' in extra) {
      sets.push('trip_id = @trip_id')
      params.trip_id = extra.trip_id
    }
    this.db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = @id`).run(params)
    return this.findById(id)
  }
}
