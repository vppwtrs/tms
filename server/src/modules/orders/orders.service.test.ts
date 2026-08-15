import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../db/schema.js'
import { OrdersService } from './orders.service.js'
import { OrdersRepository } from './orders.repository.js'
import { SettingsRepository } from '../settings/settings.repository.js'

let db: Database.Database
let service: OrdersService
let orderId: number

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
  db.prepare(`INSERT INTO settings (key, value) VALUES ('org_name', 'บริษัท ทดสอบขนส่ง จำกัด')`).run()
  const customerId = Number(
    db
      .prepare(
        `INSERT INTO customers (name, address, contact_person, phone, tax_id) VALUES ('ลูกค้า ทดสอบ', 'ถนนสุขุมวิท กรุงเทพฯ', 'คุณสมชาย', '081-234-5678', '1234567890123')`,
      )
      .run().lastInsertRowid,
  )
  const vehicleId = Number(db.prepare(`INSERT INTO vehicles (plate_no, vehicle_type) VALUES ('กข 1234', 'truck6')`).run().lastInsertRowid)
  const driverId = Number(db.prepare(`INSERT INTO drivers (name, phone) VALUES ('นายใจดี', '089-999-9999')`).run().lastInsertRowid)
  const tripId = Number(
    db.prepare(`INSERT INTO trips (trip_no, vehicle_id, driver_id) VALUES ('TRP-2026-0001', ?, ?)`).run(vehicleId, driverId).lastInsertRowid,
  )
  orderId = Number(
    db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, origin, destination, distance_km, goods_desc, weight_kg, fee, scheduled_at, trip_id)
         VALUES ('ORD-2026-0001', ?, 'กรุงเทพฯ', 'ชลบุรี', 130, 'เครื่องใช้ไฟฟ้า', 1200, 2500, '2026-09-01T09:00:00.000Z', ?)`,
      )
      .run(customerId, tripId).lastInsertRowid,
  )
  service = new OrdersService(new OrdersRepository(db), new SettingsRepository(db))
})

describe('กรองออเดอร์ตามคนขับ', () => {
  /** สร้างคนขับ + เที่ยว + ออเดอร์อีกชุดหนึ่ง เพื่อพิสูจน์ว่ากรองแล้วไม่ปนกัน */
  function addSecondDriverWithOrder(): number {
    const vehicleId = Number(
      db.prepare(`INSERT INTO vehicles (plate_no, vehicle_type) VALUES ('กข 5678', 'truck6')`).run().lastInsertRowid,
    )
    const driverId = Number(db.prepare(`INSERT INTO drivers (name) VALUES ('นายขยัน')`).run().lastInsertRowid)
    const tripId = Number(
      db.prepare(`INSERT INTO trips (trip_no, vehicle_id, driver_id) VALUES ('TRP-2026-0002', ?, ?)`).run(vehicleId, driverId)
        .lastInsertRowid,
    )
    db.prepare(
      `INSERT INTO orders (order_no, origin, destination, distance_km, goods_desc, weight_kg, fee, scheduled_at, trip_id)
       VALUES ('ORD-2026-0002', 'กรุงเทพฯ', 'ระยอง', 180, 'ของ', 800, 3000, '2026-09-02T09:00:00.000Z', ?)`,
    ).run(tripId)
    return driverId
  }

  it('ระบุคนขับแล้วเห็นเฉพาะออเดอร์ของคนนั้น', () => {
    const otherDriverId = addSecondDriverWithOrder()
    const res = service.list({ driver_id: otherDriverId })
    expect(res.rows.map((r) => r.order_no)).toEqual(['ORD-2026-0002'])
    // ตัวเลขหน้าเพจต้องนับเฉพาะที่กรองแล้วด้วย ไม่ใช่นับทั้งตาราง
    expect(res.pagination.total).toBe(1)
  })

  it('แถวออเดอร์บอกชื่อคนขับและเลขเที่ยวมาด้วย ไม่ต้องเปิดทีละใบ', () => {
    const row = service.list({}).rows.find((r) => r.order_no === 'ORD-2026-0001')!
    expect(row.driver_name).toBe('นายใจดี')
    expect(row.trip_no).toBe('TRP-2026-0001')
  })

  it('ออเดอร์ที่ยังไม่ได้จัดคิวไม่มีคนขับ และไม่โผล่ตอนกรองตามคนขับ', () => {
    db.prepare(
      `INSERT INTO orders (order_no, origin, destination, distance_km, goods_desc, weight_kg, fee, scheduled_at)
       VALUES ('ORD-2026-0009', 'กรุงเทพฯ', 'ภูเก็ต', 800, 'ของ', 100, 9000, '2026-09-03T09:00:00.000Z')`,
    ).run()
    const free = service.list({}).rows.find((r) => r.order_no === 'ORD-2026-0009')!
    expect(free.driver_id).toBeNull()
    expect(free.driver_name).toBeNull()

    const filtered = service.list({ driver_id: 1 })
    expect(filtered.rows.some((r) => r.order_no === 'ORD-2026-0009')).toBe(false)
  })
})

describe('ใบนำส่ง (BOL)', () => {
  it('คืนข้อมูลครบสำหรับพิมพ์ — ออเดอร์ + ลูกค้า + รถ + คนขับ + ชื่อองค์กรจากตั้งค่า', () => {
    const bol = service.getBol(orderId)
    expect(bol.org.org_name).toBe('บริษัท ทดสอบขนส่ง จำกัด')
    expect(bol.order_no).toBe('ORD-2026-0001')
    expect(bol.origin).toBe('กรุงเทพฯ')
    expect(bol.destination).toBe('ชลบุรี')
    expect(bol.weight_kg).toBe(1200)
    expect(bol.fee).toBe(2500)
    expect(bol.customer_name).toBe('ลูกค้า ทดสอบ')
    expect(bol.customer_address).toBe('ถนนสุขุมวิท กรุงเทพฯ')
    expect(bol.customer_phone).toBe('081-234-5678')
    expect(bol.customer_tax_id).toBe('1234567890123')
    expect(bol.vehicle_plate).toBe('กข 1234')
    expect(bol.driver_name).toBe('นายใจดี')
    expect(bol.trip_no).toBe('TRP-2026-0001')
  })

  it('ออเดอร์ที่ไม่มีลูกค้า/ทริป — คอลัมน์เป็น null ไม่พัง', () => {
    const noRef = Number(
      db
        .prepare(
          `INSERT INTO orders (order_no, origin, destination, goods_desc, weight_kg, fee, scheduled_at)
           VALUES ('ORD-2026-0002', 'เชียงใหม่', 'ลำปาง', 'ของสด', 500, 1500, '2026-09-02T09:00:00.000Z')`,
        )
        .run().lastInsertRowid,
    )
    const bol = service.getBol(noRef)
    expect(bol.customer_name).toBeNull()
    expect(bol.vehicle_plate).toBeNull()
    expect(bol.driver_name).toBeNull()
    expect(bol.org.org_name).toBe('บริษัท ทดสอบขนส่ง จำกัด')
  })

  it('ออเดอร์ที่ไม่มีอยู่ → 404', () => {
    expect(() => service.getBol(9999)).toThrow(/ไม่พบออเดอร์/)
  })
})
