import { err } from '../../core/errors.js'
import { MyJobsRepository, type MyOrderRow, type MyTripRow } from './myjobs.repository.js'
import type { TripsService } from '../trips/trips.service.js'
import type { PodService, CreatePodInput } from '../pod/pod.service.js'

export interface MyJob extends MyTripRow {
  orders: MyOrderRow[]
  total_weight: number
}

/**
 * "งานของฉัน" — มุมมองของคนขับ
 *
 * ต่างจากโมดูลอื่นตรงที่ **ทุกเมธอดเริ่มจากการหาว่า user นี้คือคนขับคนไหน**
 * แล้วกรองด้วย driver_id เสมอ ไม่มีทางเรียกโดยไม่ระบุเจ้าของ
 *
 * กฎ:
 * 1. บัญชีต้องถูกผูกกับ drivers.user_id ก่อน ไม่งั้นใช้ไม่ได้ (ไม่ใช่ "เห็นทุกอย่าง")
 * 2. เริ่ม/จบได้เฉพาะเที่ยวของตัวเอง — เช็คเจ้าของก่อนเรียก TripsService เสมอ
 * 3. ตัวเลขเงินไม่ถูกส่งออกไปเลย (ไม่ได้ SELECT มาตั้งแต่ใน repository)
 */
export class MyJobsService {
  constructor(
    private readonly repo: MyJobsRepository,
    private readonly trips: TripsService,
    private readonly pod: PodService,
  ) {}

  /** แปลง user → driver · ข้อความบอกสาเหตุจริงเพื่อให้ผู้ดูแลแก้ถูกจุด */
  private driverIdOf(userId: number): number {
    const id = this.repo.findDriverIdByUser(userId)
    if (id === null) {
      throw err.forbidden('บัญชีนี้ยังไม่ได้ผูกกับพนักงานขับรถ — ให้ผู้ดูแลผูกที่หน้า "พนักงานขับ"')
    }
    return id
  }

  list(userId: number, includeDone = false): MyJob[] {
    const driverId = this.driverIdOf(userId)
    const trips = this.repo.listByDriver(driverId, includeDone)
    const orders = this.repo.ordersByTrips(trips.map((t) => t.id))
    return trips.map((t) => {
      const own = orders.filter((o) => o.trip_id === t.id)
      return { ...t, orders: own, total_weight: own.reduce((n, o) => n + o.weight_kg, 0) }
    })
  }

  private requireOwnTrip(userId: number, tripId: number): void {
    const driverId = this.driverIdOf(userId)
    if (!this.repo.tripBelongsTo(tripId, driverId)) {
      /* ตอบ 404 ไม่ใช่ 403 — บอกว่า "มีเที่ยวนี้อยู่แต่ไม่ใช่ของคุณ"
         ก็คือยอมให้เดาเลขเที่ยวของคนอื่นไปทีละใบ */
      throw err.notFound('ไม่พบเที่ยววิ่งนี้ในงานของคุณ')
    }
  }

  start(userId: number, tripId: number): MyJob {
    this.requireOwnTrip(userId, tripId)
    this.trips.start(tripId)
    return this.one(userId, tripId)
  }

  complete(userId: number, tripId: number): MyJob {
    this.requireOwnTrip(userId, tripId)
    this.trips.complete(tripId)
    return this.one(userId, tripId)
  }

  /** ปิดการส่งของจุดเดียวในเที่ยวตัวเอง — ทำให้เก็บ POD ที่หน้าร้านนั้นได้ทันที */
  deliverOrder(userId: number, orderId: number): MyJob {
    const driverId = this.driverIdOf(userId)
    if (!this.repo.orderBelongsTo(orderId, driverId)) {
      throw err.notFound('ไม่พบออเดอร์นี้ในงานของคุณ')
    }
    const { trip_id } = this.trips.deliverOrder(orderId)
    return this.one(userId, trip_id)
  }

  /** เก็บ POD ของออเดอร์ในเที่ยวตัวเอง — กฎธุรกิจอื่น ๆ ใช้ของ PodService เดิมทั้งหมด */
  createPod(userId: number, input: CreatePodInput): { ok: true } {
    const driverId = this.driverIdOf(userId)
    if (!this.repo.orderBelongsTo(input.order_id, driverId)) {
      throw err.notFound('ไม่พบออเดอร์นี้ในงานของคุณ')
    }
    this.pod.create(input, userId)
    return { ok: true }
  }

  private one(userId: number, tripId: number): MyJob {
    const job = this.list(userId, true).find((t) => t.id === tripId)
    if (!job) throw err.notFound('ไม่พบเที่ยววิ่งนี้ในงานของคุณ')
    return job
  }
}
