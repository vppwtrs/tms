import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../db/schema.js'
import { AuthService } from './auth.service.js'
import { AuthRepository } from './auth.repository.js'
import { AppError } from '../../core/errors.js'

/**
 * การลบบัญชีผู้ใช้ — จุดที่พังง่ายเพราะตารางอื่นอ้างถึง users อยู่หลายทาง
 *
 * เดิมทุกเคสตกไปถึง FK ของ SQLite แล้วเด้ง "ข้อมูลนี้ถูกใช้งานอยู่" เหมือนกันหมด
 * ทั้งที่บางกรณีลบได้ (แค่ต้องเคลียร์ created_by ก่อน) และบางกรณีลบไม่ได้จริง ๆ (POD)
 */
let db: Database.Database
let service: AuthService
let adminId: number
let targetId: number

function insertUser(username: string, role: string): number {
  return Number(
    db
      .prepare(`INSERT INTO users (username, password_hash, name, role) VALUES (?, 'x', ?, ?)`)
      .run(username, username, role).lastInsertRowid,
  )
}

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
  service = new AuthService(new AuthRepository(db))
  adminId = insertUser('admin', 'admin')
  insertUser('admin2', 'admin') // กันไม่ให้ติดกฎ "ต้องเหลือ admin อย่างน้อย 1 คน"
  targetId = insertUser('somchai', 'driver')
})

describe('AuthService.deleteUser', () => {
  it('ลบบัญชีที่ไม่มีประวัติได้', () => {
    service.deleteUser(targetId, adminId)
    expect(db.prepare(`SELECT id FROM users WHERE id = ?`).get(targetId)).toBeUndefined()
  })

  it('บัญชีที่ผูกกับพนักงานขับ ลบได้และคนขับยังอยู่ (แค่หลุดการผูก)', () => {
    const driverId = Number(
      db.prepare(`INSERT INTO drivers (name, user_id) VALUES ('สมชาย ใจดี', ?)`).run(targetId).lastInsertRowid,
    )
    service.deleteUser(targetId, adminId)
    const driver = db.prepare(`SELECT user_id FROM drivers WHERE id = ?`).get(driverId) as { user_id: number | null }
    expect(driver.user_id).toBeNull()
  })

  it('บัญชีที่เคยสร้างใบเสนอราคา ลบได้ โดยใบเสนอราคายังอยู่', () => {
    const customerId = Number(db.prepare(`INSERT INTO customers (name) VALUES ('ลูกค้า A')`).run().lastInsertRowid)
    db.prepare(
      `INSERT INTO quotes (quote_no, customer_id, origin, destination, goods_desc, distance_km, weight_kg, fee, created_by)
       VALUES ('QT-1', ?, 'กรุงเทพ', 'ชลบุรี', 'ของ', 100, 500, 5000, ?)`,
    ).run(customerId, targetId)

    service.deleteUser(targetId, adminId)
    const quote = db.prepare(`SELECT created_by FROM quotes WHERE quote_no = 'QT-1'`).get() as {
      created_by: number | null
    }
    expect(quote.created_by).toBeNull()
  })

  it('บัญชีที่เคยเก็บ POD ลบไม่ได้ และต้องบอกเหตุผลที่ทำต่อได้', () => {
    const orderId = Number(
      db
        .prepare(
          `INSERT INTO orders (order_no, origin, destination, goods_desc, weight_kg, scheduled_at, status)
           VALUES ('OD-1', 'กรุงเทพ', 'ชลบุรี', 'ของ', 100, datetime('now'), 'delivered')`,
        )
        .run().lastInsertRowid,
    )
    db.prepare(
      `INSERT INTO pod (order_id, recipient_name, signature_data, collected_by, collected_at)
       VALUES (?, 'คุณสมศรี', 'data:image/png;base64,x', ?, datetime('now'))`,
    ).run(orderId, targetId)

    try {
      service.deleteUser(targetId, adminId)
      expect.unreachable('ต้อง throw')
    } catch (e) {
      expect((e as AppError).status).toBe(400)
      // ข้อความต้องบอกทางออก ไม่ใช่แค่บอกว่าทำไม่ได้
      expect((e as AppError).message).toContain('ปิดบัญชี')
    }
    expect(db.prepare(`SELECT id FROM users WHERE id = ?`).get(targetId)).toBeTruthy()
  })

  it('ลบบัญชีตัวเองไม่ได้', () => {
    expect(() => service.deleteUser(adminId, adminId)).toThrow()
  })
})
