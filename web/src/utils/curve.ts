/**
 * เส้นโค้งผ่านจุดข้อมูล — สำหรับกราฟเส้นบนหน้าภาพรวม
 *
 * ใช้ **monotone cubic** (Fritsch–Carlson) ไม่ใช่ Catmull-Rom หรือ bezier แบบเฉลี่ย
 * เพราะสองแบบหลัง "เหวี่ยงเกิน" ระหว่างจุด: ช่วงที่ค่าเป็น 0 ติดกันหลายวันแล้วพุ่งขึ้น
 * เส้นจะแอ่นลงต่ำกว่าศูนย์ก่อนโค้งขึ้น ซึ่งบนกราฟนี้แปลว่า "วันนั้นวิ่งติดลบ"
 * — สวยขึ้นแต่โกหก
 *
 * monotone cubic รับประกันว่าเส้นจะไม่ขึ้นหรือลงเกินค่าของจุดที่มันเชื่อม
 * ช่วงไหนข้อมูลแบน เส้นก็แบน ช่วงไหนขึ้น เส้นก็ขึ้นอย่างเดียว
 */

export interface Pt {
  x: number
  y: number
}

/** เส้นโค้งเรียบผ่านทุกจุดตามลำดับ — คืน path string ของ SVG
 *
 *  จุดเดียวคืนค่าว่าง (ไม่มีเส้นให้ลาก) · สองจุดคืนเส้นตรง เพราะโค้งจากสองจุด
 *  คือการเดารูปร่างที่ข้อมูลไม่ได้บอก
 */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M${pts[0]!.x},${pts[0]!.y} L${pts[1]!.x},${pts[1]!.y}`

  const n = pts.length
  /* ความชันของเส้นตรงระหว่างจุดที่ i กับ i+1 */
  const slope: number[] = []
  const dx: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1]!.x - pts[i]!.x
    dx.push(h)
    slope.push(h === 0 ? 0 : (pts[i + 1]!.y - pts[i]!.y) / h)
  }

  /* ความชันที่จุด — ปลายทั้งสองใช้ความชันของช่วงที่ติดกัน ตรงกลางใช้ค่าเฉลี่ย */
  const m: number[] = new Array(n).fill(0)
  m[0] = slope[0]!
  m[n - 1] = slope[n - 2]!
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!
    const b = slope[i]!
    /* จุดยอดหรือจุดต่ำสุด (ความชันเปลี่ยนทิศ) ต้องแบน ไม่งั้นเส้นจะเลยยอดขึ้นไป */
    m[i] = a * b <= 0 ? 0 : (a + b) / 2
  }

  /* บีบความชันไม่ให้เกินสามเท่าของช่วงข้าง ๆ — เงื่อนไขของ Fritsch–Carlson
     ที่ทำให้เส้นไม่แกว่งเกินค่าจริง */
  for (let i = 0; i < n - 1; i++) {
    const s = slope[i]!
    if (s === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i]! / s
    const b = m[i + 1]! / s
    const t = Math.hypot(a, b)
    if (t > 3) {
      m[i] = ((3 / t) * a) * s
      m[i + 1] = ((3 / t) * b) * s
    }
  }

  let d = `M${pts[0]!.x},${pts[0]!.y}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3
    const p0 = pts[i]!
    const p1 = pts[i + 1]!
    d += ` C${p0.x + h},${p0.y + m[i]! * h} ${p1.x - h},${p1.y - m[i + 1]! * h} ${p1.x},${p1.y}`
  }
  return d
}
