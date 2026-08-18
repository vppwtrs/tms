import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { trackingBoard, tripTrack, type TrackedTrip, type TrackPoint } from '../api/tracking'
import { useCloudAuth } from '../context/CloudAuthContext'
import { Badge, Button, EmptyState, ErrorBox, PageHeader, Skeleton } from '../components/ui'
import { IconTruck } from '../components/icons'
import { fmtDateTime } from '../utils/format'

/**
 * หน้าติดตามรถ
 *
 * แผนที่จริงจาก OpenStreetMap ผ่าน Leaflet — ไม่มีค่ารายเดือน ไม่ต้องผูกบัตร
 * และไม่ต้องมีคีย์ที่จะหมดอายุตอนไม่มีใครดูแล
 *
 * สิ่งที่หน้านี้บอกได้จริง: จุดล่าสุดที่รถส่งเข้ามา และหมุด POD ทุกใบที่เก็บไปแล้ว
 * สิ่งที่บอกไม่ได้: ตำแหน่งตอนที่คนขับพับหน้าจอ เพราะเบราว์เซอร์หยุดให้ตำแหน่ง
 * จึงเขียนเวลาที่เห็นล่าสุดกำกับทุกคัน ไม่ใช่วางหมุดเฉย ๆ ให้คนอ่านเดาว่าสด
 */

/** กรุงเทพฯ — จุดเริ่มของแผนที่ตอนยังไม่มีรถคันไหนส่งตำแหน่งเข้ามา */
const HOME: [number, number] = [13.7563, 100.5018]

const REFRESH_MS = 30_000

/** เห็นล่าสุดนานแค่ไหนถึงเรียกว่า "ขาดการติดต่อ" — สองรอบของการส่งจุด */
const STALE_MS = 5 * 60 * 1000

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

export default function CloudTracking(): React.JSX.Element {
  const { can } = useCloudAuth()
  const [trips, setTrips] = useState<TrackedTrip[]>([])
  const [track, setTrack] = useState<TrackPoint[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)

  const load = async (): Promise<void> => {
    try {
      setTrips(await trackingBoard())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดตำแหน่งไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (selected == null) { setTrack([]); return }
    tripTrack(selected).then(setTrack).catch(() => setTrack([]))
  }, [selected, trips])

  // สร้างแผนที่ครั้งเดียว — สร้างใหม่ทุกครั้งที่ข้อมูลเปลี่ยนคือจอกระพริบและเสียตำแหน่งที่คนเลื่อนไว้
  useEffect(() => {
    if (map.current || !holder.current) return
    map.current = L.map(holder.current).setView(HOME, 10)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© ผู้ร่วมสร้าง OpenStreetMap',
    }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  // วาดใหม่เมื่อข้อมูลเปลี่ยน — ล้างเฉพาะชั้นหมุด ไม่แตะแผนที่ข้างล่าง
  useEffect(() => {
    const group = layer.current
    if (!group || !map.current) return
    group.clearLayers()

    const seen: [number, number][] = []

    for (const t of trips) {
      if (!t.last_seen) continue
      const at: [number, number] = [t.last_seen.lat, t.last_seen.lng]
      seen.push(at)
      const stale = minutesAgo(t.last_seen.recorded_at) * 60000 > STALE_MS

      L.circleMarker(at, {
        radius: t.trip_id === selected ? 11 : 8,
        color: stale ? '#9aa0a6' : '#2563eb',
        fillColor: stale ? '#c8cdd3' : '#3b82f6',
        fillOpacity: 0.9,
        weight: 2,
      })
        .bindTooltip(
          `${t.plate_no} · ${t.drivers ?? 'ไม่ระบุคนขับ'}<br>เห็นล่าสุด ${minutesAgo(t.last_seen.recorded_at)} นาทีที่แล้ว`,
          { direction: 'top' },
        )
        .on('click', () => setSelected(t.trip_id))
        .addTo(group)

      /* วงความแม่นของอุปกรณ์ — จุดที่แม่น 2 กม. ต้องไม่ดูเท่ากับจุดที่แม่น 5 เมตร */
      if (t.last_seen.accuracy_m && t.last_seen.accuracy_m > 100) {
        L.circle(at, {
          radius: t.last_seen.accuracy_m,
          color: '#93a3b8',
          fillOpacity: 0.06,
          weight: 1,
        }).addTo(group)
      }

      for (const p of t.pod_points) {
        L.circleMarker([p.lat, p.lng], {
          radius: 5,
          color: '#15803d',
          fillColor: '#22c55e',
          fillOpacity: 1,
          weight: 1,
        })
          .bindTooltip(`ส่งเสร็จ ${fmtDateTime(p.collected_at)}`, { direction: 'top' })
          .addTo(group)
      }
    }

    if (track.length > 1) {
      L.polyline(track.map((p) => [p.lat, p.lng] as [number, number]), {
        color: '#2563eb',
        weight: 3,
        opacity: 0.65,
      }).addTo(group)
    }

    if (seen.length > 0) {
      map.current.fitBounds(L.latLngBounds(seen).pad(0.25), { maxZoom: 14, animate: false })
    }
  }, [trips, track, selected])

  const withoutSignal = useMemo(() => trips.filter((t) => !t.last_seen).length, [trips])

  if (!can('dispatch.view') && !can('myjobs.view')) {
    return <ErrorBox message="ไม่มีสิทธิ์ดูหน้าติดตามรถ" />
  }

  return (
    <>
      <PageHeader
        title="ติดตามรถ"
        subtitle="ตำแหน่งล่าสุดของเที่ยวที่กำลังวิ่ง และจุดที่เก็บหลักฐานการส่งไปแล้ว"
      />

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {/* บอกข้อจำกัดไว้บนหน้า ไม่ใช่ให้คนอ่านสรุปเอาเองว่าหมุดที่เห็นคือตำแหน่งสด */}
      <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
        ตำแหน่งส่งเข้ามาเฉพาะตอนคนขับเปิดแอปค้างไว้ · เก็บย้อนหลัง 30 วันแล้วลบอัตโนมัติ
      </p>

      {loading ? (
        <Skeleton height={420} />
      ) : trips.length === 0 ? (
        <EmptyState
          icon={<IconTruck size={28} />}
          title="ยังไม่มีเที่ยวที่กำลังวิ่ง"
          desc="เมื่อฝ่ายวางแผนสั่งงานและคนขับกดรับ รถจะขึ้นบนแผนที่นี้"
        />
      ) : (
        <div className="track-wrap">
          <div ref={holder} className="track-map" />

          <ul className="track-list">
            {trips.map((t) => (
              <li key={t.trip_id}>
                <button
                  type="button"
                  className={`track-item${t.trip_id === selected ? ' is-active' : ''}`}
                  onClick={() => setSelected(t.trip_id === selected ? null : t.trip_id)}
                >
                  <span className="track-item-plate">{t.plate_no}</span>
                  <span className="track-item-driver">{t.drivers ?? 'ไม่ระบุคนขับ'}</span>
                  <span className="track-item-meta">
                    ส่งแล้ว {t.stops_done}/{t.stops_total} จุด
                  </span>
                  {t.last_seen ? (
                    <Badge
                      label={`เห็นล่าสุด ${minutesAgo(t.last_seen.recorded_at)} นาที`}
                      tone={minutesAgo(t.last_seen.recorded_at) * 60000 > STALE_MS ? 'warning' : 'success'}
                    />
                  ) : (
                    <Badge label="ยังไม่ส่งตำแหน่ง" tone="neutral" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {withoutSignal > 0 && (
        <p className="text-xs text-muted" style={{ marginTop: 10 }}>
          {withoutSignal} เที่ยวยังไม่ส่งตำแหน่งเข้ามา — คนขับอาจยังไม่กดรับงาน หรือปิดแอปไว้
        </p>
      )}

      {selected != null && track.length === 0 && (
        <p className="text-xs text-muted" style={{ marginTop: 6 }}>
          เที่ยวนี้ยังไม่มีเส้นทางย้อนหลัง
        </p>
      )}

      <Button variant="ghost" onClick={() => void load()} style={{ marginTop: 12 }}>
        โหลดตำแหน่งใหม่
      </Button>
    </>
  )
}
