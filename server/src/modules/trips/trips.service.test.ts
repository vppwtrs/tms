import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../db/schema.js'
import { TripsService } from './trips.service.js'
import { TripsRepository } from './trips.repository.js'
import { OrdersService } from '../orders/orders.service.js'
import { OrdersRepository } from '../orders/orders.repository.js'
import { VehiclesRepository } from '../vehicles/vehicles.repository.js'
import { DriversRepository } from '../drivers/drivers.repository.js'

let db: Database.Database
let tripsService: TripsService
let ordersService: OrdersService
let vehicleId: number
let vehicleId2: number
let driverId: number
let driverId2: number

const orderInput = (overrides: Partial<{ weight_kg: number; origin: string; destination: string }> = {}) => ({
  origin: 'กรุงเทพฯ',
  destination: 'ชลบุรี',
  distance_km: 130,
  goods_desc: 'เครื่องใช้ไฟฟ้า',
  weight_kg: 1000,
  fee: 2500,
  scheduled_at: new Date().toISOString(),
  ...overrides,
})

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
  db.prepare(`INSERT INTO customers (name) VALUES ('ลูกค้า A')`).run()
  const vehicles = new VehiclesRepository(db)
  const drivers = new DriversRepository(db)
  vehicleId = vehicles.create({ plate_no: 'กท-1111', vehicle_type: 'truck6', capacity_kg: 5000 }).id
  vehicleId2 = vehicles.create({ plate_no: 'กท-2222', vehicle_type: 'truck10', capacity_kg: 10000 }).id
  driverId = drivers.create({ name: 'สมชาย ใจดี' }).id
  driverId2 = drivers.create({ name: 'วิชัย ทองดี' }).id

  const ordersRepo = new OrdersRepository(db)
  ordersService = new OrdersService(ordersRepo)
  tripsService = new TripsService(db, new TripsRepository(db), ordersRepo, vehicles, drivers)
})

function createOrders(n: number, weight = 1000): number[] {
  return Array.from({ length: n }, () => ordersService.create(orderInput({ weight_kg: weight })).id)
}

describe('การสร้างเที่ยวขนส่ง', () => {
  it('สร้างทริปได้จากออเดอร์ pending → ออเดอร์เป็น assigned และรถ/คนขับถูกจอง (on_trip)', () => {
    const [o1, o2] = createOrders(2)
    const { trip } = tripsService.create({ vehicle_id: vehicleId, driver_id: driverId, order_ids: [o1, o2] })

    expect(trip.status).toBe('planned')
    expect(trip.orders.map((o) => o.id).sort()).toEqual([o1, o2].sort())
    expect(ordersService.getById(o1).status).toBe('assigned')
    expect(ordersService.getById(o1).trip_id).toBe(trip.id)
    expect(db.prepare(`SELECT status FROM vehicles WHERE id = ?`).get(vehicleId)).toEqual({ status: 'on_trip' })
    expect(db.prepare(`SELECT status FROM drivers WHERE id = ?`).get(driverId)).toEqual({ status: 'on_trip' })
  })

  it('แจ้งเตือนเมื่อน้ำหนักรวมเกินความจุรถ แต่ยังสร้างได้', () => {
    const [o1, o2] = createOrders(2, 4000) // รวม 8000 > 5000
    const { warning } = tripsService.create({ vehicle_id: vehicleId, driver_id: driverId, order_ids: [o1, o2] })
    expect(warning).toContain('เกินความจุ')
  })

  it('บล็อกการใช้ออเดอร์ที่จัดคิวแล้วซ้ำ', () => {
    const [o1] = createOrders(1)
    tripsService.create({ vehicle_id: vehicleId, driver_id: driverId, order_ids: [o1] })
    expect(() => tripsService.create({ vehicle_id: vehicleId2, driver_id: driverId2, order_ids: [o1] })).toThrow()
  })

  it('บล็อกการจองรถ/คนขับที่มีทริปค้างอยู่', () => {
    const [o1, o2] = createOrders(2)
    tripsService.create({ vehicle_id: vehicleId, driver_id: driverId, order_ids: [o1] })
    expect(() => tripsService.create({ vehicle_id: vehicleId, driver_id: driverId2, order_ids: [o2] })).toThrow(/ไม่ว่าง|ค้างอยู่/)
    expect(() => tripsService.create({ vehicle_id: vehicleId2, driver_id: driverId, order_ids: [o2] })).toThrow(/ไม่ว่าง|ค้างอยู่/)
  })

  it('เพิ่มและถอนออเดอร์ออกจากทริปที่ยังไม่เริ่มได้', () => {
    const [o1] = createOrders(1)
    const { trip } = tripsService.create({ vehicle_id: vehicleId, driver_id: driverId, order_ids: [o1] })
    const [o2] = createOrders(1)
    tripsService.addOrders(trip.id, [o2])
    expect(ordersService.getById(o2).trip_id).toBe(trip.id)

    tripsService.removeOrder(trip.id, o2)
    expect(ordersService.getById(o2).status).toBe('pending')
    expect(ordersService.getById(o2).trip_id).toBeNull()
  })
})

describe('วงจรชีวิตของทริป (state machine)', () => {
  it('start → ออเดอร์เป็น in_transit / complete → delivered + รถคืนว่าง', () => {
    const [o1] = createOrders(1)
    const { trip } = tripsService.create({ vehicle_id: vehicleId, driver_id: driverId, order_ids: [o1] })

    const started = tripsService.start(trip.id)
    expect(started.status).toBe('in_progress')
    expect(ordersService.getById(o1).status).toBe('in_transit')
    expect(started.departed_at).not.toBeNull()

    const done = tripsService.complete(trip.id)
    expect(done.status).toBe('completed')
    expect(ordersService.getById(o1).status).toBe('delivered')
    expect(ordersService.getById(o1).delivered_at).not.toBeNull()
    expect(db.prepare(`SELECT status FROM vehicles WHERE id = ?`).get(vehicleId)).toEqual({ status: 'available' })
    expect(db.prepare(`SELECT status FROM drivers WHERE id = ?`).get(driverId)).toEqual({ status: 'available' })
  })

  it('cancel ทริปที่วางแผนแล้ว → ออเดอร์กลับเป็น pending, รถคืนว่าง', () => {
    const [o1] = createOrders(1)
    const { trip } = tripsService.create({ vehicle_id: vehicleId, driver_id: driverId, order_ids: [o1] })
    tripsService.cancel(trip.id)
    expect(ordersService.getById(o1).status).toBe('pending')
    expect(ordersService.getById(o1).trip_id).toBeNull()
    expect(db.prepare(`SELECT status FROM vehicles WHERE id = ?`).get(vehicleId)).toEqual({ status: 'available' })
  })

  it('ทำ action ไม่ถูกสถานะ → error', () => {
    const [o1] = createOrders(1)
    const { trip } = tripsService.create({ vehicle_id: vehicleId, driver_id: driverId, order_ids: [o1] })
    expect(() => tripsService.complete(trip.id)).toThrow() // ยังไม่เริ่ม
    tripsService.start(trip.id)
    expect(() => tripsService.start(trip.id)).toThrow() // เริ่มซ้ำ
    expect(() => tripsService.addOrders(trip.id, [o1])).toThrow()
  })
})

describe('การยกเลิกออเดอร์', () => {
  it('ยกเลิกออเดอร์ pending ได้', () => {
    const [o1] = createOrders(1)
    const order = ordersService.cancel(o1)
    expect(order.status).toBe('cancelled')
  })

  it('บล็อกการยกเลิกออเดอร์ที่กำลังขนส่ง (ทริป in_progress)', () => {
    const [o1] = createOrders(1)
    const { trip } = tripsService.create({ vehicle_id: vehicleId, driver_id: driverId, order_ids: [o1] })
    tripsService.start(trip.id)
    expect(() => ordersService.cancel(o1)).toThrow()
  })

  it('ยกเลิกออเดอร์ที่อยู่ในทริปวางแผนแล้ว → ถอนออกจากทริปและยกเลิก', () => {
    const [o1, o2] = createOrders(2)
    const { trip } = tripsService.create({ vehicle_id: vehicleId, driver_id: driverId, order_ids: [o1, o2] })
    const cancelled = ordersService.cancel(o1)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.trip_id).toBeNull()
    // ทริปเหลือออเดอร์เดียว
    const detail = tripsService.getDetail(trip.id)
    expect(detail.orders.map((o) => o.id)).toEqual([o2])
  })
})
