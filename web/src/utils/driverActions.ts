import type { MyJob, MyJobOrder, OdometerStatus } from '../types'

/**
 * กติกาของปุ่มบนจอคนขับ — แยกออกจากตัวที่ลงมือทำ
 *
 * `act()` ใน CloudMyJobs ทำสองอย่างปนกัน: **ตัดสิน** ว่าการกดครั้งนี้ผ่านหรือถูกขวาง
 * และ **ลงมือ** ยิง api แล้วเปลี่ยน state ส่วนที่ตัดสินคือส่วนที่พลาดแล้วเสียหายจริง
 * (จบงานทั้งที่หลักฐานไม่ครบ, เจอด่านเลขไมล์ของรถผิดคัน, ค่าทางด่วนถูกหารใส่ทุกเที่ยว)
 * แต่มันแตะ api และ state จนไม่มีใครเทสต์ได้ ย้ายมาที่นี่เป็นฟังก์ชันบริสุทธิ์
 *
 * ที่นี่ไม่ยิงอะไร ไม่ setState อะไร — ตอบอย่างเดียวว่า "ควรทำอะไรต่อ"
 */

export type DriverAction = 'start' | 'complete' | 'accept' | 'finish'

/* ---------- ด่านของการจบงาน ---------- */

export type FinishGate =
  /** หลักฐานไม่ครบ — บอกชื่อร้านที่ต้องกลับไปเก็บ ไม่ใช่แค่ว่า "ไม่ครบ" */
  | { kind: 'missing-pod'; shops: string[] }
  /** ยังไม่ได้ถามค่าทางด่วนกับเลขไมล์ปลายทาง — เปิดกล่องก่อน */
  | { kind: 'ask-details' }
  | { kind: 'go' }

/**
 * ตัดสินว่าการกด "จบงาน" ครั้งนี้ไปต่อได้ไหม
 *
 * ฝั่งฐานกันหลักฐานไม่ครบไว้ตอนปิดงานที่ร้านสุดท้ายแล้ว แต่ระหว่างที่รถวิ่งกลับ
 * ออฟฟิศถอนตรวจหรือลบรูปได้ และคนวางแผนเพิ่มใบเข้าเที่ยวได้ เที่ยวที่ผ่านด่านนั้น
 * มาแล้วจึงกลับมาขาดหลักฐานได้อีก ต้องตรวจซ้ำตรงนี้
 */
export function finishGate(
  jobId: number,
  podGaps: string[],
  /** เที่ยวที่กล่องรายละเอียดกำลังเปิดค้างอยู่ — null คือยังไม่เคยเปิด */
  askingFor: number | null,
): FinishGate {
  if (podGaps.length > 0) return { kind: 'missing-pod', shops: podGaps }
  if (askingFor !== jobId) return { kind: 'ask-details' }
  return { kind: 'go' }
}

/** ใบที่ปิดส่งไปแล้วแต่ยังไม่มีหลักฐาน — คืนชื่อร้าน เพราะนั่นคือสิ่งที่คนขับต้องกลับไปหา */
export const podGapsOf = (jobs: MyJob[]): string[] =>
  jobs.flatMap((j) =>
    j.orders
      .filter((o: MyJobOrder) => o.status === 'delivered' && !o.has_pod)
      .map((o) => o.customer_name ?? o.destination))

/* ---------- ด่านเลขไมล์ ---------- */

/**
 * ค่าเลขไมล์ที่ถืออยู่ ใช้กับรถคันที่กำลังจะขับได้หรือเปล่า
 *
 * คนขับถือหลายเที่ยวคนละคันได้ **กดรับงานคันที่สองแล้วเจอด่านของคันแรกคือด่านที่ผิดคัน**
 * และค่าของเมื่อวานก็ใช้ไม่ได้ เพราะแอปบนมือถืออยู่ในหน่วยความจำข้ามวันได้สบาย
 */
export const odometerCacheUsable = (
  held: { id: number } | null,
  heldDay: string | null,
  vehicleId: number,
  today: string,
): boolean => held?.id === vehicleId && heldDay === today

/**
 * ต้องขวางให้กรอกเลขไมล์ก่อนไหม
 *
 * เลขไมล์ต้นวันเป็นด่านของการ "เริ่มทำงาน" ไม่ใช่ของการเปิดแอป จึงขวางแค่ตรงรับงาน
 * กับเริ่มเดินทาง เพราะสองปุ่มนี้กดตอนอยู่หน้ารถแล้วเท่านั้น ขวางตั้งแต่เปิดแอปคือ
 * ขวางคนที่นั่งดูงานพรุ่งนี้อยู่ที่บ้าน ซึ่งอ่านหน้าปัดไม่ได้
 *
 * `justLogged` มาจากการกรอกที่เพิ่งเสร็จ ต้องข้ามด่าน ไม่งั้นวนกลับเข้ากล่องเดิม —
 * ค่าที่ค้างใน closure ของกล่องยังเป็นของก่อนบันทึกเสมอ
 *
 * ถามสถานะไม่ได้ (`status` เป็น null) ก็ปล่อยผ่าน — เน็ตล่มต้องไม่แปลว่าทำงานไม่ได้
 */
export const needsOdometer = (
  action: DriverAction,
  status: OdometerStatus | null,
  justLogged = false,
): boolean =>
  (action === 'accept' || action === 'start') && !justLogged && status !== null && !status.logged_today

/** เลขไมล์ที่คนกรอก — ตัดทุกอย่างที่ไม่ใช่ตัวเลขทิ้ง คืน null เมื่อใช้ไม่ได้ */
export function parseKm(text: string): number | null {
  const km = Number(text.replace(/[^0-9]/g, ''))
  return Number.isFinite(km) && km > 0 ? km : null
}

/* ---------- สิ่งที่การกดหนึ่งครั้งไปแตะ ---------- */

/**
 * เที่ยวที่ถูกปิดพร้อมกันจากการกดจบงานหนึ่งครั้ง
 *
 * รถกลับเข้าคลังครั้งเดียว การกดหนึ่งครั้งจึงต้องปิดทุกเที่ยวที่รออยู่บนขากลับ
 * ไม่ใช่ให้คนขับกดปุ่มเดิมซ้ำทีละเที่ยว ซึ่งเป็นการถามคำถามเดิมซ้ำ ๆ ในเรื่องที่
 * เกิดขึ้นครั้งเดียว การกดอย่างอื่นแตะเที่ยวเดียวเสมอ
 */
export const closingJobs = (action: DriverAction, job: MyJob, returning: MyJob[]): MyJob[] =>
  action === 'finish' ? returning : [job]

/**
 * ค่าทางด่วนที่จะส่งไปให้เที่ยวหนึ่ง
 *
 * ตัวเลขเดียวต่อการกดหนึ่งครั้ง ผูกกับเที่ยวที่คนขับกดจบ ไม่ใช่หารใส่ทุกเที่ยว —
 * ทางด่วนที่วิ่งคือขากลับเส้นเดียว การหารเลขที่ไม่มีใครหารจริงคือการแต่งตัวเลข
 * เที่ยวอื่นได้ null = ไม่แตะค่าที่ออฟฟิศอาจกรอกไว้แล้ว
 *
 * `has` เป็น null คือยังไม่ตอบ ต้องไม่แตะของเดิมเหมือนกัน ส่วน false คือตอบแล้วว่า
 * ไม่มี ซึ่งเป็นข้อมูลจริงและต้องบันทึกเป็น 0
 */
export function tollFor(
  jobId: number,
  pressedJobId: number,
  has: boolean | null,
  amount: string,
): number | null {
  if (jobId !== pressedJobId) return null
  if (has === null) return null
  if (!has) return 0
  const n = Number(amount.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}
