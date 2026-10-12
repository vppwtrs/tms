import { describe, expect, it } from 'vitest'
import { DO_LOCK_TRIP, doLockLabelGroups, parseDoLock } from './doLockImport'
import { buildLabels } from './storeLabel'

/* หัวคอลัมน์ตาม template ของทีม TRS */
const HEAD = ['เลขตัวถัง', 'เลขเครื่อง', 'รหัสสินค้า', 'รุ่นรถ', 'จำนวน', 'Location', 'PL', 'ร้าน', 'ประเภทรถ', 'สถานะรถ', 'วันที่ตัดจ่าย', 'วันที่ประมาณซ่อมเสร็จ', 'Aging Days', 'SALE AREA', 'Remark']
const row = (chassis: string, item: string, model: string, qty: unknown, pl: string, store: string, date: unknown, kind = 'DO-Lock'): unknown[] =>
  [chassis, 'MD1', item, model, qty, 'A-03-03', pl, store, kind, 'Good', date, '', 13, 'UPC5', '']

describe('parseDoLock', () => {
  it('ปี พ.ศ. ในช่องวันที่ของ Excel แปลงถูก', () => {
    const { rows, missingCols } = parseDoLock([HEAD, row('RP8', 'GTV300', 'GTV 300', 1, 'PL1', 'ร้าน A', new Date(Date.UTC(2569, 8, 26)))])
    expect(missingCols).toEqual([])
    expect(rows[0]).toMatchObject({ row: 2, chassis: 'RP8', pl: 'PL1', qty: 1, errors: [] })
    expect(rows[0]?.date).toContain('2569')
    expect(rows[0]?.date).toContain('26')
  })
  it('แถวขาดข้อมูลถูกติดธง แถวว่างข้าม', () => {
    const { rows } = parseDoLock([HEAD, HEAD.map(() => ''), row('RP9', 'X', '', 0, 'PL2', '', 'xx')])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.errors).toEqual(['ขาดร้าน', 'วันที่ผิดรูปแบบ', 'จำนวนต้องเป็น 1–999'])
  })
  it('บอกคอลัมน์ที่หายไป', () => {
    expect(parseDoLock([['PL', 'ประเภทรถ']]).missingCols).toEqual(['ร้าน'])
  })
  it('ไฟล์ที่เหลือแค่ PL / ร้าน / ประเภทรถ ก็พิมพ์ได้', () => {
    const { rows } = parseDoLock([HEAD, [null, null, null, null, null, null, 'PL1', 'ร้าน A', 'DO-Lock']])
    expect(rows[0]).toMatchObject({ qty: 1, kind: 'DO-LOCK', date: '', errors: [] })
    const [g] = doLockLabelGroups(rows)
    expect(buildLabels(g!.tripNo, g!.date, g!.stores).units).toHaveLength(1)
  })
})

describe('doLockLabelGroups', () => {
  it('รวมรถร้านเดียวกันในวันเดียวกัน นับ 1/n ต่อร้าน', () => {
    const d = new Date(Date.UTC(2569, 8, 26))
    const { rows } = parseDoLock([HEAD,
      row('A1', 'GTV300 B', 'GTV BEIGE', 1, 'PL1', 'ร้าน A', d),
      row('A2', 'GTV300 W', 'GTV WHITE', 1, 'PL1', 'ร้าน A', d)])
    const [g] = doLockLabelGroups(rows)
    expect(g?.tripNo).toBe('DO-LOCK')
    const { units } = buildLabels(g!.tripNo, g!.date, g!.stores)
    expect(units.map((u) => `${u.index}/${u.total} ${u.pl}`)).toEqual(['1/2 PL1', '2/2 PL1'])
  })

  it('กรอบเลขทริปขึ้นประเภทรถ แยกก้อนตามประเภท ว่างใช้ DO-LOCK', () => {
    const d = new Date(Date.UTC(2569, 8, 26))
    const { rows } = parseDoLock([HEAD,
      row('A1', 'X', 'GTV', 1, 'PL1', 'ร้าน A', d, 'New'),
      row('A2', 'X', 'GTV', 1, 'PL1', 'ร้าน A', d, 'Claim'),
      row('A3', 'X', 'GTV', 1, 'PL1', 'ร้าน A', d, '')])
    expect(doLockLabelGroups(rows).map((g) => g.tripNo)).toEqual(['NEW', 'CLAIM', DO_LOCK_TRIP])
  })

  it('ไฟล์เหลือแค่ ร้าน + จำนวน + ประเภทรถ ก็พิมพ์ได้', () => {
    const { rows } = parseDoLock([['จำนวน', 'ร้าน', 'ประเภทรถ'], [2, 'ร้าน A', 'New']])
    expect(rows[0]?.errors).toEqual([])
    const [g] = doLockLabelGroups(rows)
    expect(g?.tripNo).toBe('NEW')
    expect(g?.date).toBe('')
    expect(buildLabels(g!.tripNo, g!.date, g!.stores).units).toHaveLength(2)
  })
})
