import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../../db/schema.js'
import { InsightsService } from './insights.service.js'
import { InsightsRepository } from './insights.repository.js'

let db: Database.Database
let service: InsightsService

const DAY = 86400000
const iso = (msOffset: number): string => new Date(Date.now() + msOffset).toISOString()

function insertOrder(over: Partial<{ status: string; priority: string; scheduled_at: string; delivered_at: string; fee: number; customer_id: number | null; created_at: string }> = {}): void {
  db.prepare(
    `INSERT INTO orders (order_no, customer_id, origin, destination, goods_desc, weight_kg, fee, status, priority, scheduled_at, delivered_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `ORD-${Math.random().toString(36).slice(2, 10)}`,
    over.customer_id ?? null,
    'กรุงเทพฯ',
    'ชลบุรี',
    'สินค้าทดสอบ',
    100,
    over.fee ?? 1000,
    over.status ?? 'pending',
    over.priority ?? 'normal',
    over.scheduled_at ?? iso(DAY),
    over.delivered_at ?? null,
    over.created_at ?? new Date().toISOString(),
  )
}

function insertQuote(over: Partial<{ status: string; valid_until: string; customer_id: number | null }> = {}): void {
  db.prepare(
    `INSERT INTO quotes (quote_no, customer_id, origin, destination, goods_desc, weight_kg, fee, status, valid_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `QOT-${Math.random().toString(36).slice(2, 10)}`,
    over.customer_id ?? null,
    'กรุงเทพฯ',
    'ระยอง',
    'สินค้าทดสอบ',
    100,
    2000,
    over.status ?? 'sent',
    over.valid_until ?? null,
  )
}

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
  service = new InsightsService(new InsightsRepository(db))
})

describe('AI สรุปประจำวัน (insights)', () => {
  it('วันว่าง — สรุป calm ไม่มีรายการอันตราย', () => {
    const insight = service.daily()
    expect(insight.items.length).toBeGreaterThan(0)
    expect(insight.items.every((i) => i.tone !== 'danger')).toBe(true)
    expect(insight.items.some((i) => i.title === 'ทุกอย่างเป็นไปตามแผน')).toBe(true)
  })

  it('ออเดอร์เลยกำหนด + ด่วนค้าง → item อันตราย + headline ชี้ชัด', () => {
    insertOrder({ status: 'pending', priority: 'urgent', scheduled_at: iso(-DAY) })
    insertOrder({ status: 'pending', priority: 'normal', scheduled_at: iso(-2 * DAY) })
    insertOrder({ status: 'assigned', priority: 'normal', scheduled_at: iso(DAY) })

    const insight = service.daily()
    expect(insight.items.filter((i) => i.tone === 'danger').length).toBe(2)
    expect(insight.headline).toContain('เลยกำหนด')
    const overdue = insight.items.find((i) => i.title === 'ออเดอร์เลยกำหนด')
    expect(overdue?.detail).toContain('2 ใบ')
    const urgent = insight.items.find((i) => i.title === 'ออเดอร์ด่วนยังไม่จัดคิว')
    expect(urgent?.action?.to).toBe('/dispatch')
  })

  it('ใบเสนอราคาหมดอายุแล้ว vs ใกล้หมดอายุ — แยกโทน danger/warn', () => {
    insertQuote({ valid_until: iso(-DAY) }) // เลยมาแล้ว 1 วัน
    insertQuote({ valid_until: iso(2 * DAY) }) // เหลืออีก 2 วัน
    insertQuote({ valid_until: iso(10 * DAY) }) // ยังไกล

    const insight = service.daily()
    const expired = insight.items.find((i) => i.title === 'ใบเสนอราคาหมดอายุแล้ว')
    expect(expired?.tone).toBe('danger')
    expect(expired?.detail).toContain('1 ใบ')
    const soon = insight.items.find((i) => i.title === 'ใบเสนอราคาใกล้หมดอายุ')
    expect(soon?.tone).toBe('warn')
    expect(soon?.detail).toContain('2 วัน')
  })

  it('ลูกค้าเงียบเกิน 30 วัน → item เตือน', () => {
    const cid = Number(db.prepare(`INSERT INTO customers (name) VALUES ('ลูกค้าเงียบ')`).run().lastInsertRowid)
    insertOrder({ status: 'delivered', customer_id: cid, delivered_at: iso(0), scheduled_at: iso(-40 * DAY), created_at: iso(-40 * DAY) })

    const insight = service.daily()
    const item = insight.items.find((i) => i.title === 'ลูกค้าเงียบเกิน 30 วัน')
    expect(item?.tone).toBe('warn')
    expect(item?.detail).toContain('ลูกค้าเงียบ')
    expect(item?.action?.to).toBe('/customers')
  })

  it('ทรัพยากรแน่น (รถว่าง 1/4) → item เตือน', () => {
    for (let i = 0; i < 4; i++) {
      db.prepare(`INSERT INTO vehicles (plate_no, status) VALUES (?, ?)`).run(`กข-${i}`, i === 0 ? 'available' : 'on_trip')
    }
    const insight = service.daily()
    const item = insight.items.find((i) => i.title === 'ทรัพยากรกำลังแน่น')
    expect(item?.tone).toBe('warn')
    expect(item?.detail).toContain('รถว่าง 1/4')
  })

  it('ส่งสำเร็จวันนี้ → item สำเร็จ พร้อมยอดรายได้', () => {
    insertOrder({ status: 'delivered', fee: 5000, scheduled_at: iso(-DAY), delivered_at: iso(0) })
    const insight = service.daily()
    const item = insight.items.find((i) => i.title === 'ส่งสำเร็จวันนี้')
    expect(item?.tone).toBe('success')
    expect(item?.detail).toContain('1 เที่ยว')
    expect(item?.detail).toContain('5,000')
  })

  it('เรียงลำดับโทนสำคัญก่อน + จำกัดจำนวนไม่เกิน 6', () => {
    insertOrder({ status: 'pending', priority: 'urgent', scheduled_at: iso(-DAY) })
    insertQuote({ valid_until: iso(-DAY) })
    insertQuote({ valid_until: iso(2 * DAY) })
    const cid = Number(db.prepare(`INSERT INTO customers (name) VALUES ('ลูกค้าเงียบ')`).run().lastInsertRowid)
    insertOrder({ status: 'delivered', customer_id: cid, delivered_at: iso(0), scheduled_at: iso(-40 * DAY) })

    const insight = service.daily()
    expect(insight.items.length).toBeLessThanOrEqual(6)
    const first = insight.items[0]!
    expect(['danger', 'warn']).toContain(first.tone)
    // ลำดับโทนต้องไม่กลับ (danger มาก่อน info/success)
    const tones = insight.items.map((i) => i.tone)
    const order = { danger: 0, warn: 1, info: 2, success: 3 }
    for (let i = 1; i < tones.length; i++) {
      expect(order[tones[i]!]).toBeGreaterThanOrEqual(order[tones[i - 1]!])
    }
  })
})
