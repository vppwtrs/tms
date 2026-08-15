import type Database from 'better-sqlite3'

/** แถวเที่ยววิ่งเท่าที่คนขับควรเห็น — ไม่มีค่าน้ำมัน/ทางด่วน/ค่าใช้จ่ายอื่น */
export interface MyTripRow {
  id: number
  trip_no: string
  status: string
  departed_at: string | null
  arrived_at: string | null
  notes: string | null
  vehicle_plate: string
  vehicle_type: string
}

/** ออเดอร์เท่าที่คนขับควรเห็น — ไม่มีค่าขนส่ง (fee) */
export interface MyOrderRow {
  id: number
  order_no: string
  trip_id: number
  status: string
  priority: string
  origin: string
  destination: string
  distance_km: number
  goods_desc: string
  weight_kg: number
  scheduled_at: string
  delivered_at: string | null
  notes: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_address: string | null
  has_pod: number
}

export class MyJobsRepository {
  constructor(private readonly db: Database.Database) {}

  /** บัญชีนี้เป็นคนขับคนไหน — คืน null ถ้ายังไม่ได้ผูก */
  findDriverIdByUser(userId: number): number | null {
    const row = this.db.prepare(`SELECT id FROM drivers WHERE user_id = ?`).get(userId) as { id: number } | undefined
    return row?.id ?? null
  }

  /** เที่ยวของคนขับคนนี้ — ค่าเริ่มต้นเอาเฉพาะที่ยังไม่จบ
   *  คอลัมน์เงินไม่ถูก SELECT มาตั้งแต่ต้น ไม่ใช่ดึงมาแล้วค่อยลบทีหลัง
   *  (ลบทีหลังคือรอวันที่ใครสักคนลืมลบ) */
  listByDriver(driverId: number, includeDone: boolean): MyTripRow[] {
    /* "งานค้าง" ไม่ได้แปลว่า "เที่ยวยังไม่จบ"
       POD เก็บได้หลังออเดอร์ส่งสำเร็จเท่านั้น = หลังปิดเที่ยว
       ถ้ากรองด้วยสถานะเที่ยวอย่างเดียว การ์ดจะหายไปตอนกดปิดงาน
       แล้วคนขับจะเก็บลายเซ็นไม่ได้เลย — เที่ยวที่จบแล้วแต่ POD ยังไม่ครบจึงยังค้างอยู่ */
    const statusFilter = includeDone
      ? ''
      : `AND (t.status IN ('planned','in_progress')
             OR (t.status = 'completed'
                 AND EXISTS (SELECT 1 FROM orders o
                              WHERE o.trip_id = t.id
                                AND o.status = 'delivered'
                                AND NOT EXISTS (SELECT 1 FROM pod p WHERE p.order_id = o.id))))`
    return this.db
      .prepare(
        `SELECT t.id, t.trip_no, t.status, t.departed_at, t.arrived_at, t.notes,
                v.plate_no AS vehicle_plate, v.vehicle_type
           FROM trips t
           JOIN vehicles v ON v.id = t.vehicle_id
          WHERE t.driver_id = ? ${statusFilter}
          ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
                   t.created_at DESC
          LIMIT 100`,
      )
      .all(driverId) as MyTripRow[]
  }

  ordersByTrips(tripIds: number[]): MyOrderRow[] {
    if (tripIds.length === 0) return []
    const holes = tripIds.map(() => '?').join(',')
    return this.db
      .prepare(
        `SELECT o.id, o.order_no, o.trip_id, o.status, o.priority, o.origin, o.destination,
                o.distance_km, o.goods_desc, o.weight_kg, o.scheduled_at, o.delivered_at, o.notes,
                c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
                EXISTS (SELECT 1 FROM pod p WHERE p.order_id = o.id) AS has_pod
           FROM orders o
           LEFT JOIN customers c ON c.id = o.customer_id
          WHERE o.trip_id IN (${holes})
          ORDER BY o.scheduled_at`,
      )
      .all(...tripIds) as MyOrderRow[]
  }

  /** เที่ยวนี้เป็นของคนขับคนนี้จริงไหม — ใช้ก่อนทุกการกระทำที่เปลี่ยนข้อมูล */
  tripBelongsTo(tripId: number, driverId: number): boolean {
    const row = this.db.prepare(`SELECT 1 AS ok FROM trips WHERE id = ? AND driver_id = ?`).get(tripId, driverId) as
      | { ok: number }
      | undefined
    return !!row
  }

  /** ออเดอร์นี้อยู่ในเที่ยวของคนขับคนนี้ไหม */
  orderBelongsTo(orderId: number, driverId: number): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS ok FROM orders o JOIN trips t ON t.id = o.trip_id WHERE o.id = ? AND t.driver_id = ?`,
      )
      .get(orderId, driverId) as { ok: number } | undefined
    return !!row
  }
}
