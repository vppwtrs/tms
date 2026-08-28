import { describe, expect, it } from 'vitest'
import {
  dayButtonLabel, inRange, isFutureDay, isFutureMonth, lastDays, monthGrid, monthTitle,
  monthToDate, rangeButtonLabel, shiftMonth, ymOf,
} from './calendar'

/**
 * ปฏิทิน — เทสต์ทั้งหมดที่นี่คือเคสที่ปฏิทินมือทำพังบ่อยที่สุด:
 * เดือนที่ขึ้นต้นวันอาทิตย์ · เดือนกุมภาพันธ์ปีอธิกสุรทิน · การข้ามปี
 * และ "วันในอนาคต" ซึ่งถ้าปล่อยให้กดได้ หน้าจะโหลดวันที่ยังไม่มีข้อมูล
 */

describe('monthGrid', () => {
  it('ตะแกรงมี 42 ช่องเสมอ ไม่ว่าเดือนไหน', () => {
    /* ความสูงคงที่ทุกเดือน ปุ่มด้านล่างจึงไม่ขยับตอนเปลี่ยนเดือน ซึ่งเป็นเหตุที่คนกดพลาด */
    for (const [y, m] of [[2026, 1], [2026, 7], [2024, 1], [2026, 10]] as const) {
      expect(monthGrid(y, m)).toHaveLength(42)
    }
  })

  it('เดือนที่ขึ้นต้นวันอาทิตย์ต้องไม่มีช่องว่างนำหน้า', () => {
    /* ก.พ. 2026 วันที่ 1 เป็นวันอาทิตย์ */
    const cells = monthGrid(2026, 1)
    expect(cells[0]!.day).toBe(1)
    expect(cells[0]!.iso).toBe('2026-02-01')
  })

  it('กุมภาพันธ์ปีอธิกสุรทินมี 29 วัน', () => {
    const days = monthGrid(2024, 1).filter((c) => c.day !== null)
    expect(days).toHaveLength(29)
    expect(days[days.length - 1]!.iso).toBe('2024-02-29')
  })

  it('เลขวันเรียงต่อเนื่องและ iso ตรงกับเลขวัน', () => {
    const days = monthGrid(2026, 7).filter((c) => c.day !== null)
    expect(days).toHaveLength(31)
    expect(days[0]!.iso).toBe('2026-08-01')
    expect(days[days.length - 1]!.iso).toBe('2026-08-31')
  })
})

describe('shiftMonth', () => {
  it('ข้ามธันวาคมไปมกราคมต้องขึ้นปี', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ y: 2027, m: 0 })
  })

  it('ถอยจากมกราคมต้องลดปี', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ y: 2025, m: 11 })
  })
})

describe('อนาคตกดไม่ได้', () => {
  const today = new Date('2026-08-28T10:00:00')

  it('วันพรุ่งนี้เป็นอนาคต วันนี้ไม่ใช่', () => {
    expect(isFutureDay('2026-08-29', today)).toBe(true)
    expect(isFutureDay('2026-08-28', today)).toBe(false)
    expect(isFutureDay('2026-08-27', today)).toBe(false)
  })

  it('เดือนหน้าเป็นอนาคต เดือนนี้ไม่ใช่ แม้จะยังไม่จบเดือน', () => {
    expect(isFutureMonth(2026, 8, today)).toBe(true)
    expect(isFutureMonth(2026, 7, today)).toBe(false)
    expect(isFutureMonth(2027, 0, today)).toBe(true)
    expect(isFutureMonth(2025, 11, today)).toBe(false)
  })
})

describe('ป้ายบนปุ่ม', () => {
  const today = new Date('2026-08-28T10:00:00')

  it('วันนี้กับเมื่อวานเรียกด้วยคำ ไม่ใช่วันที่', () => {
    /* คนย้อนดูงานคิดเป็น "เมื่อวาน" ไม่ได้คิดเป็น "27 ส.ค." */
    expect(dayButtonLabel('2026-08-28', today)).toBe('วันนี้')
    expect(dayButtonLabel('2026-08-27', today)).toBe('เมื่อวาน')
  })

  it('วันอื่นในปีเดียวกันไม่ต้องมีปี', () => {
    expect(dayButtonLabel('2026-08-01', today)).not.toContain('2569')
  })

  it('ข้ามปีต้องมีปีกำกับ ไม่งั้นอ่านสับสนกับวันเดียวกันของปีนี้', () => {
    expect(dayButtonLabel('2025-12-25', today)).toContain('2568')
  })
})

describe('monthTitle', () => {
  it('ใช้ปี พ.ศ. ไม่ใช่ ค.ศ.', () => {
    expect(monthTitle(2026, 7)).toBe('สิงหาคม 2569')
  })
})

describe('ymOf', () => {
  it('อ่านปีและเดือนจาก iso ได้ตรง โดยเดือนเริ่มที่ 0', () => {
    expect(ymOf('2026-08-28')).toEqual({ y: 2026, m: 7 })
  })
})

describe('rangeButtonLabel', () => {
  const today = new Date('2026-08-28T10:00:00')

  it('ช่วงวันเดียวใช้คำเดิม', () => {
    expect(rangeButtonLabel('2026-08-28', '2026-08-28', today)).toBe('วันนี้')
  })

  it('ช่วงในเดือนเดียวกันไม่เขียนเดือนซ้ำสองครั้ง', () => {
    /* ปุ่มนี้อยู่บนหัวหน้า ต้องสั้นพอที่จะไม่ดันของอื่น */
    expect(rangeButtonLabel('2026-08-25', '2026-08-28', today)).toBe('25 – 28 ส.ค.')
  })

  it('ช่วงข้ามเดือนต้องมีเดือนทั้งสองฝั่ง', () => {
    const label = rangeButtonLabel('2026-07-28', '2026-08-03', today)
    expect(label).toContain('ก.ค.')
    expect(label).toContain('ส.ค.')
  })
})

describe('lastDays', () => {
  const today = new Date('2026-08-28T10:00:00')

  it('7 วันล่าสุดคือ 7 วันรวมวันนี้ ไม่ใช่ 8 วัน', () => {
    /* ย้อนไป 7 วันแล้วนับถึงวันนี้ได้ 8 วัน ซึ่งไม่ตรงกับที่คนคาดจากคำว่า "7 วัน" */
    const r = lastDays(7, today)
    expect(r).toEqual({ from: '2026-08-22', to: '2026-08-28' })
  })
})

describe('monthToDate', () => {
  it('เริ่มที่วันที่ 1 ของเดือนนี้ ถึงวันนี้', () => {
    expect(monthToDate(new Date('2026-08-28T10:00:00')))
      .toEqual({ from: '2026-08-01', to: '2026-08-28' })
  })
})

describe('inRange', () => {
  it('รวมปลายทั้งสองข้าง', () => {
    expect(inRange('2026-08-25', '2026-08-25', '2026-08-28')).toBe(true)
    expect(inRange('2026-08-28', '2026-08-25', '2026-08-28')).toBe(true)
    expect(inRange('2026-08-24', '2026-08-25', '2026-08-28')).toBe(false)
  })
})
