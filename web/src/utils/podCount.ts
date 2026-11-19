/**
 * ยอดกล่องที่คนขับนับจริงหน้าร้าน (จอถึงร้าน/ตรวจของ) ส่งต่อให้ฟอร์ม POD
 * เป็นหมายเหตุเริ่มต้น — ไม่แตะ schema ฐาน เก็บใน notes ของ POD เดิม
 * เก็บในหน่วยความจำ: นับใหม่ทุกครั้งที่เข้าร้าน ไม่ต้องอยู่ข้ามการรีโหลด
 */
const counts = new Map<number, { expected: number; counted: number; billNo: string }>()

export function setCount(orderId: number, billNo: string, expected: number, counted: number): void {
  counts.set(orderId, { expected, counted, billNo })
}

export function clearCounts(orderIds: number[]): void {
  orderIds.forEach((id) => counts.delete(id))
}

/** หมายเหตุส่งไม่ครบ/เกิน ของบิลที่นับไม่ตรงยอดสั่ง — ตรงทุกใบ = '' */
export function shortNote(orderIds: number[]): string {
  const parts: string[] = []
  for (const id of orderIds) {
    const c = counts.get(id)
    if (!c || c.counted === c.expected) continue
    const kind = c.counted < c.expected ? 'ส่งไม่ครบ' : 'ส่งเกิน'
    parts.push(`${kind} ${c.billNo}: ส่งจริง ${c.counted} จาก ${c.expected} กล่อง`)
  }
  return parts.join(' · ')
}
