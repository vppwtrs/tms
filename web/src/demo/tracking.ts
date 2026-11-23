/** แทน api/tracking — พิกัดที่คนขับส่งระหว่างสาธิตถูกทิ้ง ไม่เก็บที่ไหนเลย
    กระดานติดตามรถใช้ข้อมูลตัวอย่าง 3 คัน ให้เห็นหน้าตาหน้าติดตามรถในโหมดสาธิต */
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
  arrived_at: string | null
  returned_at: string | null
  plate_no: string
  drivers: string | null
  last_seen: TrackPoint | null
  stops_done: number
  stops_total: number
  pod_points: { order_id: number; lat: number; lng: number; collected_at: string }[]
}

const ago = (min: number): string => new Date(Date.now() - min * 60_000).toISOString()

/* เส้นทางของแต่ละคัน — จุดสุดท้ายคือตำแหน่งล่าสุด */
const ROUTES: Record<number, { pts: [number, number][]; lastMin: number }> = {
  1: { pts: [[13.62, 100.45], [13.645, 100.48], [13.66, 100.50], [13.675, 100.52], [13.69, 100.54], [13.705, 100.56], [13.72, 100.58], [13.73, 100.62]], lastMin: 0.5 },
  2: { pts: [[13.80, 100.48], [13.79, 100.505], [13.78, 100.53], [13.76, 100.56]], lastMin: 1 },
  3: { pts: [[13.70, 100.78], [13.68, 100.75], [13.66, 100.72], [13.64, 100.70]], lastMin: 18 },
}

function track(id: number): TrackPoint[] {
  const r = ROUTES[id]
  if (!r) return []
  const n = r.pts.length
  return r.pts.map(([lat, lng], i) => ({ lat, lng, accuracy_m: 10, recorded_at: ago(r.lastMin + (n - 1 - i) * 1) }))
}

const last = (id: number): TrackPoint => { const t = track(id); return t[t.length - 1] as TrackPoint }

export async function logTripLocation(
  _tripId: number,
  _lat: number,
  _lng: number,
  _accuracyM?: number | null,
): Promise<void> {}

export async function trackingBoard(): Promise<TrackedTrip[]> {
  return [
    {
      trip_id: 1, trip_no: 'TR-2611-0045', status: 'in_transit', departed_at: ago(330), arrived_at: null, returned_at: null,
      plate_no: '70-1234 กทม.', drivers: 'สมชาย ใจดี', last_seen: last(1), stops_done: 5, stops_total: 8,
      pod_points: [
        { order_id: 101, lat: 13.645, lng: 100.48, collected_at: ago(250) },
        { order_id: 102, lat: 13.675, lng: 100.52, collected_at: ago(190) },
        { order_id: 103, lat: 13.705, lng: 100.56, collected_at: ago(100) },
      ],
    },
    {
      trip_id: 2, trip_no: 'TR-2611-0046', status: 'in_transit', departed_at: ago(200), arrived_at: null, returned_at: null,
      plate_no: '71-5521 ชบ.', drivers: 'วิชัย รุ่งเรือง', last_seen: last(2), stops_done: 2, stops_total: 6,
      pod_points: [{ order_id: 201, lat: 13.79, lng: 100.505, collected_at: ago(120) }],
    },
    {
      trip_id: 3, trip_no: 'TR-2611-0047', status: 'in_transit', departed_at: ago(400), arrived_at: null, returned_at: null,
      plate_no: '80-9087 กทม.', drivers: 'ประยุทธ์ มั่นคง', last_seen: last(3), stops_done: 8, stops_total: 10,
      pod_points: [{ order_id: 301, lat: 13.68, lng: 100.75, collected_at: ago(80) }],
    },
  ]
}

export async function tripTrack(tripId: number): Promise<TrackPoint[]> { return track(tripId) }
