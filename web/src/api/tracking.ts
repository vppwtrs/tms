import { supabase, toDataError } from './supabase.js'

/**
 * ตำแหน่งระหว่างวิ่ง — บันทึกตั้งแต่คนขับกดรับงาน จนกว่าเที่ยวจะปิด
 *
 * ข้อจำกัดที่ต้องรู้ก่อนใช้ตัดสินใจ: เว็บติดตามตำแหน่งต่อเนื่องตอนพับหน้าจอ
 * หรือสลับไปแอปอื่นไม่ได้ ระบบปฏิบัติการหยุดให้ทันที (บน iPhone หยุดแน่นอน)
 * สิ่งที่ได้จริงคือจุดถี่ระหว่างที่แอปเปิดค้างอยู่ บวกจุดที่แน่นอนตอนเก็บ POD ทุกใบ
 * ถ้าวันหนึ่งต้องการเส้นทางต่อเนื่องแบบไม่มีช่องว่าง ต้องห่อเป็นแอปมือถือ
 */

export interface TrackPoint {
  lat: number
  lng: number
  accuracy_m: number | null
  recorded_at: string
}

export interface TrackedTrip {
  trip_id: number
  trip_no: string
  status: string
  departed_at: string | null
  /* ปิดงานที่ร้านสุดท้ายเมื่อไหร่ กับกลับถึงคลังเมื่อไหร่ — คนละเวลา
     ทั้งคู่มีค่าเฉพาะเที่ยวที่จบแล้ว */
  arrived_at: string | null
  returned_at: string | null
  plate_no: string
  drivers: string | null
  last_seen: TrackPoint | null
  stops_done: number
  stops_total: number
  pod_points: { order_id: number; lat: number; lng: number; collected_at: string }[]
}

export async function logTripLocation(
  tripId: number,
  lat: number,
  lng: number,
  accuracyM?: number | null,
): Promise<void> {
  const { error } = await supabase.rpc('log_trip_location', {
    p_trip_id: tripId,
    p_lat: lat,
    p_lng: lng,
    p_accuracy_m: accuracyM ?? null,
  })
  if (error) throw toDataError(error)
}

export async function trackingBoard(): Promise<TrackedTrip[]> {
  const { data, error } = await supabase.rpc('tracking_board')
  if (error) throw toDataError(error)
  return (data ?? []) as unknown as TrackedTrip[]
}

export async function tripTrack(tripId: number): Promise<TrackPoint[]> {
  const { data, error } = await supabase.rpc('trip_track', { p_trip_id: tripId })
  if (error) throw toDataError(error)
  return (data ?? []) as unknown as TrackPoint[]
}
