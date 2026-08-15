import { describe, expect, it } from 'vitest'
import { buildXlsx, zipStore } from './xlsx.js'

describe('xlsx writer (ไร้ dependency)', () => {
  it('สร้างไฟล์ที่ขึ้นต้นด้วย zip signature (PK + 0x04034b50)', () => {
    const buf = buildXlsx([{ name: 'สรุป', rows: [['หัว', 'ค่า'], ['ออเดอร์', 10]] }])
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(buf.toString('latin1', 2, 4)).toBe('\u0003\u0004')
  })

  it('มีส่วนประกอบครบ: Content_Types, workbook, sheet XML', () => {
    const buf = buildXlsx([{ name: 'สรุป', rows: [['ชื่อ', 1]] }])
    const text = buf.toString('utf8')
    expect(text).toContain('[Content_Types].xml')
    expect(text).toContain('xl/workbook.xml')
    expect(text).toContain('xl/worksheets/sheet1.xml')
    expect(text).toContain('สรุป')
  })

  it('ตัวเลขเป็นตัวเลขจริง ข้อความเป็น inlineStr', () => {
    const buf = buildXlsx([{ name: 's1', rows: [['ชื่อ', 'ค่า'], ['ชลบุรี', 130]] }])
    const text = buf.toString('utf8')
    expect(text).toContain('t="inlineStr"')
    expect(text).toContain('<v>130</v>')
  })

  it('escape XML ในข้อความ (<, >, &)', () => {
    const buf = buildXlsx([{ name: 's1', rows: [['A & B <C>']] }])
    expect(buf.toString('utf8')).toContain('A &amp; B &lt;C&gt;')
  })

  it('ชื่อชีตซ้ำกัน → ต่อท้ายเลขไม่ให้ชน', () => {
    const buf = buildXlsx([
      { name: 'ซ้ำ', rows: [['a']] },
      { name: 'ซ้ำ', rows: [['b']] },
    ])
    const text = buf.toString('utf8')
    expect(text).toContain('name="ซ้ำ"')
    expect(text).toContain('name="ซ้ำ2"')
  })

  it('zip STORE: มี central directory + EOCD ครบตาม spec', () => {
    const buf = zipStore([{ name: 'a.txt', data: Buffer.from('hello') }])
    const text = buf.toString('latin1')
    expect(text).toContain('\u0050\u004b\u0001\u0002') // central directory signature
    expect(text).toContain('\u0050\u004b\u0005\u0006') // EOCD signature
  })

  it('มี styles.xml พร้อมสไตล์หัวตาราง (หนา+พื้น) และเส้นขอบ', () => {
    const buf = buildXlsx([
      {
        name: 'ฟอร์ม',
        headerRow: true,
        borders: true,
        rows: [
          ['รายการ', 'น้ำหนัก'],
          ['สินค้า ก', 100],
        ],
      },
    ])
    const text = buf.toString('utf8')
    expect(text).toContain('xl/styles.xml')
    expect(text).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml')
    // แถวหัว (แถว 1) ได้สไตล์ 2 = หนา+พื้น+ขอบ, แถวข้อมูลได้สไตล์ 3 = ขอบ
    expect(text).toContain('<c r="A1" t="inlineStr" s="2">')
    expect(text).toContain('<c r="A2" t="inlineStr" s="3">')
  })

  it('headerRow อย่างเดียว (ไม่มีขอบ) → สไตล์ 1 = ตัวหนา', () => {
    const buf = buildXlsx([{ name: 's1', headerRow: true, rows: [['หัว'], ['ข้อมูล']] }])
    const text = buf.toString('utf8')
    expect(text).toContain('<c r="A1" t="inlineStr" s="1">')
    expect(text).toContain('<c r="A2" t="inlineStr" s="0">')
  })
})
