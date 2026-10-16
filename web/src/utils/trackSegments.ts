/** จุด GPS ดิบยุบเป็นช่วง "จอด" กับ "เดินทาง"
 *
 * เครื่องคนขับส่งตำแหน่งทุกนาที เที่ยวหนึ่งจึงมีเป็นร้อยจุด ไล่ดูทีละจุดไม่มีใครอ่าน
 * สิ่งที่ผู้วางแผนงานอยากรู้คือ "ออกกี่โมง แวะจอดที่ไหนนานเท่าไหร่ วิ่งไปกี่กิโล"
 * จุดที่อยู่ในรัศมี STOP_RADIUS จากจุดแรกของกลุ่มนับเป็นที่เดียวกัน
 * GPS มือถือแกว่งได้หลายสิบเมตรแม้รถจอดนิ่ง รัศมีแคบกว่านี้จะแตกเป็นช่วงเดินทางปลอม */

export interface SegPoint { lat: number; lng: number; recorded_at: string }

export interface TrackSegment {
  kind: 'stop' | 'move'
  from: string
  to: string
  minutes: number
  km: number
  /* ตำแหน่งที่จอด หรือปลายทางของช่วงเดินทาง */
  lat: number
  lng: number
  points: number
}

const STOP_RADIUS_M = 120
/* จอดสั้นกว่านี้คือติดไฟแดง ไม่ใช่แวะ — รวมเข้าช่วงเดินทาง */
const MIN_STOP_MIN = 5

export function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const mins = (a: string, b: string): number => Math.max(0, (Date.parse(b) - Date.parse(a)) / 60000)

export function trackSegments(track: SegPoint[]): TrackSegment[] {
  if (track.length === 0) return []
  /* 1) จับกลุ่มจุดที่อยู่ใกล้จุดตั้งต้นของกลุ่ม */
  const groups: SegPoint[][] = []
  for (const p of track) {
    const g = groups[groups.length - 1]
    if (g && distM(g[0] as SegPoint, p) <= STOP_RADIUS_M) g.push(p)
    else groups.push([p])
  }
  /* 2) กลุ่มที่นานพอคือจอด ที่เหลือคือเดินทาง ช่วงเดินทางติดกันรวมเป็นช่วงเดียว */
  const out: TrackSegment[] = []
  let prevEnd: SegPoint | null = null
  for (const g of groups) {
    const first = g[0] as SegPoint
    const last = g[g.length - 1] as SegPoint
    const isStop = mins(first.recorded_at, last.recorded_at) >= MIN_STOP_MIN
    let km = 0
    for (let i = 1; i < g.length; i++) km += distM(g[i - 1] as SegPoint, g[i] as SegPoint) / 1000
    const lead = prevEnd ? distM(prevEnd, first) / 1000 : 0
    const tail = out[out.length - 1]
    if (isStop) {
      /* ทางวิ่งจากจุดก่อนหน้าเข้ามาถึงที่จอด นับให้ช่วงเดินทางก่อนหน้า */
      if (prevEnd && lead > 0) {
        if (tail && tail.kind === 'move') {
          tail.km += lead; tail.to = first.recorded_at; tail.lat = first.lat; tail.lng = first.lng
          tail.minutes = mins(tail.from, tail.to)
        } else {
          out.push({ kind: 'move', from: prevEnd.recorded_at, to: first.recorded_at, minutes: mins(prevEnd.recorded_at, first.recorded_at), km: lead, lat: first.lat, lng: first.lng, points: 0 })
        }
      }
      out.push({ kind: 'stop', from: first.recorded_at, to: last.recorded_at, minutes: mins(first.recorded_at, last.recorded_at), km: 0, lat: first.lat, lng: first.lng, points: g.length })
    } else if (tail && tail.kind === 'move') {
      tail.km += lead + km; tail.to = last.recorded_at; tail.lat = last.lat; tail.lng = last.lng
      tail.minutes = mins(tail.from, tail.to); tail.points += g.length
    } else {
      out.push({ kind: 'move', from: prevEnd?.recorded_at ?? first.recorded_at, to: last.recorded_at, minutes: mins(prevEnd?.recorded_at ?? first.recorded_at, last.recorded_at), km: lead + km, lat: last.lat, lng: last.lng, points: g.length })
    }
    prevEnd = last
  }
  return out
}
