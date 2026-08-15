import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../db/schema.js'
import { PodService } from './pod.service.js'
import { PodRepository } from './pod.repository.js'
import { OrdersService } from '../orders/orders.service.js'
import { OrdersRepository } from '../orders/orders.repository.js'
import { TripsService } from '../trips/trips.service.js'
import { TripsRepository } from '../trips/trips.repository.js'
import { VehiclesRepository } from '../vehicles/vehicles.repository.js'
import { DriversRepository } from '../drivers/drivers.repository.js'

let db: Database.Database
let podService: PodService
let ordersService: OrdersService
let tripsService: TripsService
let vehicleId: number
let driverId: number
let userId: number

const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=' // ตัวอย่างลายเซ็น

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
  userId = Number(db.prepare(`INSERT INTO users (username, password_hash, name, role) VALUES ('tester', 'x', 'ผู้ทดสอบ', 'dispatcher')`).run().lastInsertRowid)
  db.prepare(`INSERT INTO customers (name) VALUES ('ลูกค้า A')`).run()
  const vehicles = new VehiclesRepository(db)
  const drivers = new DriversRepository(db)
  vehicleId = vehicles.create({ plate_no: 'กท-9999', vehicle_type: 'truck6', capacity_kg: 5000 }).id
  driverId = drivers.create({ name: 'สมชาย ใจดี' }).id

  const ordersRepo = new OrdersRepository(db)
  ordersService = new OrdersService(ordersRepo)
  tripsService = new TripsService(db, new TripsRepository(db), ordersRepo, vehicles, drivers)
  podService = new PodService(new PodRepository(db), ordersRepo)
})

async function deliverOrder(): Promise<number> {
  const order = ordersService.create({
    origin: 'กรุงเทพฯ',
    destination: 'ชลบุรี',
    distance_km: 130,
    goods_desc: 'เครื่องใช้ไฟฟ้า',
    weight_kg: 1000,
    fee: 2500,
    scheduled_at: new Date().toISOString(),
  })
  const { trip } = tripsService.create({ vehicle_id: vehicleId, driver_id: driverId, order_ids: [order.id] })
  tripsService.start(trip.id)
  tripsService.complete(trip.id)
  return order.id
}

describe('การเก็บ POD', () => {
  it('บล็อกการเก็บ POD สำหรับออเดอร์ที่ยังไม่ส่งสำเร็จ', () => {
    const order = ordersService.create({
      origin: 'กรุงเทพฯ',
      destination: 'ชลบุรี',
      distance_km: 130,
      goods_desc: 'สินค้า',
      weight_kg: 100,
      fee: 1000,
      scheduled_at: new Date().toISOString(),
    })
    expect(() =>
      podService.create({ order_id: order.id, recipient_name: 'คุณลูกค้า', signature_data: SIGNATURE }, userId),
    ).toThrow()
  })

  it('เก็บ POD ได้สำหรับออเดอร์ที่ส่งสำเร็จ — 1 ออเดอร์มีได้ 1 ใบ', async () => {
    const orderId = await deliverOrder()
    const pod = podService.create({ order_id: orderId, recipient_name: 'คุณลูกค้า', signature_data: SIGNATURE }, userId)
    expect(pod.status).toBe('collected')
    expect(pod.collected_by).toBe(userId)
    expect(pod.collected_at).toBeTruthy()

    // ซ้ำ → conflict
    expect(() => podService.create({ order_id: orderId, recipient_name: 'คนอื่น', signature_data: SIGNATURE }, userId)).toThrow()
  })

  it('ตรวจสอบว่า signature ต้องเป็นรูปภาพ', async () => {
    const orderId = await deliverOrder()
    expect(() => podService.create({ order_id: orderId, recipient_name: 'คุณลูกค้า', signature_data: 'not-an-image' }, userId)).toThrow()
  })

  it('แก้ไข POD ได้ก่อนยืนยัน และแก้ไขหมายเหตุ + ผู้รับได้', async () => {
    const orderId = await deliverOrder()
    const pod = podService.create({ order_id: orderId, recipient_name: 'คุณลูกค้า', signature_data: SIGNATURE, notes: 'แรก' }, userId)
    const updated = podService.update(pod.id, { recipient_name: 'คุณผู้จัดการ', notes: 'แก้ไขแล้ว' })
    expect(updated.recipient_name).toBe('คุณผู้จัดการ')
    expect(updated.notes).toBe('แก้ไขแล้ว')
  })

  it('ยืนยัน POD แล้ว → ล็อกถาวร แก้ไขไม่ได้', async () => {
    const orderId = await deliverOrder()
    const pod = podService.create({ order_id: orderId, recipient_name: 'คุณลูกค้า', signature_data: SIGNATURE }, userId)
    const verified = podService.verify(pod.id)
    expect(verified.status).toBe('verified')
    expect(() => podService.update(pod.id, { recipient_name: 'แก้' })).toThrow(/ยืนยันแล้ว/)
    expect(() => podService.verify(pod.id)).toThrow()
  })

  it('ห้ามสร้าง POD ซ้ำข้ามออเดอร์ที่ส่งสำเร็จคนละใบ — คนละใบได้คนละ POD', async () => {
    const o1 = await deliverOrder()
    const o2 = await deliverOrder()
    const p1 = podService.create({ order_id: o1, recipient_name: 'ก', signature_data: SIGNATURE }, userId)
    const p2 = podService.create({ order_id: o2, recipient_name: 'ข', signature_data: SIGNATURE }, userId)
    expect(p1.order_id).not.toBe(p2.order_id)
  })
})
