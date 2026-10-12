/**
 * อ่านไฟล์ LOCK-DO (รถ lock ที่ถูกตัดออกจากระบบไปแล้ว) เพื่อพิมพ์ฉลากย้อนหลัง
 *
 * รูปแบบไฟล์ตาม template ของทีม TRS — หนึ่งแถวต่อรถหนึ่งคัน (มีเลขตัวถัง)
 * ใช้พิมพ์อย่างเดียว ไม่เขียนลงฐาน — รถพวกนี้ไม่มีใบงานในระบบแล้ว
 * หัวคอลัมน์จับด้วยชื่อ ไม่ใช่ตำแหน่ง คนกรอกสลับคอลัมน์ได้โดยไม่พัง
 */
import type { LabelSource } from './storeLabel'
import { fmtDate } from './format'

export interface DoLockRow {
  /** เลขแถวใน Excel — ใช้บอกคนกรอกว่าแถวไหนผิด */
  row: number
  chassis: string
  pl: string
  /** วันที่ตัดจ่าย แสดงแบบเดียวกับฉลากจากระบบ */
  date: string
  store: string
  itemNo: string
  model: string
  qty: number
  /** ประเภทรถจากไฟล์ (DO-Lock, New, Claim …) — ขึ้นในกรอบเลขทริปของฉลาก */
  kind: string
  errors: string[]
}

/** ใช้เมื่อช่องประเภทรถว่าง — รถพวกนี้ไม่มีเที่ยว กรอบเลขทริปจึงขึ้นประเภทรถแทน */
export const DO_LOCK_TRIP = 'DO-LOCK'

const COLS = {
  chassis: /^เลขตัวถัง/,
  itemNo: /^รหัสสินค้า/,
  model: /^รุ่นรถ/,
  qty: /^จำนวน/,
  pl: /^PL$/i,
  store: /^ร้าน/,
  date: /^วันที่ตัดจ่าย/,
  kind: /^ประเภทรถ/,
} as const
type Col = keyof typeof COLS
/* ฉลากใช้แค่ ร้าน + ประเภทรถ + จำนวน — ที่เหลือ (PL รุ่น วันที่ …) ไฟล์มีหรือไม่มีก็ได้
   ประเภทรถว่างใช้ DO-LOCK จำนวนว่างนับ 1 คัน วันที่ว่างไม่พิมพ์วันที่ (วันพิมพ์ไม่ใช่วันตัดจ่าย) */
const REQUIRED: [Col, string][] = [['store', 'ร้าน']]

/** ไฟล์ TRS ใส่ปี พ.ศ. ลงในช่องวันที่ของ Excel ตรง ๆ (2569-09-26) — ปีเกิน 2400 ถือเป็น พ.ศ. */
function toIso(v: unknown): string | null {
  let d: Date | null = null
  if (v instanceof Date) d = v
  else {
    const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m) d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])))
  }
  if (!d || Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  return new Date(Date.UTC(y > 2400 ? y - 543 : y, d.getUTCMonth(), d.getUTCDate(), 12)).toISOString()
}

const text = (v: unknown): string => {
  if (v && typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text).trim()
  if (v && typeof v === 'object' && 'result' in v) return String((v as { result: unknown }).result ?? '').trim()
  return String(v ?? '').trim()
}

/** แถวแรกคือหัวตาราง แถวที่ว่างทั้งแถวข้าม */
export function parseDoLock(grid: unknown[][]): { rows: DoLockRow[]; missingCols: string[] } {
  const head = (grid[0] ?? []).map((h) => text(h))
  const idx = {} as Record<Col, number>
  for (const k of Object.keys(COLS) as Col[]) idx[k] = head.findIndex((h) => COLS[k].test(h))
  const missingCols = REQUIRED.filter(([k]) => idx[k] < 0).map(([, n]) => n)
  if (missingCols.length) return { rows: [], missingCols }

  const rows: DoLockRow[] = []
  grid.slice(1).forEach((r, i) => {
    if (r.every((c) => text(c) === '')) return
    const get = (k: Col): unknown => (idx[k] >= 0 ? r[idx[k]] : '')
    const rawDate = get('date')
    const iso = toIso(rawDate)
    /* จำนวนว่าง = 1 คัน — ไฟล์ TRS เป็นแถวละคันอยู่แล้ว */
    const qty = text(get('qty')) === '' ? 1 : Number(text(get('qty')))
    const row: DoLockRow = {
      row: i + 2,
      chassis: text(get('chassis')),
      pl: text(get('pl')),
      date: iso ? fmtDate(iso) : '',
      store: text(get('store')),
      itemNo: text(get('itemNo')),
      model: text(get('model')),
      qty: Number.isInteger(qty) ? qty : 0,
      kind: text(get('kind')).toUpperCase(),
      errors: [],
    }
    for (const [k, name] of REQUIRED) if (!row[k]) row.errors.push(`ขาด${name}`)
    if (text(rawDate) && !iso) row.errors.push('วันที่ผิดรูปแบบ')
    if (row.qty < 1 || row.qty > 999) row.errors.push('จำนวนต้องเป็น 1–999')
    rows.push(row)
  })
  return { rows, missingCols }
}

/** จัดแถวเป็นก้อนตามประเภทรถ + วันที่ตัดจ่าย แล้วแยกร้าน — เลขนับบนฉลาก (1/n) นับต่อร้านในก้อนเดียวกัน */
export function doLockLabelGroups(rows: DoLockRow[]): { tripNo: string; date: string; stores: LabelSource[] }[] {
  const groups = new Map<string, { tripNo: string; date: string; stores: Map<string, LabelSource> }>()
  for (const r of rows) {
    const tripNo = r.kind || DO_LOCK_TRIP
    const key = `${tripNo}|${r.date}`
    let g = groups.get(key)
    if (!g) { g = { tripNo, date: r.date, stores: new Map() }; groups.set(key, g) }
    let s = g.stores.get(r.store)
    if (!s) { s = { store: r.store, address: '', rows: [] }; g.stores.set(r.store, s) }
    s.rows.push({
      pl: r.pl, orderNo: r.pl, goods: r.model, units: r.qty, kind: 'vehicle',
      items: [{ item_no: r.itemNo, item_name: r.model, qty: r.qty }],
    })
  }
  return [...groups.values()].map((g) => ({ tripNo: g.tripNo, date: g.date, stores: [...g.stores.values()] }))
}
