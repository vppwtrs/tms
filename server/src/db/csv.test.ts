import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrate } from './schema.js'
import { createCsvStore, CSV_TABLES, toCsv, parseCsv, type CsvStore } from './csv.js'

let db: Database.Database
let store: CsvStore
let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'))
  db = new Database(':memory:')
  migrate(db)
  db.prepare(`INSERT INTO users (username, password_hash, name, role) VALUES ('admin', 'x', 'ผู้ดูแล', 'admin')`).run()
  db.prepare(`INSERT INTO customers (name, segment) VALUES ('ลูกค้า A', 'VIP')`).run()
  db.prepare(`INSERT INTO customers (name, segment) VALUES ('ลูกค้า B', 'B')`).run()
  db.prepare(`INSERT INTO vehicles (plate_no, vehicle_type, capacity_kg) VALUES ('กท-1234', 'pickup', 1500)`).run()
  store = createCsvStore(db, dir)
})

const csvPath = (file: string): string => path.join(dir, file)

describe('CSV export layer — ข้อมูลจริงอยู่ที่ DB, ไฟล์เป็น export', () => {
  it('syncOnce ครั้งแรกเขียนไฟล์ CSV ครบทุกตาราง (มี header + ข้อมูล + BOM สำหรับ Excel)', () => {
    store.syncOnce()
    for (const def of CSV_TABLES) {
      expect(fs.existsSync(csvPath(def.file)), `ควรมีไฟล์ ${def.file}`).toBe(true)
    }
    const customers = fs.readFileSync(csvPath('01_customers.csv'), 'utf8')
    expect(customers.startsWith('\uFEFF')).toBe(true)
    const rows = parseCsv(customers)
    expect(rows[0]).toEqual(['id', 'name', 'contact_person', 'phone', 'email', 'address', 'segment', 'tax_id', 'credit_terms', 'tags', 'price_note', 'created_at'])
    expect(rows).toHaveLength(3) // header + 2 ลูกค้า
  })

  it('แก้ข้อมูลในเว็บ (DB) → syncOnce เขียนลงไฟล์ CSV อัตโนมัติ', () => {
    store.syncOnce()
    db.prepare(`UPDATE customers SET credit_terms = 45 WHERE id = 1`).run()
    db.prepare(`INSERT INTO customers (name, segment) VALUES ('ลูกค้า C', 'C')`).run()

    store.syncOnce()

    const after = fs.readFileSync(csvPath('01_customers.csv'), 'utf8')
    expect(after).toContain('45')
    expect(after).toContain('ลูกค้า C')
  })

  it('แก้ไฟล์ CSV จากภายนอก → ระบบไม่รับเข้ากลับ (จัดการที่หน้าเว็บเท่านั้น)', () => {
    store.syncOnce()
    // จำลองแก้ใน Excel: เปลี่ยนชื่อลูกค้า + เพิ่มแถวใหม่ในไฟล์
    const customers = fs.readFileSync(csvPath('01_customers.csv'), 'utf8')
    const edited = customers.replace('ลูกค้า A', 'ลูกค้า A (แก้ใน Excel)') + '\r\n,ลูกค้าใหม่,คุณใหม่,,,,C,,,,,2026-09-01 08:00:00\r\n'
    fs.writeFileSync(csvPath('01_customers.csv'), edited, 'utf8')

    store.syncOnce()
    store.syncOnce()

    // DB ไม่เปลี่ยนเลย — ไฟล์ถูกเขียนทับกลับเป็นข้อมูลจาก DB (ค่าเดิม)
    const rows = db.prepare(`SELECT name FROM customers ORDER BY id`).all() as { name: string }[]
    expect(rows.map((r) => r.name)).toEqual(['ลูกค้า A', 'ลูกค้า B'])
    const after = fs.readFileSync(csvPath('01_customers.csv'), 'utf8')
    expect(after).not.toContain('แก้ใน Excel')
    expect(after).not.toContain('ลูกค้าใหม่')
  })

  it('sync ซ้ำหลายรอบไม่มี loop (ข้อมูลไม่เปลี่ยน → ไฟล์ไม่ถูกเขียนทับซ้ำ)', () => {
    store.syncOnce()
    const before = fs.readFileSync(csvPath('01_customers.csv'), 'utf8')
    const mtime = fs.statSync(csvPath('01_customers.csv')).mtimeMs
    store.syncOnce()
    store.syncOnce()
    expect(fs.readFileSync(csvPath('01_customers.csv'), 'utf8')).toBe(before)
    expect(fs.statSync(csvPath('01_customers.csv')).mtimeMs).toBe(mtime)
  })

  it('exportAll เขียนทุกไฟล์ใหม่จากข้อมูลล่าสุด', () => {
    store.syncOnce()
    db.prepare(`INSERT INTO customers (name, segment) VALUES ('ลูกค้า D', 'A')`).run()
    const exported = store.exportAll()
    expect(exported).toHaveLength(CSV_TABLES.length)
    expect(fs.readFileSync(csvPath('01_customers.csv'), 'utf8')).toContain('ลูกค้า D')
  })

  it('resolveExportFile กัน path traversal — คืนไฟล์ที่ถูกต้องเท่านั้น', () => {
    store.syncOnce()
    const ok = store.resolveExportFile('05_orders.csv')
    expect(ok).toBeTruthy()
    expect(fs.existsSync(ok!)).toBe(true)
    expect(store.resolveExportFile('../../tms.db')).toBeNull()
    expect(store.resolveExportFile('secret.csv')).toBeNull()
    expect(store.resolveExportFile('')).toBeNull()
  })

  it('ข้อมูลที่มีเครื่องหมายจุลภาค/เครื่องหมายคำพูด/ขึ้นบรรทัดใหม่ เก็บใน CSV ได้ครบถ้วน', () => {
    db.prepare(`INSERT INTO customers (name, address) VALUES ('บริษัท เอ, บี "ซี" จำกัด', 'ถนนสาย 1\nต.เมือง')`).run()
    store.syncOnce()
    const raw = fs.readFileSync(csvPath('01_customers.csv'), 'utf8')
    expect(raw).toContain('"บริษัท เอ, บี ""ซี"" จำกัด"')
  })

  it('parseCsv รองรับ CRLF / LF / BOM และ quote ซ้อน', () => {
    const text = '\uFEFFa,b,c\r\n1,"x,y",3\n2,"พูด ""สวัสดี""",4'
    const rows = parseCsv(text)
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x,y', '3'],
      ['2', 'พูด "สวัสดี"', '4'],
    ])
    expect(toCsv(rows).startsWith('\uFEFF')).toBe(true)
  })
})
