import { describe, expect, it } from 'vitest'
import { smoothPath, type Pt } from './curve'

/**
 * เส้นโค้งของกราฟ — สิ่งที่ต้องพิสูจน์ไม่ใช่ "โค้งสวยไหม" แต่คือ **ไม่โกหก**
 *
 * เส้นโค้งที่เหวี่ยงเกินจุดข้อมูลจะวาดค่าที่ไม่เคยเกิดขึ้น เช่นแอ่นลงต่ำกว่าศูนย์
 * ในช่วงที่ทุกวันเป็นศูนย์ ซึ่งบนกราฟปริมาณงานอ่านว่าวันนั้นติดลบ
 */

/** ประเมินค่า y ของ path ที่ตำแหน่ง t (0..1) ของ segment cubic ตัวที่ให้มา */
function cubicY(p0: number, c0: number, c1: number, p1: number, t: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * c0 + 3 * u * t * t * c1 + t * t * t * p1
}

function segments(d: string): { p0: number; c0: number; c1: number; p1: number }[] {
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
  /* M x y  แล้วตามด้วย C x1 y1 x2 y2 x y ชุดละหกตัว */
  const out: { p0: number; c0: number; c1: number; p1: number }[] = []
  let prevY = nums[1]!
  for (let i = 2; i + 5 < nums.length + 1; i += 6) {
    const c0 = nums[i + 1]!
    const c1 = nums[i + 3]!
    const p1 = nums[i + 5]!
    out.push({ p0: prevY, c0, c1, p1 })
    prevY = p1
  }
  return out
}

describe('smoothPath', () => {
  it('จุดเดียวไม่มีเส้นให้ลาก', () => {
    expect(smoothPath([{ x: 0, y: 10 }])).toBe('')
    expect(smoothPath([])).toBe('')
  })

  it('สองจุดเป็นเส้นตรง ไม่ใช่โค้ง', () => {
    /* โค้งจากสองจุดคือการเดารูปร่างที่ข้อมูลไม่ได้บอก */
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe('M0,0 L10,10')
  })

  it('ช่วงที่ค่าเท่ากันทุกจุด เส้นต้องแบนสนิท', () => {
    const pts: Pt[] = [{ x: 0, y: 50 }, { x: 10, y: 50 }, { x: 20, y: 50 }, { x: 30, y: 10 }]
    const segs = segments(smoothPath(pts))
    /* สองช่วงแรกแบน — จุดควบคุมต้องอยู่ที่ระดับเดียวกับปลายทั้งสอง */
    expect(segs[0]!.c0).toBe(50)
    expect(segs[0]!.c1).toBe(50)
    expect(segs[1]!.c0).toBe(50)
  })

  it('ไม่เหวี่ยงเกินค่าจริง แม้ค่าจะกระโดดแรง', () => {
    /* เคสจริงจากหน้าภาพรวม: หลายวันเป็นศูนย์แล้วพุ่งขึ้น ถ้าใช้ Catmull-Rom
       เส้นจะแอ่นต่ำกว่าศูนย์ก่อนโค้งขึ้น = วาดวันที่วิ่งติดลบ */
    const pts: Pt[] = [
      { x: 0, y: 100 }, { x: 10, y: 100 }, { x: 20, y: 100 },
      { x: 30, y: 20 }, { x: 40, y: 100 }, { x: 50, y: 30 },
    ]
    const ys = pts.map((p) => p.y)
    const lo = Math.min(...ys)
    const hi = Math.max(...ys)

    for (const s of segments(smoothPath(pts))) {
      for (let t = 0; t <= 1; t += 0.05) {
        const y = cubicY(s.p0, s.c0, s.c1, s.p1, t)
        expect(y).toBeGreaterThanOrEqual(Math.min(s.p0, s.p1) - 1e-6)
        expect(y).toBeLessThanOrEqual(Math.max(s.p0, s.p1) + 1e-6)
        expect(y).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(y).toBeLessThanOrEqual(hi + 1e-6)
      }
    }
  })

  it('ผ่านทุกจุดข้อมูลจริง ไม่ใช่เฉียดใกล้ ๆ', () => {
    const pts: Pt[] = [{ x: 0, y: 10 }, { x: 10, y: 40 }, { x: 20, y: 25 }, { x: 30, y: 60 }]
    const d = smoothPath(pts)
    expect(d.startsWith('M0,10')).toBe(true)
    for (const p of pts.slice(1)) expect(d).toContain(`${p.x},${p.y}`)
  })
})
