import type Database from 'better-sqlite3'
import { err } from '../../core/errors.js'
import { generateDocNo, nowIso, parseLimit, parsePage, buildPagination, type Pagination } from '../../utils/helpers.js'
import { TripsRepository, type TripInput, type TripRow } from './trips.repository.js'
import { OrdersRepository, type OrderRow } from '../orders/orders.repository.js'
import { VehiclesRepository, type VehicleRow } from '../vehicles/vehicles.repository.js'
import { DriversRepository, type DriverRow } from '../drivers/drivers.repository.js'
import type { TripStatus } from '../../core/constants.js'

export interface TripDetail extends TripRow {
  orders: OrderRow[]
  total_weight: number
  total_fee: number
  total_cost: number
}

export interface CreateTripInput {
  vehicle_id: number
  driver_id: number
  order_ids: number[]
  notes?: string | null
}

/**
 * กฎธุรกิจของการวางแผน/ดำเนินการขนส่ง:
 * 1. รถ+คนขับต้องว่าง (available) และไม่มีทริปอื่นค้างอยู่
 * 2. ออเดอร์ต้องเป็น pending และยังไม่ถูกจัดคิว
 * 3. รวมน้ำหนักเกินความจุรถได้ (แจ้งเตือน) — ผู้วางแผนยืนยันเอง
 * 4. สร้างทริป = จองรถ/คนขับทันที (on_trip) จนกว่าทริปเสร็จ/ยกเลิก
 * 5. ทุกขั้นตอนอยู่ใน transaction — กลางคัน fail ทั้งหมดย้อนกลับ
 */
export class TripsService {
  constructor(
    private readonly db: Database.Database,
    private readonly trips: TripsRepository,
    private readonly orders: OrdersRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly drivers: DriversRepository,
  ) {}

  list(query: { status?: TripStatus; page?: unknown; limit?: unknown }): { rows: TripRow[]; pagination: Pagination } {
    const page = parsePage(query.page)
    const limit = parseLimit(query.limit)
    const { rows, total } = this.trips.list(query.status, limit, (page - 1) * limit)
    return { rows, pagination: buildPagination(total, page, limit) }
  }

  /** ข้อมูลสำหรับหน้า "แผนงานขนส่ง" — ทริปที่วางแผนแล้ว + กำลังขนส่ง */
  board(): { planned: TripDetail[]; in_progress: TripDetail[] } {
    const trips = this.trips.listByStatuses(['planned', 'in_progress'])
    const ordersByTrip = this.groupOrdersByTrip(trips.map((t) => t.id))
    return {
      planned: trips.filter((t) => t.status === 'planned').map((t) => this.toDetail(t, ordersByTrip)),
      in_progress: trips.filter((t) => t.status === 'in_progress').map((t) => this.toDetail(t, ordersByTrip)),
    }
  }

  getDetail(id: number): TripDetail {
    const trip = this.trips.findById(id)
    if (!trip) throw err.notFound('ไม่พบเที่ยวขนส่งนี้')
    return this.toDetail(trip, this.groupOrdersByTrip([id]))
  }

  create(input: CreateTripInput): { trip: TripDetail; warning?: string } {
    const vehicle = this.requireAvailableVehicle(input.vehicle_id)
    const driver = this.requireAvailableDriver(input.driver_id)
    const orderIds = [...new Set(input.order_ids)]
    if (orderIds.length === 0) throw err.badRequest('เลือกอย่างน้อย 1 ออเดอร์สำหรับเที่ยวนี้')

    const year = new Date().getFullYear()
    const tripNo = generateDocNo('TRP', this.trips.countByYear('TRP', year) + 1, year)

    let warning: string | undefined
    const tx = this.db.transaction((): TripRow => {
      const trip = this.trips.create({ vehicle_id: vehicle.id, driver_id: driver.id, notes: input.notes }, tripNo)
      const orders = orderIds.map((id) => this.orders.findById(id))
      let totalWeight = 0
      for (const order of orders) {
        if (!order) throw err.notFound('ไม่พบออเดอร์บางรายการในระบบ')
        this.assertOrderAssignable(order)
        this.orders.setStatus(order.id, 'assigned', { trip_id: trip.id })
        totalWeight += order.weight_kg
      }
      if (totalWeight > vehicle.capacity_kg) {
        warning = `น้ำหนักรวม ${totalWeight.toLocaleString()} กก. เกินความจุรถ ${vehicle.capacity_kg.toLocaleString()} กก. — ยืนยันก่อนออกเดินทาง`
      }
      // จองรถ/คนขับทันทีที่วางแผนเสร็จ
      this.vehicles.setStatus(vehicle.id, 'on_trip')
      this.drivers.setStatus(driver.id, 'on_trip')
      return trip
    })
    const trip = tx()
    return { trip: this.getDetail(trip.id), warning }
  }

  /** เพิ่มออเดอร์เข้าเที่ยวที่ยังไม่เริ่มเดินทาง */
  addOrders(tripId: number, orderIds: number[]): { trip: TripDetail; warning?: string } {
    const trip = this.requireStatus(tripId, ['planned'])
    const vehicle = this.vehicles.findById(trip.vehicle_id)
    if (!vehicle) throw err.notFound('ไม่พบรถของเที่ยวนี้')

    const ids = [...new Set(orderIds)]
    let warning: string | undefined
    const tx = this.db.transaction((): void => {
      for (const id of ids) {
        const order = this.orders.findById(id)
        if (!order) throw err.notFound('ไม่พบออเดอร์บางรายการในระบบ')
        this.assertOrderAssignable(order)
        this.orders.setStatus(order.id, 'assigned', { trip_id: tripId })
      }
      const total = this.trips.sumWeightByTrip(tripId)
      if (total > vehicle.capacity_kg) {
        warning = `น้ำหนักรวม ${total.toLocaleString()} กก. เกินความจุรถ ${vehicle.capacity_kg.toLocaleString()} กก.`
      }
    })
    tx()
    return { trip: this.getDetail(tripId), warning }
  }

  removeOrder(tripId: number, orderId: number): TripDetail {
    this.requireStatus(tripId, ['planned'])
    const order = this.orders.findById(orderId)
    if (!order || order.trip_id !== tripId) throw err.notFound('ไม่พบออเดอร์นี้ในเที่ยว')
    this.orders.setStatus(orderId, 'pending', { trip_id: null })
    return this.getDetail(tripId)
  }

  start(tripId: number): TripDetail {
    const trip = this.requireStatus(tripId, ['planned'])
    const tx = this.db.transaction((): void => {
      this.trips.setStatus(tripId, 'in_progress', { departed_at: nowIso() })
      for (const order of this.orders.findByTrip(tripId)) {
        if (order.status === 'assigned') this.orders.setStatus(order.id, 'in_transit')
      }
    })
    tx()
    return this.getDetail(tripId)
  }

  complete(tripId: number): TripDetail {
    const trip = this.requireStatus(tripId, ['in_progress'])
    const tx = this.db.transaction((): void => {
      this.trips.setStatus(tripId, 'completed', { arrived_at: nowIso() })
      for (const order of this.orders.findByTrip(tripId)) {
        if (order.status === 'in_transit') {
          this.orders.setStatus(order.id, 'delivered', { delivered_at: nowIso() })
        }
      }
      this.vehicles.setStatus(trip.vehicle_id, 'available')
      this.drivers.setStatus(trip.driver_id, 'available')
    })
    tx()
    return this.getDetail(tripId)
  }

  /**
   * ปิดการส่งของ "ทีละจุด" — เที่ยวยังวิ่งต่อ
   *
   * เที่ยวหนึ่งมีได้หลายร้าน และ POD ต้องเก็บที่หน้าร้านตอนนั้น ไม่ใช่ย้อนเก็บทีหลัง
   * แต่ `pod.create()` ยอมรับเฉพาะออเดอร์ที่ delivered แล้ว — ถ้าไม่มีทางปิดทีละจุด
   * คนขับจะเก็บลายเซ็นร้านแรกไม่ได้จนกว่าจะวิ่งครบทุกร้านแล้วปิดเที่ยว
   *
   * ไม่ปิดเที่ยวให้อัตโนมัติแม้ส่งครบแล้ว — การปล่อยรถ/คนขับคืนเป็น "ว่าง"
   * ต้องมาจากการกดยืนยันของคนขับ ไม่ใช่ผลข้างเคียงของการกดปิดร้านสุดท้าย
   */
  deliverOrder(orderId: number): { order: OrderRow; trip_id: number } {
    const order = this.orders.findById(orderId)
    if (!order || !order.trip_id) throw err.notFound('ไม่พบออเดอร์นี้ หรือยังไม่ได้อยู่ในเที่ยววิ่ง')
    this.requireStatus(order.trip_id, ['in_progress'])
    if (order.status === 'delivered') throw err.invalidState(`ออเดอร์ ${order.order_no} ถูกส่งไปแล้ว`)
    if (order.status !== 'in_transit') {
      throw err.invalidState(`ออเดอร์ ${order.order_no} อยู่ในสถานะ "${order.status}" ยังปิดการส่งไม่ได้`)
    }
    const updated = this.orders.setStatus(orderId, 'delivered', { delivered_at: nowIso() })!
    return { order: updated, trip_id: order.trip_id }
  }

  cancel(tripId: number): TripDetail {
    const trip = this.requireStatus(tripId, ['planned', 'in_progress'])
    const tx = this.db.transaction((): void => {
      this.trips.setStatus(tripId, 'cancelled')
      for (const order of this.orders.findByTrip(tripId)) {
        if (order.status === 'assigned' || order.status === 'in_transit') {
          this.orders.setStatus(order.id, 'pending', { trip_id: null })
        }
      }
      this.vehicles.setStatus(trip.vehicle_id, 'available')
      this.drivers.setStatus(trip.driver_id, 'available')
    })
    tx()
    return this.getDetail(tripId)
  }

  updateCosts(tripId: number, data: TripInput): TripDetail {
    this.getDetail(tripId)
    this.trips.update(tripId, data)
    return this.getDetail(tripId)
  }

  // ---------- helpers ----------

  private assertOrderAssignable(order: OrderRow): void {
    if (order.status !== 'pending' || order.trip_id) {
      throw err.invalidState(`ออเดอร์ ${order.order_no} ไม่อยู่ในสถานะที่จัดคิวได้`)
    }
  }

  private requireAvailableVehicle(id: number): VehicleRow {
    const vehicle = this.vehicles.findById(id)
    if (!vehicle) throw err.notFound('ไม่พบรถคันนี้')
    if (vehicle.status !== 'available') throw err.invalidState(`รถ ${vehicle.plate_no} ไม่ว่าง (${vehicle.status})`)
    if (this.trips.hasActiveTrip(vehicle.id, 0)) throw err.invalidState(`รถ ${vehicle.plate_no} มีเที่ยวขนส่งที่ยังค้างอยู่`)
    return vehicle
  }

  private requireAvailableDriver(id: number): DriverRow {
    const driver = this.drivers.findById(id)
    if (!driver) throw err.notFound('ไม่พบพนักงานขับนี้')
    if (driver.status !== 'available') throw err.invalidState(`พนักงานขับ ${driver.name} ไม่ว่าง`)
    if (this.trips.hasActiveTrip(0, driver.id)) throw err.invalidState(`พนักงานขับ ${driver.name} มีเที่ยวขนส่งที่ยังค้างอยู่`)
    return driver
  }

  private requireStatus(tripId: number, statuses: TripStatus[]): TripRow {
    const trip = this.trips.findById(tripId)
    if (!trip) throw err.notFound('ไม่พบเที่ยวขนส่งนี้')
    if (!statuses.includes(trip.status)) {
      throw err.invalidState(`เที่ยว ${trip.trip_no} อยู่ในสถานะ "${trip.status}" ไม่สามารถดำเนินการนี้ได้`)
    }
    return trip
  }

  private groupOrdersByTrip(tripIds: number[]): Map<number, OrderRow[]> {
    const map = new Map<number, OrderRow[]>()
    for (const order of this.orders.listByTripIds(tripIds)) {
      if (!order.trip_id) continue
      const list = map.get(order.trip_id) ?? []
      list.push(order)
      map.set(order.trip_id, list)
    }
    return map
  }

  private toDetail(trip: TripRow, byTrip: Map<number, OrderRow[]>): TripDetail {
    const orders = (byTrip.get(trip.id) ?? []).filter((o) => o.status !== 'cancelled')
    return {
      ...trip,
      orders,
      total_weight: orders.reduce((s, o) => s + o.weight_kg, 0),
      total_fee: orders.reduce((s, o) => s + o.fee, 0),
      total_cost: trip.fuel_cost + trip.toll_cost + trip.other_cost,
    }
  }
}
