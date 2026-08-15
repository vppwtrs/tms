import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { SignJWT } from 'jose'
import { createApp } from '../../app.js'
import { config } from '../../config.js'
import { migrate } from '../../db/schema.js'

/**
 * เทสระดับ HTTP จริงของ endpoint ที่คนขับใช้ส่ง POD
 *
 * ต้องยิงผ่าน HTTP จริง (ไม่ใช่เรียก service ตรง ๆ) เพราะสิ่งที่ต้องพิสูจน์คือ
 * multer แยกไฟล์ออกจาก field ได้ถูกและ zod ยังตรวจ field ที่มาแบบ multipart ผ่าน
 * — สองอย่างนี้เป็น middleware ล้วน unit test ของ service มองไม่เห็น
 */
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo='
/** JPEG 1x1 พิกเซลจริง — multer ตรวจ mimetype จากที่ client ประกาศ แต่ให้ไฟล์สมจริงไว้ก่อน */
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
)

let db: Database.Database
let server: http.Server
let base: string
let token: string
let orderId: number
let tripId: number
let podDir: string
let originalPodDir: string

async function makeToken(userId: number): Promise<string> {
  return await new SignJWT({ username: 'driver1', name: 'สมชาย ใจดี', role: 'driver' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(config.jwtSecret))
}

beforeEach(async () => {
  // เก็บรูปลงโฟลเดอร์ชั่วคราว ไม่ปนกับของจริงใน server/data/pod
  podDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-pod-test-'))
  originalPodDir = config.podDir
  ;(config as { podDir: string }).podDir = podDir

  db = new Database(':memory:')
  migrate(db)

  const userId = Number(
    db.prepare(`INSERT INTO users (username, password_hash, name, role) VALUES ('driver1', 'x', 'สมชาย ใจดี', 'driver')`).run()
      .lastInsertRowid,
  )
  const driverId = Number(
    db.prepare(`INSERT INTO drivers (name, status, user_id) VALUES ('สมชาย ใจดี', 'available', ?)`).run(userId).lastInsertRowid,
  )
  const vehicleId = Number(
    db.prepare(`INSERT INTO vehicles (plate_no, vehicle_type, capacity_kg, status) VALUES ('กท-9999', 'truck6', 5000, 'available')`).run()
      .lastInsertRowid,
  )
  tripId = Number(
    db
      .prepare(`INSERT INTO trips (trip_no, vehicle_id, driver_id, status) VALUES ('TR-TEST-1', ?, ?, 'in_progress')`)
      .run(vehicleId, driverId).lastInsertRowid,
  )
  orderId = Number(
    db
      .prepare(
        `INSERT INTO orders (order_no, origin, destination, goods_desc, weight_kg, scheduled_at, status, trip_id)
         VALUES ('OD-TEST-1', 'กรุงเทพ', 'ชลบุรี', 'สินค้าทดสอบ', 100, datetime('now'), 'delivered', ?)`,
      )
      .run(tripId).lastInsertRowid,
  )

  token = await makeToken(userId)
  server = http.createServer(createApp(db))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  db.close()
  fs.rmSync(podDir, { recursive: true, force: true })
  ;(config as { podDir: string }).podDir = originalPodDir
})

/**
 * เที่ยวหนึ่งมีหลายร้าน และ POD ต้องเก็บที่หน้าร้านทีละร้าน
 * เทสชุดนี้ยึดเงื่อนไขนั้นไว้: ต้องปิดจุดเดียวได้โดยเที่ยวยังวิ่งต่อ
 */
describe('POST /api/my-jobs/orders/:id/deliver', () => {
  /** เพิ่มจุดส่งที่ยังไม่ถึงเข้าไปในเที่ยวเดียวกัน */
  function addStop(orderNo: string, dest: string): number {
    return Number(
      db
        .prepare(
          `INSERT INTO orders (order_no, origin, destination, goods_desc, weight_kg, scheduled_at, status, trip_id)
           VALUES (?, 'กรุงเทพ', ?, 'สินค้าทดสอบ', 100, datetime('now'), 'in_transit', ?)`,
        )
        .run(orderNo, dest, tripId).lastInsertRowid,
    )
  }

  const deliver = (id: number): Promise<Response> =>
    fetch(`${base}/api/my-jobs/orders/${id}/deliver`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

  it('ปิดจุดเดียวได้ โดยเที่ยวยังวิ่งต่อและจุดอื่นไม่ถูกแตะ', async () => {
    const a = addStop('OD-STOP-A', 'ชลบุรี')
    const b = addStop('OD-STOP-B', 'ระยอง')

    const res = await deliver(a)
    expect(res.status).toBe(200)

    const rows = db.prepare(`SELECT id, status, delivered_at FROM orders WHERE id IN (?, ?)`).all(a, b) as {
      id: number
      status: string
      delivered_at: string | null
    }[]
    expect(rows.find((r) => r.id === a)?.status).toBe('delivered')
    expect(rows.find((r) => r.id === a)?.delivered_at).toBeTruthy()
    expect(rows.find((r) => r.id === b)?.status).toBe('in_transit')
    expect((db.prepare(`SELECT status FROM trips WHERE id = ?`).get(tripId) as { status: string }).status).toBe(
      'in_progress',
    )
  })

  it('เก็บ POD ของร้านนั้นได้ทันทีหลังปิดจุด ไม่ต้องรอปิดทั้งเที่ยว', async () => {
    const a = addStop('OD-STOP-A', 'ชลบุรี')
    addStop('OD-STOP-B', 'ระยอง')
    await deliver(a)

    const res = await fetch(`${base}/api/my-jobs/pod`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ order_id: a, recipient_name: 'คุณสมศรี', signature_data: SIGNATURE }),
    })
    expect(res.status).toBe(201)
  })

  it('ปิดจุดเดิมซ้ำตอบ 409 ไม่ใช่เขียนทับเวลาส่งของเดิม', async () => {
    const a = addStop('OD-STOP-A', 'ชลบุรี')
    await deliver(a)
    const before = (db.prepare(`SELECT delivered_at FROM orders WHERE id = ?`).get(a) as { delivered_at: string })
      .delivered_at

    const res = await deliver(a)
    expect(res.status).toBe(409)
    expect((db.prepare(`SELECT delivered_at FROM orders WHERE id = ?`).get(a) as { delivered_at: string }).delivered_at).toBe(
      before,
    )
  })

  it('ออเดอร์ของคนขับคนอื่นตอบ 404', async () => {
    const foreign = Number(
      db
        .prepare(
          `INSERT INTO orders (order_no, origin, destination, goods_desc, weight_kg, scheduled_at, status)
           VALUES ('OD-FOREIGN', 'กรุงเทพ', 'ภูเก็ต', 'ของคนอื่น', 50, datetime('now'), 'in_transit')`,
        )
        .run().lastInsertRowid,
    )
    expect((await deliver(foreign)).status).toBe(404)
  })

  it('ปิดทั้งเที่ยวทีหลังต้องไม่เขียนทับเวลาส่งของของจุดที่ปิดไปแล้ว', async () => {
    const a = addStop('OD-STOP-A', 'ชลบุรี')
    const b = addStop('OD-STOP-B', 'ระยอง')
    await deliver(a)
    const aTime = (db.prepare(`SELECT delivered_at FROM orders WHERE id = ?`).get(a) as { delivered_at: string })
      .delivered_at

    const res = await fetch(`${base}/api/my-jobs/${tripId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)

    /* เวลาของจุดแรกต้องเป็นเวลาที่ส่งจริง ไม่ใช่เวลาที่ปิดเที่ยว
       ไม่งั้นรายงานตรงต่อเวลาของทุกร้านจะกลายเป็นเวลาเดียวกันหมด */
    expect((db.prepare(`SELECT delivered_at FROM orders WHERE id = ?`).get(a) as { delivered_at: string }).delivered_at).toBe(
      aTime,
    )
    expect((db.prepare(`SELECT status FROM orders WHERE id = ?`).get(b) as { status: string }).status).toBe('delivered')
  })
})

describe('POST /api/my-jobs/pod', () => {
  it('รับ POD แบบ JSON ได้เหมือนเดิม (ไม่มีรูป)', async () => {
    const res = await fetch(`${base}/api/my-jobs/pod`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ order_id: orderId, recipient_name: 'คุณสมศรี', signature_data: SIGNATURE }),
    })
    expect(res.status).toBe(201)
    const pod = db.prepare(`SELECT photo_path FROM pod WHERE order_id = ?`).get(orderId) as { photo_path: string | null }
    expect(pod.photo_path).toBeNull()
  })

  it('รับรูปที่คนขับถ่ายหน้างานแบบ multipart แล้วเขียนไฟล์ลงดิสก์', async () => {
    const form = new FormData()
    form.append('order_id', String(orderId))
    form.append('recipient_name', 'คุณสมศรี')
    form.append('signature_data', SIGNATURE)
    form.append('photo', new Blob([JPEG_1PX as unknown as ArrayBufferView], { type: 'image/jpeg' }), 'pod.jpg')

    const res = await fetch(`${base}/api/my-jobs/pod`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    expect(res.status).toBe(201)

    const pod = db.prepare(`SELECT photo_path FROM pod WHERE order_id = ?`).get(orderId) as { photo_path: string | null }
    expect(pod.photo_path).toMatch(/^pod-.*\.jpg$/)
    expect(fs.existsSync(path.join(podDir, pod.photo_path!))).toBe(true)
  })

  it('ไฟล์ที่ไม่ใช่รูปถูกปฏิเสธด้วย 400 ไม่ใช่ 500', async () => {
    const form = new FormData()
    form.append('order_id', String(orderId))
    form.append('recipient_name', 'คุณสมศรี')
    form.append('signature_data', SIGNATURE)
    form.append('photo', new Blob(['not an image'], { type: 'application/pdf' }), 'bad.pdf')

    const res = await fetch(`${base}/api/my-jobs/pod`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    expect(res.status).toBe(400)
  })

  it('ออเดอร์ที่ไม่ใช่ของคนขับคนนี้ ต้องไม่ทิ้งไฟล์รูปค้างไว้', async () => {
    const otherOrderId = Number(
      db
        .prepare(
          `INSERT INTO orders (order_no, origin, destination, goods_desc, weight_kg, scheduled_at, status)
           VALUES ('OD-TEST-2', 'กรุงเทพ', 'ระยอง', 'ของคนอื่น', 50, datetime('now'), 'delivered')`,
        )
        .run().lastInsertRowid,
    )
    const form = new FormData()
    form.append('order_id', String(otherOrderId))
    form.append('recipient_name', 'คุณสมศรี')
    form.append('signature_data', SIGNATURE)
    form.append('photo', new Blob([JPEG_1PX as unknown as ArrayBufferView], { type: 'image/jpeg' }), 'pod.jpg')

    const res = await fetch(`${base}/api/my-jobs/pod`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    expect(res.status).toBe(404)
    // รูปถูกเขียนลงดิสก์ไปก่อนแล้ว ต้องถูกลบทิ้งเมื่อกฎธุรกิจไม่ผ่าน
    expect(fs.readdirSync(podDir)).toHaveLength(0)
  })
})
