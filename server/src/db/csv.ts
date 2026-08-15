import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { config } from '../config.js'

/**
 * CSV Export Layer — ข้อมูลจริงอยู่ที่ฐานข้อมูล (SQLite) จัดการผ่านหน้าเว็บ
 *
 * โฟลเดอร์ server/data/csv/ เป็น **ไฟล์ส่งออก (export) เท่านั้น**:
 *   - ระบบเขียน/รีเฟรชไฟล์ CSV ให้อัตโนมัติทุกครั้งที่ข้อมูลเปลี่ยน (เปิดใน Excel/วิเคราะห์ได้ตลอด)
 *   - หน้าเว็บดาวน์โหลดไฟล์เหล่านี้ได้
 *   - ❌ ระบบไม่รับข้อมูลจากไฟล์ CSV กลับเข้าร้าน — การแก้ข้อมูลต้องทำที่หน้าเว็บเท่านั้น (แหล่งเดียว = DB)
 *
 * ไม่รวม users/settings (รหัสผ่าน+การตั้งค่าระบบไม่ควรออกเป็นไฟล์ข้อมูล)
 */

export interface CsvTableDef {
  table: string
  file: string
  title: string
  description: string
}

/** ลำดับเรียงตามความสัมพันธ์ (ลูกค้า/รถ/คนขับ → เที่ยว → ออเดอร์ → POD/quote) เพื่อให้อ่านง่ายใน Excel */
export const CSV_TABLES: CsvTableDef[] = [
  { table: 'customers', file: '01_customers.csv', title: 'ลูกค้า', description: 'ข้อมูลลูกค้า + กลุ่ม (VIP/A/B/C) + เครดิต + แท็ก' },
  { table: 'vehicles', file: '02_vehicles.csv', title: 'รถยนต์', description: 'ทะเบียนรถ ยี่ห้อ ประเภท ขีดความจุ สถานะ' },
  { table: 'drivers', file: '03_drivers.csv', title: 'พนักงานขับ', description: 'ชื่อ เบอร์ติดต่อ ใบอนุญาต สถานะ วันที่เริ่มงาน' },
  { table: 'trips', file: '04_trips.csv', title: 'เที่ยวขนส่ง', description: 'แผนเที่ยว (รถ-คนขับ) ค่าใช้จ่าย สถานะ' },
  { table: 'orders', file: '05_orders.csv', title: 'ออเดอร์', description: 'งานขนส่ง: เส้นทาง น้ำหนัก ค่าโดยสาร สถานะ' },
  { table: 'pod', file: '06_pod.csv', title: 'หลักฐาน POD', description: 'หลักฐานส่งมอบ: ผู้รับ ลายเซ็น ตำแหน่ง GPS' },
  { table: 'quotes', file: '07_quotes.csv', title: 'ใบเสนอราคา', description: 'CRM: ใบเสนอราคา ราคา สถานะ วันหมดอายุ' },
  { table: 'customer_interactions', file: '08_interactions.csv', title: 'ประวัติติดต่อ', description: 'CRM: การติดต่อลูกค้า (โทร/อีเมล/ประชุม/LINE)' },
  { table: 'customer_tasks', file: '09_tasks.csv', title: 'งานติดตาม', description: 'CRM: งานติดตามลูกค้าที่ต้องทำ' },
]

export const AUTO_SYNC_MS = 3000

export function defaultCsvDir(): string {
  return path.resolve(path.dirname(config.dbPath), 'csv')
}

/* ================= CSV serialize / parse (RFC 4180 + รองรับภาษาไทย/Excel) ================= */

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"'
  return v
}

/** เขียนเป็น CSV — BOM + CRLF เพื่อให้ Excel เปิดภาษาไทยได้ถูกต้อง */
export function toCsv(rows: string[][]): string {
  if (rows.length === 0) return '\uFEFF\r\n'
  return '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

const sha1 = (s: string): string => crypto.createHash('sha1').update(s, 'utf8').digest('hex')

/* ================= สถานะ export ต่อตาราง ================= */

export interface CsvTableStatus {
  table: string
  file: string
  title: string
  description: string
  rows: number
  fileSize: number | null
  lastExport: string | null
  error: string | null
}

/* ================= CSV Store ================= */

export function createCsvStore(db: Database.Database, dir: string = defaultCsvDir()) {
  fs.mkdirSync(dir, { recursive: true })
  const state = new Map<string, { lastExport: string | null; error: string | null }>()

  const filePath = (def: CsvTableDef): string => path.join(dir, def.file)

  function columns(def: CsvTableDef): { name: string }[] {
    return db.prepare(`PRAGMA table_info(${def.table})`).all() as { name: string }[]
  }

  /** อ่านทุกแถวจากตาราง → เนื้อหา CSV (มี header + BOM) */
  function serializeTable(def: CsvTableDef): string {
    const cols = columns(def)
    const rows = db.prepare(`SELECT * FROM ${def.table} ORDER BY id`).all() as Record<string, unknown>[]
    const header = cols.map((c) => c.name)
    const body = rows.map((r) => cols.map((c) => (r[c.name] === null || r[c.name] === undefined ? '' : String(r[c.name]))))
    return toCsv([header, ...body])
  }

  function readFileHash(def: CsvTableDef): string | null {
    try {
      return sha1(fs.readFileSync(filePath(def), 'utf8'))
    } catch {
      return null
    }
  }

  /**
   * เขียนตารางลงไฟล์ CSV — เขียนเมื่อไฟล์บนดิสก์ไม่ตรงกับข้อมูลใน DB
   * (ครอบคลุมทั้ง: ข้อมูลเปลี่ยนในเว็บ, และไฟล์ถูกแก้/ลบจากภายนอก → เขียนทับกลับเป็นข้อมูลจริง)
   */
  function exportTable(def: CsvTableDef): { wrote: boolean; rows: number; size: number } {
    const content = serializeTable(def)
    const dbHash = sha1(content)
    const st = state.get(def.table)!
    const rows = db.prepare(`SELECT COUNT(*) AS c FROM ${def.table}`).get() as { c: number }
    if (readFileHash(def) === dbHash) return { wrote: false, rows: rows.c, size: statSize(def) }
    fs.writeFileSync(filePath(def), content, 'utf8')
    st.lastExport = new Date().toISOString()
    st.error = null
    return { wrote: true, rows: rows.c, size: Buffer.byteLength(content, 'utf8') }
  }

  function statSize(def: CsvTableDef): number {
    try {
      return fs.statSync(filePath(def)).size
    } catch {
      return 0
    }
  }

  /** ตรวจสอบครั้งเดียว: ไฟล์ export ต้องตรงกับข้อมูลใน DB เสมอ (ทิศเดียว DB → CSV) */
  function syncOnce(): void {
    for (const def of CSV_TABLES) {
      try {
        exportTable(def)
      } catch (e) {
        state.get(def.table)!.error = e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการเขียนไฟล์'
      }
    }
  }

  /** เขียนทุกตารางลงไฟล์ (บังคับ) */
  function exportAll(): { file: string; rows: number; size: number }[] {
    const out: { file: string; rows: number; size: number }[] = []
    for (const def of CSV_TABLES) {
      const r = exportTable(def)
      out.push({ file: def.file, rows: r.rows, size: r.size })
    }
    return out
  }

  function status(): CsvTableStatus[] {
    return CSV_TABLES.map((def) => {
      const st = state.get(def.table)!
      const rows = db.prepare(`SELECT COUNT(*) AS c FROM ${def.table}`).get() as { c: number }
      return {
        table: def.table,
        file: def.file,
        title: def.title,
        description: def.description,
        rows: rows.c,
        fileSize: statSize(def),
        lastExport: st.lastExport,
        error: st.error,
      }
    })
  }

  /** หาไฟล์ export ที่ถูกต้อง (ตรวจชื่อกับรายการ whitelist — กัน path traversal) */
  function resolveExportFile(fileName: string): string | null {
    const def = CSV_TABLES.find((d) => d.file === fileName)
    if (!def) return null
    const p = filePath(def)
    return fs.existsSync(p) ? p : null
  }

  // เริ่มต้น state ทุกตาราง — อัปเดตล่าสุด = เวลาที่ไฟล์ถูกเขียนจริง (mtime) ถ้าไฟล์มีอยู่แล้ว
  for (const def of CSV_TABLES) {
    const st = { lastExport: null as string | null, error: null as string | null }
    try {
      st.lastExport = fs.statSync(filePath(def)).mtime.toISOString()
    } catch {
      /* ยังไม่มีไฟล์ */
    }
    state.set(def.table, st)
  }

  return { syncOnce, exportAll, status, resolveExportFile, dir }
}

export type CsvStore = ReturnType<typeof createCsvStore>

let timer: NodeJS.Timeout | null = null

/** เริ่ม auto-export (ทุก AUTO_SYNC_MS ms) — คืนฟังก์ชันหยุด */
export function startCsvSync(store: CsvStore): () => void {
  store.syncOnce()
  if (timer) clearInterval(timer)
  timer = setInterval(() => store.syncOnce(), AUTO_SYNC_MS)
  timer.unref?.()
  return () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
}
