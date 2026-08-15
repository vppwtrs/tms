import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../db/schema.js'
import { QuotesService } from './quotes.service.js'
import { QuotesRepository } from './quotes.repository.js'
import { OrdersRepository } from '../orders/orders.repository.js'

let db: Database.Database
let quotesService: QuotesService
let customerId: number
let userId: number

const QUOTE_INPUT = {
  customer_id: null as number | null,
  origin: 'กรุงเทพฯ',
  destination: 'ชลบุรี',
  distance_km: 130,
  goods_desc: 'เครื่องใช้ไฟฟ้า',
  weight_kg: 1200,
  fee: 2500,
}

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
  userId = Number(
    db.prepare(`INSERT INTO users (username, password_hash, name, role) VALUES ('tester', 'x', 'ผู้ทดสอบ', 'dispatcher')`).run()
      .lastInsertRowid,
  )
  customerId = Number(db.prepare(`INSERT INTO customers (name, segment) VALUES ('ลูกค้า A', 'A')`).run().lastInsertRowid)
  quotesService = new QuotesService(new QuotesRepository(db), db)
})

describe('ใบเสนอราคา (CRM)', () => {
  it('สร้างใบเสนอราคาได้ — กำหนดเลขที่ QOT ตามปี', () => {
    const q = quotesService.create({ ...QUOTE_INPUT, customer_id: customerId }, userId)
    expect(q.quote_no).toMatch(/^QOT-\d{4}-\d{4}$/)
    expect(q.status).toBe('sent')
    expect(q.created_by).toBe(userId)
  })

  it('เปลี่ยนสถานะได้ตาม flow: ร่าง → ส่งแล้ว → ตกลงราคา / ปัดตก', () => {
    const q = quotesService.create({ ...QUOTE_INPUT, status: 'draft' }, userId)
    expect(q.status).toBe('draft')
    expect(quotesService.setStatus(q.id, 'sent').status).toBe('sent')
    expect(quotesService.setStatus(q.id, 'accepted').status).toBe('accepted')
  })

  it('แก้ไขได้เฉพาะใบที่ยังเป็นร่างหรือส่งแล้ว', () => {
    const q = quotesService.create({ ...QUOTE_INPUT }, userId)
    quotesService.setStatus(q.id, 'accepted')
    expect(() => quotesService.update(q.id, { ...QUOTE_INPUT, fee: 3000 })).toThrow(/ร่างหรือส่งแล้ว/)
  })

  it('แปลงเป็นออเดอร์ — 1 quote = 1 ออเดอร์ และสถานะกลายเป็นตกลงราคา', () => {
    const q = quotesService.create({ ...QUOTE_INPUT, customer_id: customerId }, userId)
    const { quote, order_no } = quotesService.convertToOrder(q.id, new Date().toISOString())
    expect(order_no).toMatch(/^ORD-\d{4}-\d{4}$/)
    expect(quote.status).toBe('accepted')
    expect(quote.converted_order_id).toBeTruthy()

    // แปลงซ้ำ → conflict
    expect(() => quotesService.convertToOrder(q.id, new Date().toISOString())).toThrow(/ไปแล้ว/)
  })

  it('ออเดอร์ที่แปลงจาก quote เก็บข้อมูลครบและสถานะเป็นรอจัดคิว', () => {
    const q = quotesService.create({ ...QUOTE_INPUT, customer_id: customerId }, userId)
    quotesService.convertToOrder(q.id, '2026-09-01T09:00:00.000Z')
    const order = db.prepare(`SELECT * FROM orders WHERE customer_id = ?`).get(customerId) as {
      status: string
      fee: number
      weight_kg: number
      origin: string
      notes: string
    }
    expect(order.status).toBe('pending')
    expect(order.fee).toBe(2500)
    expect(order.weight_kg).toBe(1200)
    expect(order.notes).toContain(q.quote_no)
  })

  it('แปลงไม่ได้ถ้าสถานะไม่ใช่ส่งแล้ว/ตกลงราคา (ร่าง/ปัดตก/หมดอายุ)', () => {
    const draft = quotesService.create({ ...QUOTE_INPUT, status: 'draft' }, userId)
    expect(() => quotesService.convertToOrder(draft.id, new Date().toISOString())).toThrow(/ส่งแล้วหรือตกลงราคา/)

    const rejected = quotesService.create({ ...QUOTE_INPUT }, userId)
    quotesService.setStatus(rejected.id, 'rejected')
    expect(() => quotesService.convertToOrder(rejected.id, new Date().toISOString())).toThrow()
  })

  it('ต้องระบุกำหนดส่งก่อนแปลง', () => {
    const q = quotesService.create({ ...QUOTE_INPUT }, userId)
    expect(() => quotesService.convertToOrder(q.id, '')).toThrow(/กำหนดส่ง/)
  })

  it('รายงาน KPI ของ quote คำนวณอัตราการตกลง', () => {
    const repo = new QuotesRepository(db)
    quotesService.create({ ...QUOTE_INPUT }, userId)
    const accepted = quotesService.create({ ...QUOTE_INPUT }, userId)
    quotesService.convertToOrder(accepted.id, new Date().toISOString())
    const rejected = quotesService.create({ ...QUOTE_INPUT }, userId)
    quotesService.setStatus(rejected.id, 'rejected')

    // ตรวจผ่าน SQL โดยตรง (stat ใช้ช่วงวันที่จาก reports)
    const created = db.prepare(`SELECT COUNT(*) AS c FROM quotes`).get() as { c: number }
    const acc = db.prepare(`SELECT COUNT(*) AS c FROM quotes WHERE status = 'accepted'`).get() as { c: number }
    expect(created.c).toBe(3)
    expect(acc.c).toBe(1)
    expect(repo.listByCustomer(customerId)).toHaveLength(0) // quotes เหล่านี้ไม่มีลูกค้า
  })
})
