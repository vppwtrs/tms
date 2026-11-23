import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../api/supabase.js'

/** จุดเช็กพิกัดครั้งเดียวต่อเหตุการณ์ (ไม่ watchPosition เพื่อประหยัดแบต) */
export type CheckpointKind =
  | 'trip_start' | 'arrive' | 'delivered' | 'break_start' | 'break_end' | 'fuel' | 'trip_end' | 'issue'

export interface CheckpointRow {
  trip_id: string
  kind: CheckpointKind
  lat: number | null
  lng: number | null
  accuracy_m: number | null
  recorded_at: string
  extra: Record<string, unknown>
}

export const QUEUE_KEY = 'tms.checkpointQueue.v1'
const GEO_TIMEOUT_MS = 8000

const isDemo = (): boolean => import.meta.env.MODE === 'demo'

function readQueue(): CheckpointRow[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? (v as CheckpointRow[]) : []
  } catch {
    return []
  }
}

function writeQueue(rows: CheckpointRow[]): void {
  try {
    if (rows.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(rows.slice(-500)))
    else localStorage.removeItem(QUEUE_KEY)
  } catch {
    /* storage เต็ม/ถูกปิด — ทิ้งได้ ไม่ใช่ข้อมูลวิกฤต */
  }
}

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(p),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 30_000 },
      )
    } catch {
      resolve(null)
    }
  })
}

const db = (): SupabaseClient => supabase as unknown as SupabaseClient

async function insertRows(rows: CheckpointRow[]): Promise<boolean> {
  try {
    const { error } = await db().from('trip_checkpoints').insert(rows)
    return !error
  } catch {
    return false
  }
}

let flushing = false
/** ส่งคิวที่ค้างอยู่ คืนจำนวนที่ส่งสำเร็จ */
export async function flushCheckpointQueue(): Promise<number> {
  if (isDemo() || flushing) return 0
  const q = readQueue()
  if (!q.length) return 0
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0
  flushing = true
  try {
    const ok = await insertRows(q)
    if (!ok) return 0
    // แถวที่เข้าคิวใหม่ระหว่างส่ง ต้องไม่หาย
    writeQueue(readQueue().slice(q.length))
    return q.length
  } finally {
    flushing = false
  }
}

export async function logCheckpoint(
  tripId: string,
  kind: CheckpointKind,
  extra?: Record<string, unknown>,
): Promise<void> {
  /* กันกดซ้ำ — เที่ยวหนึ่งจบได้ครั้งเดียว */
  if (kind === 'trip_end') {
    const key = `tms.tripEnd.${tripId}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch { /* storage ปิด — ปล่อยผ่าน */ }
  }
  const pos = await getPosition()
  const row: CheckpointRow = {
    trip_id: tripId,
    kind,
    lat: pos ? pos.coords.latitude : null,
    lng: pos ? pos.coords.longitude : null,
    accuracy_m: pos ? Math.round(pos.coords.accuracy) : null,
    recorded_at: new Date().toISOString(),
    extra: extra ?? {},
  }
  if (isDemo()) return
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (offline || !(await insertRows([row]))) {
    writeQueue([...readQueue(), row])
    return
  }
  void flushCheckpointQueue()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushCheckpointQueue())
}
