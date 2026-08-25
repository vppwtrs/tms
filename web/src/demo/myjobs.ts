import type { MyJob, OdometerStatus } from '../types.js'
import { allJobs, clone, delay, findJob } from './store.js'

/** แทน api/myjobs ในโหมดสาธิต — รูปร่างของ export ต้องตรงกันทุกตัว
 *  ไม่มีอะไรในไฟล์นี้ยิงออกเน็ต ทุกอย่างแก้ในหน่วยความจำ */

export interface PodInput {
  orderId: number
  recipientName: string
  signatureData: string
  photoPath?: string | null
  notes?: string | null
  lat?: number | null
  lng?: number | null
}

export const POD_PHOTO_KINDS = [
  { kind: 'goods', label: 'สินค้าที่ส่ง' },
  { kind: 'shopfront', label: 'หน้าร้าน/จุดส่ง' },
  { kind: 'document', label: 'ใบเซ็นรับ' },
  { kind: 'other', label: 'อื่น ๆ' },
] as const

export interface PodPhoto { path: string; kind: string }

function visible(includeDone: boolean): MyJob[] {
  const list = allJobs()
  return includeDone ? list : list.filter((j) => j.status !== 'completed' && j.status !== 'cancelled')
}

export async function listMyJobs(includeDone = false): Promise<MyJob[]> {
  return delay(clone(visible(includeDone)))
}

export async function reloadJob(tripId: number, includeDone: boolean): Promise<MyJob | null> {
  const jobs = await listMyJobs(includeDone)
  return jobs.find((j) => j.id === tripId) ?? null
}

export async function acceptTrip(tripId: number): Promise<void> {
  const job = findJob(tripId)
  if (!job) return
  const now = new Date().toISOString()
  job.my_accepted_at = now
  job.accepted_at ??= now
  job.accepted_count = Math.min(job.driver_count, job.accepted_count + 1)
  await delay(null)
}

export async function reportIssue(tripId: number, note: string): Promise<void> {
  const job = findJob(tripId)
  if (job) job.issue_note = note
  await delay(null)
}

export async function startTrip(tripId: number): Promise<void> {
  const job = findJob(tripId)
  if (job) { job.status = 'in_progress'; job.departed_at = new Date().toISOString() }
  await delay(null)
}

export async function completeTrip(tripId: number): Promise<void> {
  const job = findJob(tripId)
  /* ของจริงฝั่งฐานปฏิเสธเมื่อยังส่งไม่ครบ โหมดสาธิตต้องปฏิเสธเหมือนกัน
     ไม่งั้นคนลองจะเชื่อว่าปิดเที่ยวได้ทั้งที่ยังมีร้านค้าง */
  if (job && job.orders.some((o) => o.status !== 'delivered' && o.status !== 'cancelled')) {
    throw new Error('ยังส่งไม่ครบทุกร้าน')
  }
  if (job) job.status = 'returning'
  await delay(null)
}

export async function finishReturn(tripId: number, tollCost?: number | null): Promise<void> {
  const job = findJob(tripId)
  if (job) { job.status = 'completed'; job.arrived_at = new Date().toISOString() }
  /* โหมดสาธิตไม่มีตารางเงิน เก็บไว้ให้ดูว่าจอส่งอะไรมา ไม่ได้ใช้ต่อที่ไหน */
  if (tollCost != null) demoTolls.set(tripId, tollCost)
  await delay(null)
}

const demoTolls = new Map<number, number>()
/* เลขไมล์ของโหมดสาธิต — คีย์เป็น "รถ|วัน" เหมือน unique ของตารางจริง */
const demoOdometer = new Map<string, number>()

function todayKey(): string {
  return new Date().toLocaleDateString('sv-SE')
}

/* คีย์เดียวกับ unique ของตารางจริง: รถ + วัน + ต้น/ปลายวัน */
function dayKey(vehicleId: number, kind: 'start' | 'end'): string {
  return `${vehicleId}|${todayKey()}|${kind}`
}

/* เลขล่าสุดของวันก่อน ๆ — โหมดสาธิตเริ่มจากว่างทุกครั้งที่รีเฟรช จึงมักเป็น null */
function lastBefore(vehicleId: number): number | null {
  let last: number | null = null
  for (const [k, v] of demoOdometer) {
    if (k.startsWith(`${vehicleId}|`) && !k.includes(todayKey())) last = Math.max(last ?? 0, v)
  }
  return last
}

export async function logOdometer(
  vehicleId: number, readingKm: number, kind: 'start' | 'end' = 'start',
): Promise<void> {
  /* ของจริงปฏิเสธเลขที่ถอยหลัง โหมดสาธิตต้องปฏิเสธเหมือนกัน ไม่งั้นคนลอง
     จะไม่เห็นด่านนี้จนกว่าจะเจอของจริงหน้างาน */
  const prev = lastBefore(vehicleId)
  if (prev != null && readingKm < prev) {
    throw new Error(`เลขไมล์น้อยกว่าครั้งก่อน (${prev.toLocaleString('th-TH')}) — อ่านเลขบนหน้าปัดอีกครั้ง`)
  }
  const start = demoOdometer.get(dayKey(vehicleId, 'start'))
  if (kind === 'end' && start != null && readingKm < start) {
    throw new Error(`เลขไมล์ตอนกลับ (${readingKm.toLocaleString('th-TH')}) น้อยกว่าตอนออกรถ (${start.toLocaleString('th-TH')}) — อ่านเลขอีกครั้ง`)
  }
  demoOdometer.set(dayKey(vehicleId, kind), readingKm)
  await delay(null)
}

export async function odometerStatus(vehicleId: number): Promise<OdometerStatus> {
  const start = demoOdometer.get(dayKey(vehicleId, 'start')) ?? null
  const end = demoOdometer.get(dayKey(vehicleId, 'end')) ?? null
  return delay({
    logged_today: start != null,
    start_km: start,
    end_km: end,
    reading_km: end ?? start,
    last_km: lastBefore(vehicleId),
  })
}


function eachOrder(fn: (o: MyJob['orders'][number]) => void, orderId: number): void {
  for (const j of allJobs()) for (const o of j.orders) if (o.id === orderId) fn(o)
}

export async function deliverOrder(orderId: number): Promise<void> {
  eachOrder((o) => { o.status = 'delivered'; o.delivered_at = new Date().toISOString() }, orderId)
  await delay(null)
}

export async function undoDeliverOrder(orderId: number): Promise<void> {
  eachOrder((o) => { o.status = 'assigned'; o.delivered_at = null; o.has_pod = 0 }, orderId)
  await delay(null)
}

export async function cancelStop(orderIds: number[], reason: string): Promise<void> {
  const clean = reason.trim()
  if (!clean) throw new Error('ต้องบอกเหตุผลที่ยกเลิก')
  /* ของจริงปฏิเสธทั้งชุดเมื่อมีใบที่เก็บหลักฐานแล้ว โหมดสาธิตต้องปฏิเสธเหมือนกัน
     ไม่งั้นคนลองจะเชื่อว่ายกเลิกทับหลักฐานได้ */
  for (const j of allJobs()) {
    for (const o of j.orders) {
      if (orderIds.includes(o.id) && o.has_pod) throw new Error('ยกเลิกไม่ได้ — มีใบที่เก็บหลักฐานแล้ว 1 ใบ')
    }
  }
  for (const id of orderIds) {
    eachOrder((o) => {
      o.status = 'cancelled'
      o.cancel_reason = clean
      o.cancelled_at = new Date().toISOString()
      o.delivered_at = null
    }, id)
  }
  await delay(null)
}

export async function undoCancelStop(orderIds: number[]): Promise<void> {
  for (const id of orderIds) {
    eachOrder((o) => {
      if (o.status !== 'cancelled') return
      o.status = 'assigned'
      o.cancel_reason = null
      o.cancelled_at = null
    }, id)
  }
  await delay(null)
}

export async function saveStopOrder(tripId: number, orderIds: number[]): Promise<void> {
  const job = findJob(tripId)
  if (job) {
    const seqOf = new Map(orderIds.map((id, i) => [id, i + 1]))
    for (const o of job.orders) o.seq = seqOf.get(o.id) ?? null
    job.orders.sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999))
  }
  await delay(null)
}

let nextPodId = 900

export async function savePodWithPhotos(
  input: Omit<PodInput, 'photoPath'> & { photos: PodPhoto[] },
): Promise<number> {
  eachOrder((o) => { o.has_pod = 1; o.status = 'delivered'; o.delivered_at = new Date().toISOString() }, input.orderId)
  return delay(nextPodId++)
}

export async function savePod(input: PodInput): Promise<number> {
  return savePodWithPhotos({ ...input, photos: input.photoPath ? [{ path: input.photoPath, kind: 'goods' }] : [] })
}
