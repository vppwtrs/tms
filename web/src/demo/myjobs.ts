import type { MyJob } from '../types.js'
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

export async function finishReturn(tripId: number): Promise<void> {
  const job = findJob(tripId)
  if (job) { job.status = 'completed'; job.arrived_at = new Date().toISOString() }
  await delay(null)
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
