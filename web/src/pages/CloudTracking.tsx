import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { trackingBoard, tripTrack, type TrackedTrip, type TrackPoint } from '../api/tracking'
import { useCloudAuth } from '../context/CloudAuthContext'
import { Badge, Button, EmptyState, ErrorBox, PageHeader, Skeleton } from '../components/ui'
import { IconTruck } from '../components/icons'
import { Drawer } from '../components/ops/Drawer'
import { Timeline, type TimelineStep } from '../components/ops/Timeline'
import { fmtDateTime } from '../utils/format'

/**
 * หน้าติดตามรถ
 *
 * แผนที่จริงผ่าน Leaflet — ค่าตั้งต้นเป็น OpenStreetMap ที่ไม่ต้องมีคีย์
 * และย้ายไป Longdo ได้ด้วยการใส่คีย์ในไฟล์ .env ดูรายละเอียดที่ตัวแปร tiles ข้างล่าง
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

/** ห่างกันเกินเท่าไหร่ถึงเรียกว่าเส้นทางขาด — สี่รอบของการส่งจุด
 *  เผื่อไว้กว่า STALE_MS เพราะจุดตกหล่นสองสามจุดตอนเน็ตอ่อนเป็นเรื่องปกติ
 *  ไม่ใช่ว่าคนขับพับจอ */
const GAP_MS = 2 * 60 * 1000

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

/**
 * สีของสิ่งที่วาดบนแผนที่ — อ่านออกมาจาก token ตอนใช้งาน
 *
 * Leaflet ส่งค่าสีลงไปที่แอตทริบิวต์ของ SVG ตรง ๆ ซึ่งไม่รู้จัก `var(--x)`
 * ถ้าไม่อ่านออกมาก่อน หมุดจะกลายเป็นสีดำทั้งหมด เดิมทีจึงเขียนเลขฐานสิบหกไว้ในไฟล์นี้
 * แล้วกลายเป็นจานสีที่สองของระบบที่ไม่มีใครรู้ว่ามีอยู่ และไม่เคยตามธีมเลย
 *
 * แผนที่เข้มเสมอ ค่าพวกนี้จึงไม่ต้องอ่านใหม่ตอนสลับธีม อ่านครั้งเดียวพอ
 */
const mapColor = (() => {
  let cache: Record<string, string> | null = null
  return (name: string): string => {
    cache ??= {}
    const hit = cache[name]
    if (hit) return hit
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
    /* ค่าที่หายไปต้องไม่กลายเป็นสตริงว่าง — Leaflet จะวาดเป็นสีดำบนพื้นเข้มแล้วหมุดหาย */
    const value = v || '#8d99ee'
    cache[name] = value
    return value
  }
})()

/**
 * แผ่นแผนที่ที่ใช้เป็นพื้นหลัง
 *
 * ค่าตั้งต้นคือ OpenStreetMap ซึ่งฟรีจริงแต่มีนโยบายห้ามใช้กับงานปริมาณมาก
 * เราจึงเปิดทางให้ย้ายไป Longdo ได้ด้วยการใส่คีย์ในไฟล์ .env ไม่ต้องแก้โค้ด
 *
 * ทำไมถึงเป็น Longdo: งานเราคือส่งของในไทย คนวางแผนต้องอ่านชื่อซอยกับชื่อร้านออก
 * แผนที่ไทยที่ทำโดยคนไทยละเอียดกว่าในเรื่องนั้น และเขารองรับ Leaflet อย่างเป็นทางการ
 * (ของ Google ห้ามเอา tile มาเสียบ Leaflet ต้องใช้ SDK ของเขาเท่านั้น)
 *
 * ไม่มีคีย์ = ใช้ OSM ต่อไปเหมือนเดิม ไม่มีอะไรพัง
 */
const LONGDO_KEY = import.meta.env.VITE_LONGDO_KEY as string | undefined

const tiles = LONGDO_KEY
  ? {
      url: `https://ms.longdo.com/mmmap/tile.php?zoom={z}&x={x}&y={y}&key=${LONGDO_KEY}&proj=epsg3857&HD=1`,
      credit: '© Longdo Map',
    }
  : {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      credit: '© ผู้ร่วมสร้าง OpenStreetMap',
    }

/* ชั้นจราจรของ Longdo — ซ้อนทับแผนที่ ไม่ใช่แทนที่ ต้องมีคีย์ถึงจะมี
   ปิดไว้เป็นค่าตั้งต้นด้วยเหตุผลสองข้อ: มันกินโควต้าเป็นสองเท่า (ขอ tile สองชุดต่อการเลื่อนหนึ่งครั้ง)
   และสีแดงของรถติดทับสีของหมุดรถเรา ซึ่งเป็นสิ่งที่หน้านี้มีไว้ให้ดูตั้งแต่แรก
   คนที่อยากดูจราจรจะเปิดเองตอนที่ต้องการ และเราจำไว้ให้ในเครื่องเขา */
const TRAFFIC_URL = LONGDO_KEY
  ? `https://ms.longdo.com/mmmap/tile.php?proj=epsg3857&mode=trafficoverlay&zoom={z}&x={x}&y={y}&HD=1&key=${LONGDO_KEY}`
  : ''

const TRAFFIC_PREF = 'tracking-traffic'

export default function CloudTracking(): React.JSX.Element {
  const { can } = useCloudAuth()
  const [trips, setTrips] = useState<TrackedTrip[]>([])
  const [track, setTrack] = useState<TrackPoint[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /* แผงรายละเอียดแยกจากการเลือกบนแผนที่ — เลือกคันหนึ่งเพื่อดูเส้นทางบนแผนที่
     เป็นคนละความตั้งใจกับการเปิดอ่านไทม์ไลน์ ผูกรวมกันแล้วแผงจะเด้งมาบังแผนที่
     ทุกครั้งที่คนแค่อยากเห็นเส้นทาง */
  const [detailOpen, setDetailOpen] = useState(false)

  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  /* แผนที่พร้อมวาดหรือยัง — ref เปลี่ยนค่าไม่ทำให้ effect วาดหมุดรันใหม่
     ต้องเป็น state ไม่งั้นแผนที่ที่เพิ่งเกิดจะว่างเปล่าจนกว่าข้อมูลจะเปลี่ยนรอบถัดไป */
  const [mapReady, setMapReady] = useState(false)

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

  /* สร้างแผนที่ครั้งเดียว ตอนกล่องของมันโผล่มาจริง — สร้างใหม่ทุกครั้งที่ข้อมูลเปลี่ยน
     คือจอกระพริบและเสียตำแหน่งที่คนเลื่อนไว้
     ต้องเป็น callback ref ไม่ใช่ useEffect([]) — ตอน mount หน้านี้ยังเป็น Skeleton อยู่
     กล่องแผนที่ยังไม่เกิด effect จึงหลุดออกไปตั้งแต่บรรทัดแรกแล้วไม่รันอีกเลย
     ผลคือแผนที่ไม่เคยถูกสร้าง เหลือกรอบขาว ๆ ขณะที่รายการรถข้าง ๆ ขึ้นครบ */
  const holder = useCallback((node: HTMLDivElement | null) => {
    if (node === null) {
      map.current?.remove()
      map.current = null
      layer.current = null
      setMapReady(false)
      return
    }
    if (map.current) return
    const m = L.map(node).setView(HOME, 10)
    L.tileLayer(tiles.url, { maxZoom: 19, attribution: tiles.credit }).addTo(m)

    /* ปุ่มเปิด-ปิดจราจรของ Leaflet เอง ไม่ต้องมีปุ่มของเราให้ดูแลอีกอัน
       ไม่มีคีย์ = ไม่มีชั้นนี้ และไม่มีปุ่มที่กดแล้วไม่เกิดอะไรขึ้นให้คนงง */
    if (TRAFFIC_URL) {
      const traffic = L.tileLayer(TRAFFIC_URL, {
        maxZoom: 19,
        opacity: 0.85,
        attribution: '© Longdo Traffic Map',
      })
      if (localStorage.getItem(TRAFFIC_PREF) === '1') traffic.addTo(m)
      L.control.layers(undefined, { 'การจราจร': traffic }, { collapsed: false }).addTo(m)
      m.on('overlayadd', () => localStorage.setItem(TRAFFIC_PREF, '1'))
      m.on('overlayremove', () => localStorage.removeItem(TRAFFIC_PREF))
    }
    map.current = m
    layer.current = L.layerGroup().addTo(m)
    setMapReady(true)
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
        color: stale ? mapColor('map-stale') : mapColor('map-live'),
        fillColor: stale ? mapColor('map-stale-fill') : mapColor('map-live-fill'),
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
          color: mapColor('map-accuracy'),
          fillOpacity: 0.06,
          weight: 1,
        }).addTo(group)
      }

      for (const p of t.pod_points) {
        L.circleMarker([p.lat, p.lng], {
          radius: 5,
          color: mapColor('map-pod-fill'),
          fillColor: mapColor('map-pod'),
          fillOpacity: 1,
          weight: 1,
        })
          .bindTooltip(`ส่งเสร็จ ${fmtDateTime(p.collected_at)}`, { direction: 'top' })
          .addTo(group)
      }
    }

    /* วาดทีละช่วง ไม่ใช่เส้นเดียวรวด — ช่วงที่ขาดการติดต่อนานคือเส้นที่เราเดาเอง
       ไม่ใช่ทางที่รถวิ่งจริง เคยเจอช่วงห่าง 26 นาทีลากตรง 26 กิโลพาดกลางเมือง
       ซึ่งอ่านแล้วเข้าใจว่ารถวิ่งเส้นนั้น เส้นประบอกว่า "ตรงนี้ไม่รู้" */
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1]
      const b = track[i]
      if (!a || !b) continue
      const gapMs = new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
      const lost = gapMs > GAP_MS
      const line = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
        color: lost ? mapColor('map-stale') : mapColor('map-track'),
        weight: lost ? 2 : 3,
        opacity: lost ? 0.55 : 0.65,
        dashArray: lost ? '6 8' : undefined,
      }).addTo(group)
      if (lost) {
        line.bindTooltip(
          `ขาดช่วง ${Math.round(gapMs / 60000)} นาที — ไม่ใช่เส้นทางจริง`,
          { sticky: true },
        )
      }
    }

    if (seen.length > 0) {
      map.current.fitBounds(L.latLngBounds(seen).pad(0.25), { maxZoom: 14, animate: false })
    }
  }, [trips, track, selected, mapReady])

  const withoutSignal = useMemo(() => trips.filter((t) => !t.last_seen).length, [trips])
  const selectedTrip = trips.find((t) => t.trip_id === selected) ?? null

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
        ตำแหน่งส่งเข้ามาเฉพาะตอนคนขับเปิดแอปค้างไว้ · เส้นประคือช่วงที่ขาดการติดต่อ
        ไม่ใช่เส้นทางที่รถวิ่งจริง · เก็บย้อนหลัง 30 วันแล้วลบอัตโนมัติ
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
        <div className="ops-map-wrap ops-dark">
          <div ref={holder} className="ops-map" />

          {/* รายการรถลอยทับมุมซ้าย — แผนที่ได้พื้นที่ทั้งกรอบ
              บนจอแคบ ops.css ดันแผงนี้ลงไปอยู่ใต้แผนที่แทน */}
          <div className="ops-map-panel">
            <div className="ops-map-panel-head">
              <IconTruck size={15} /> รถที่กำลังวิ่ง {trips.length} คัน
            </div>
            <ul className="track-list ops-map-list">
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

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={() => void load()}>
          โหลดตำแหน่งใหม่
        </Button>
        {/* ปุ่มแยกต่างหาก ไม่ใช่ปุ่มซ้อนในรายการรถ — รายการนั้นเป็นปุ่มอยู่แล้วทั้งแถว
            ใส่ปุ่มไว้ข้างในเป็นปุ่มซ้อนปุ่ม ซึ่ง HTML ไม่ยอมรับตั้งแต่แรก */}
        {selectedTrip && (
          <Button variant="outline" onClick={() => setDetailOpen(true)}>
            ไทม์ไลน์ของ {selectedTrip.plate_no}
          </Button>
        )}
      </div>

      <Drawer
        open={detailOpen && selectedTrip != null}
        onClose={() => setDetailOpen(false)}
        title={selectedTrip?.plate_no ?? ''}
        subtitle={`${selectedTrip?.trip_no ?? ''} · ${selectedTrip?.drivers ?? 'ไม่ระบุคนขับ'}`}
      >
        {selectedTrip && (
          <>
            <div className="ops-drawer-section">
              <h3>สรุป</h3>
              <dl className="ops-kv">
                <dt>ส่งแล้ว</dt>
                <dd>{selectedTrip.stops_done}/{selectedTrip.stops_total} จุด</dd>
                <dt>ออกรถ</dt>
                <dd>{selectedTrip.departed_at ? fmtDateTime(selectedTrip.departed_at) : 'ยังไม่ออก'}</dd>
                <dt>เห็นล่าสุด</dt>
                <dd>
                  {selectedTrip.last_seen
                    ? `${minutesAgo(selectedTrip.last_seen.recorded_at)} นาทีที่แล้ว`
                    : 'ยังไม่ส่งตำแหน่งเข้ามา'}
                </dd>
                <dt>จุดที่บันทึกไว้</dt>
                <dd>{track.length} จุด</dd>
              </dl>
            </div>

            <div className="ops-drawer-section">
              <h3>ลำดับเหตุการณ์</h3>
              <Timeline steps={timelineOf(selectedTrip)} />
            </div>
          </>
        )}
      </Drawer>
    </>
  )
}

/** แปลงเที่ยวหนึ่งใบเป็นลำดับเหตุการณ์
 *
 *  ใช้เฉพาะเวลาที่เกิดขึ้นจริง ไม่เติมเวลาที่คาดว่าจะถึงเข้าไปปน — เวลาจริงกับเวลาที่เดา
 *  วางอยู่ในคอลัมน์เดียวกันแล้วคนอ่านแยกไม่ออกว่าอันไหนเกิดแล้ว
 */
function timelineOf(t: TrackedTrip): TimelineStep[] {
  const steps: TimelineStep[] = [
    {
      key: 'depart',
      title: 'ออกจากคลัง',
      time: t.departed_at ? fmtDateTime(t.departed_at) : null,
      state: t.departed_at ? 'done' : 'pending',
    },
  ]

  /* หมุดหลักฐานเรียงตามเวลาที่เก็บ ไม่ใช่ตามลำดับใบในเที่ยว — ลำดับที่คนขับวิ่งจริง
     ต่างจากลำดับที่วางแผนไว้เกือบทุกวัน และอันที่ต้องตอบลูกค้าคือลำดับที่วิ่งจริง */
  const pods = [...t.pod_points].sort(
    (a, b) => new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime(),
  )
  pods.forEach((p, i) => {
    steps.push({
      key: `pod${p.order_id}`,
      title: `จุดที่ ${i + 1} — เก็บหลักฐานแล้ว`,
      time: fmtDateTime(p.collected_at),
      state: 'done',
    })
  })

  /* จุดที่คนขับกดว่าส่งแล้วแต่ยังไม่มีหลักฐานขึ้นระบบ — ต่างกันจริง ไม่ใช่เรื่องเดียวกัน */
  const missing = t.stops_done - pods.length
  if (missing > 0) {
    steps.push({
      key: 'missing',
      title: `${missing} จุดส่งแล้วแต่ยังไม่มีหลักฐาน`,
      note: 'ลายเซ็นหรือรูปยังไม่ถูกอัปโหลด',
      state: 'danger',
    })
  }

  const left = t.stops_total - t.stops_done
  steps.push(
    left > 0
      ? { key: 'left', title: `เหลืออีก ${left} จุด`, state: 'current' }
      : { key: 'back', title: 'ส่งครบทุกจุดแล้ว', state: t.status === 'completed' ? 'done' : 'current' },
  )

  if (t.status === 'completed') {
    steps.push({ key: 'done', title: 'ปิดเที่ยวแล้ว', state: 'done' })
  }

  return steps
}
