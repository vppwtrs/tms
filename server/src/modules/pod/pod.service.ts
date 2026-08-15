import fs from 'node:fs'
import path from 'node:path'
import { config } from '../../config.js'
import { err } from '../../core/errors.js'
import { nowIso } from '../../utils/helpers.js'
import { PodRepository, type PodInput, type PodRow } from './pod.repository.js'
import { OrdersRepository } from '../orders/orders.repository.js'

export interface CreatePodInput {
  order_id: number
  recipient_name: string
  signature_data: string
  notes?: string | null
  lat?: number | null
  lng?: number | null
  photo_path?: string | null
}

/**
 * กฎธุรกิจของ POD (หลักฐานการส่งมอบ):
 * 1. เก็บได้เฉพาะออเดอร์ที่ส่งสำเร็จ (delivered) เท่านั้น
 * 2. 1 ออเดอร์มี POD ได้ 1 ใบ
 * 3. แก้ไขได้เฉพาะสถานะ collected; เมื่อ verified แล้วล็อกถาวร (หลักฐานไม่แก้ย้อนหลัง)
 * 4. รูปหลักฐานเก็บเป็นไฟล์ใน server/data/pod/ — เปิดดูได้เฉพาะผู้ล็อกอินเท่านั้น
 */
export class PodService {
  constructor(
    private readonly repo: PodRepository,
    private readonly orders: OrdersRepository,
  ) {}

  getByOrderId(orderId: number): PodRow | null {
    return this.repo.findByOrderId(orderId) ?? null
  }

  getById(id: number): PodRow {
    const pod = this.repo.findById(id)
    if (!pod) throw err.notFound('ไม่พบ POD นี้')
    return pod
  }

  create(input: CreatePodInput, userId: number): PodRow {
    const order = this.orders.findById(input.order_id)
    if (!order) throw err.notFound('ไม่พบออเดอร์นี้')
    if (order.status !== 'delivered') {
      throw err.invalidState('เก็บ POD ได้เฉพาะออเดอร์ที่ส่งสำเร็จแล้ว')
    }
    if (this.repo.findByOrderId(input.order_id)) {
      throw err.conflict('ออเดอร์นี้มี POD อยู่แล้ว — แก้ไขผ่านรายละเอียดแทน')
    }
    if (!input.signature_data.startsWith('data:image/')) {
      throw err.badRequest('ลายเซ็นไม่ถูกต้อง (ต้องเป็นรูปภาพ)')
    }
    return this.repo.create({
      order_id: input.order_id,
      recipient_name: input.recipient_name,
      signature_data: input.signature_data,
      notes: input.notes,
      lat: input.lat,
      lng: input.lng,
      photo_path: input.photo_path,
      collected_by: userId,
      collected_at: nowIso(),
    })
  }

  /** แก้ไข POD — newPhotoFilename ระบุเมื่อมีการอัปโหลดรูปใหม่ (multer) */
  update(id: number, data: PodInput, newPhotoFilename: string | null | undefined = undefined): PodRow {
    const pod = this.getById(id)
    if (pod.status === 'verified') {
      throw err.invalidState('POD นี้ถูกยืนยันแล้ว ไม่สามารถแก้ไขได้ (หลักฐานถาวร)')
    }
    if (data.signature_data !== undefined && !data.signature_data.startsWith('data:image/')) {
      throw err.badRequest('ลายเซ็นไม่ถูกต้อง (ต้องเป็นรูปภาพ)')
    }
    // จัดการรูป: อัปโหลดใหม่ → เก็บชื่อใหม่และลบไฟล์เก่าหลังอัปเดต DB สำเร็จ
    let photoPath = pod.photo_path
    if (newPhotoFilename !== undefined) {
      photoPath = newPhotoFilename
    }
    const updated = this.repo.update(id, { ...data, photo_path: photoPath })
    if (!updated) throw err.notFound('ไม่พบ POD นี้')
    if (newPhotoFilename !== undefined && pod.photo_path && pod.photo_path !== newPhotoFilename) {
      PodService.deletePhoto(pod.photo_path)
    }
    return updated
  }

  verify(id: number): PodRow {
    const pod = this.getById(id)
    if (pod.status === 'verified') throw err.invalidState('POD นี้ถูกยืนยันแล้ว')
    const updated = this.repo.setStatus(id, 'verified')
    if (!updated) throw err.notFound('ไม่พบ POD นี้')
    return updated
  }

  /** path ของไฟล์รูปสำหรับส่งออก — ตรวจสอบว่ามีจริง + ป้องกัน path traversal */
  resolvePhoto(id: number): { absPath: string } {
    const pod = this.getById(id)
    if (!pod.photo_path) throw err.notFound('POD นี้ไม่มีรูปหลักฐาน')
    const absPath = path.join(config.podDir, path.basename(pod.photo_path))
    if (!fs.existsSync(absPath)) throw err.notFound('ไฟล์รูปหายไปจากระบบ')
    return { absPath }
  }

  /** เก็บไฟล์รูปจาก buffer (multer memory) → คืนชื่อไฟล์ */
  static savePhoto(buffer: Buffer, mimetype: string): string {
    fs.mkdirSync(config.podDir, { recursive: true })
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mimetype] ?? '.jpg'
    const filename = `pod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    fs.writeFileSync(path.join(config.podDir, filename), buffer)
    return filename
  }

  static deletePhoto(filename: string | null): void {
    if (!filename) return
    try {
      fs.unlinkSync(path.join(config.podDir, path.basename(filename)))
    } catch {
      /* ไฟล์อาจไม่มีอยู่แล้ว — ไม่เป็นไร */
    }
  }
}
