/**
 * แทน api/customers — รายชื่อลูกค้าสมมติให้ dropdown ของหน้าออเดอร์
 * ชื่อ/ที่อยู่แต่งขึ้น เบอร์ 02-000-xxxx ไม่มีใครใช้จริง
 * ที่ไม่ได้แทน re-export ของจริง (พาธ './../' กัน alias วน)
 */
import type { CustomerRow } from '../types/database.js'

export * from './../api/customers.js'

const c = (id: number, name: string, address: string): CustomerRow => ({
  id,
  name,
  address,
  phone: `02-000-000${id}`,
  contact_person: null,
  email: null,
  lat: null,
  lng: null,
  credit_terms: 30,
  price_note: null,
  segment: 'retail',
  tags: null,
  tax_id: null,
  created_at: '2026-01-01T00:00:00Z',
})

export const DEMO_CUSTOMERS: CustomerRow[] = [
  c(1, 'ร้านตัวอย่าง หนึ่ง', 'ถนนสมมติ 1 บางนา'),
  c(2, 'ร้านตัวอย่าง สอง', 'ถนนสมมติ 9 ประเวศ'),
  c(3, 'ร้านตัวอย่าง สาม', 'ถนนสมมติ 21 ลาดกระบัง'),
  c(4, 'ร้านตัวอย่าง สี่', 'ถนนสมมติ 4 สำโรง'),
  c(5, 'ร้านตัวอย่าง ห้า', 'ถนนสมมติ 5 บางพลี'),
  c(6, 'ร้านตัวอย่าง หก', 'ถนนสมมติ 6 ปากเกร็ด'),
  c(7, 'ร้านตัวอย่าง เจ็ด', 'ถนนสมมติ 7 มีนบุรี'),
  c(8, 'ร้านตัวอย่าง แปด', 'ถนนสมมติ 8 บางกะปิ'),
]

export async function listAllCustomers(): Promise<CustomerRow[]> {
  return DEMO_CUSTOMERS
}
