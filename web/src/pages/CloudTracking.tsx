import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { trackingBoard, tripTrack, type TrackedTrip, type TrackPoint } from '../api/tracking'
import { useCloudAuth } from '../context/CloudAuthContext'
import { Button, EmptyState, ErrorBox, Skeleton } from '../components/ui'
import { IconChevronRight, IconTruck } from '../components/icons'
import { Timeline, type TimelineStep } from '../components/ops/Timeline'
import { fmtDateTime } from '../utils/format'
import '../styles/tracking.css'

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
 * หมุดใช้เฉดเดียวทั้งสองธีม เพราะมันวางบน tile ชุดเดียวกัน ไม่ได้วางบนพื้นของเรา
 * ค่าพวกนี้จึงไม่ต้องอ่านใหม่ตอนสลับธีม อ่านครั้งเดียวพอ
 */
const mapColor = (() => {
  let cache: Record<string, string> | null = null
  return (name: string): string => {
    cache ??= {}
    const hit = cache[name]
    if (hit) return hit
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
    /* ค่าที่หายไปต้องไม่กลายเป็นสตริงว่าง — Leaflet จะวาดเป็นสีดำบนพื้นเข้มแล้วหมุดหาย */
    const value = v || '#3c4ba8'
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

const COLOR_ROUTE = '#6c4ef5'
const COLOR_OK = '#10b981'
const COLOR_LIVE = '#0ea5e9'
const COLOR_STALE = '#ef4444'

function isStale(t: TrackedTrip): boolean {
  return t.status !== 'completed' && !!t.last_seen && minutesAgo(t.last_seen.recorded_at) * 60000 > STALE_MS
}

/** หมุดรถ: วงกลมสีตามสถานะ + วงคลื่น + ป้ายทะเบียน */
function truckIcon(t: TrackedTrip, stale: boolean, active: boolean): L.DivIcon {
  const c = stale ? COLOR_STALE : COLOR_LIVE
  return L.divIcon({
    className: 'trk-icon',
    html: `<div class="trk-truck${active ? ' is-active' : ''}" style="background:${c};color:${c}"><span>🚚</span></div><div class="trk-label">${t.plate_no}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

export default function CloudTracking(): React.JSX.Element {
  const { can } = useCloudAuth()
  const [trips, setTrips] = useState<TrackedTrip[]>([])
  const [track, setTrack] = useState<TrackPoint[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /* เที่ยวที่กางไทม์ไลน์อยู่ แยกจากคันที่เลือกไว้บนแผนที่ — สองอย่างนี้คนละความตั้งใจ
     เลือกคันหนึ่งคือ "ขอดูเส้นทางบนแผนที่" กางไทม์ไลน์คือ "ขอดูว่าเกิดอะไรขึ้นบ้าง"
     ผูกรวมกันแล้วแค่กดดูเส้นทางก็โดนแผงรายละเอียดเด้งมาบังทุกครั้ง */
  const [detailId, setDetailId] = useState<number | null>(null)

  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const trafficLayer = useRef<L.TileLayer | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'live' | 'stale'>('all')
  const [traffic, setTraffic] = useState(() => localStorage.getItem(TRAFFIC_PREF) === '1')
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  /* แผนที่พร้อมวาดหรือยัง — ref เปลี่ยนค่าไม่ทำให้ effect วาดหมุดรันใหม่
     ต้องเป็น state ไม่งั้นแผนที่ที่เพิ่งเกิดจะว่างเปล่าจนกว่าข้อมูลจะเปลี่ยนรอบถัดไป */
  const [mapReady, setMapReady] = useState(false)
  /* หุบแผงซ้ายได้เหมือนเมนู ให้แผนที่เต็มจอ — จำไว้ในเครื่อง */
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem('tracking-side') !== '0')
  useEffect(() => {
    localStorage.setItem('tracking-side', sideOpen ? '1' : '0')
    /* Leaflet ต้องรู้ว่ากล่องแผนที่เปลี่ยนขนาด ไม่งั้นมีขอบเทาค้าง */
    const t = setTimeout(() => map.current?.invalidateSize(), 220)
    return () => clearTimeout(t)
  }, [sideOpen])

  const load = async (): Promise<void> => {
    try {
      setTrips(await trackingBoard())
      setSyncedAt(new Date())
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

  /* ผูกกับ selected เท่านั้น — เดิมมี trips ใน deps ด้วย ซึ่ง trackingBoard()
     ให้ array อ้างอิงใหม่ทุก 30 วิ (REFRESH_MS) ทำให้ดึงเส้นทางซ้ำทุกรอบ poll
     ทั้งที่เที่ยวที่เลือกไว้ไม่ได้เปลี่ยนเลย */
  useEffect(() => {
    if (selected == null) { setTrack([]); return }
    tripTrack(selected).then(setTrack).catch(() => setTrack([]))
  }, [selected])

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
      trafficLayer.current = null
      setMapReady(false)
      return
    }
    if (map.current) return
    const m = L.map(node, { zoomControl: false }).setView(HOME, 10)
    /* className ใช้ให้ CSS ปรับสีเฉพาะแผ่นพื้น ไม่แตะชั้นจราจรที่ต้องคงสีแดง-เขียวไว้ */
    L.tileLayer(tiles.url, { maxZoom: 19, attribution: tiles.credit, className: 'trk-base-tiles' }).addTo(m)
    L.control.zoom({ position: 'topright' }).addTo(m)

    /* ชั้นจราจรสลับด้วยชิปในแผงซ้าย (effect ข้างล่าง) ไม่มีคีย์ = ไม่มีชั้นนี้และไม่มีชิป */
    if (TRAFFIC_URL) {
      trafficLayer.current = L.tileLayer(TRAFFIC_URL, {
        maxZoom: 19,
        opacity: 0.85,
        attribution: '© Longdo Traffic Map',
      })
    }
    map.current = m
    layer.current = L.layerGroup().addTo(m)
    setMapReady(true)
  }, [])

  useEffect(() => {
    const m = map.current
    const tl = trafficLayer.current
    if (!m || !tl) return
    if (traffic) tl.addTo(m)
    else tl.remove()
    if (traffic) localStorage.setItem(TRAFFIC_PREF, '1')
    else localStorage.removeItem(TRAFFIC_PREF)
  }, [traffic, mapReady])

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

      L.marker(at, { icon: truckIcon(t, stale, t.trip_id === selected), zIndexOffset: t.trip_id === selected ? 1000 : 0 })
        .bindTooltip(
          `${t.plate_no} · ${t.drivers ?? 'ไม่ระบุคนขับ'}<br>เห็นล่าสุด ${minutesAgo(t.last_seen.recorded_at)} นาทีที่แล้ว`,
          { direction: 'top', offset: [0, -18] },
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
          radius: 6,
          color: '#ffffff',
          fillColor: COLOR_OK,
          fillOpacity: 1,
          weight: 2,
        })
          .bindTooltip(`ส่งเสร็จ ${fmtDateTime(p.collected_at)}`, { direction: 'top' })
          .addTo(group)
      }
    }

    /* วาดทีละช่วง ไม่ใช่เส้นเดียวรวด — ช่วงที่ขาดการติดต่อนานคือเส้นที่เราเดาเอง
       ไม่ใช่ทางที่รถวิ่งจริง เคยเจอช่วงห่าง 26 นาทีลากตรง 26 กิโลพาดกลางเมือง
       ซึ่งอ่านแล้วเข้าใจว่ารถวิ่งเส้นนั้น เส้นประบอกว่า "ตรงนี้ไม่รู้" */
    /* ส่วนที่วิ่งผ่านแล้ว: เส้นทึบ #6c4ef5 มีฮาโลกว้างโปร่ง 15% ข้างหลัง */
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1]
      const b = track[i]
      if (!a || !b) continue
      const gapMs = new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
      const lost = gapMs > GAP_MS
      const pts: [number, number][] = [[a.lat, a.lng], [b.lat, b.lng]]
      if (lost) {
        const line = L.polyline(pts, {
          color: COLOR_ROUTE,
          weight: 3,
          opacity: 0.6,
          dashArray: '6 8',
        }).addTo(group)
        line.bindTooltip(
          `ขาดช่วง ${Math.round(gapMs / 60000)} นาที — ไม่ใช่เส้นทางจริง`,
          { sticky: true },
        )
      } else {
        L.polyline(pts, { color: COLOR_ROUTE, weight: 9, opacity: 0.15, lineCap: 'round' }).addTo(group)
        L.polyline(pts, { color: COLOR_ROUTE, weight: 4, lineCap: 'round' }).addTo(group)
      }
    }

    if (seen.length > 0) {
      map.current.fitBounds(L.latLngBounds(seen).pad(0.25), { maxZoom: 14, animate: false })
    }
  }, [trips, track, selected, mapReady])

  const withoutSignal = useMemo(() => trips.filter((t) => !t.last_seen).length, [trips])
  const detailTrip = trips.find((t) => t.trip_id === detailId) ?? null

  const stats = useMemo(() => {
    let running = 0
    let stale = 0
    let delivered = 0
    for (const t of trips) {
      if (t.status !== 'completed') running++
      if (isStale(t)) stale++
      delivered += t.stops_done
    }
    return { running, stale, delivered }
  }, [trips])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return trips.filter((t) => {
      if (filter === 'live' && (t.status === 'completed' || isStale(t))) return false
      if (filter === 'stale' && !isStale(t)) return false
      if (!q) return true
      return [t.plate_no, t.drivers ?? '', t.trip_no].some((v) => v.toLowerCase().includes(q))
    })
  }, [trips, query, filter])

  if (!can('tracking.view') && !can('myjobs.view')) {
    return <ErrorBox message="ไม่มีสิทธิ์ดูหน้าติดตามรถ" />
  }

  if (loading) return <Skeleton height={420} />

  if (trips.length === 0) {
    return (
      <>
        {error && <ErrorBox message={error} onRetry={() => void load()} />}
        <EmptyState
          icon={<IconTruck size={28} />}
          title="ยังไม่มีเที่ยวที่กำลังวิ่ง"
          desc="เมื่อฝ่ายวางแผนสั่งงานและคนขับกดรับ รถจะขึ้นบนแผนที่นี้"
        />
      </>
    )
  }

  const statusOf = (t: TrackedTrip): { label: string; cls: string } => {
    if (t.status === 'completed') return { label: 'จบแล้ว', cls: 'ok' }
    if (!t.last_seen) return { label: 'ยังไม่ส่งตำแหน่ง', cls: 'mute' }
    if (isStale(t)) return { label: 'ขาดสัญญาณ', cls: 'bad' }
    return { label: 'กำลังวิ่ง', cls: 'ok' }
  }

  const detailStatus = detailTrip ? statusOf(detailTrip) : null

  return (
    <div className={`trk-app${sideOpen ? '' : ' is-collapsed'}`}>
      <aside className="trk-side">
        <h1 className="trk-title">
          ติดตามรถ <span className="trk-live"><i />LIVE</span>
          <button type="button" className="trk-collapse" onClick={() => setSideOpen(false)} aria-label="หุบแผงรายการรถ" title="หุบแผง">‹</button>
        </h1>

        {error && <ErrorBox message={error} onRetry={() => void load()} />}

        <div className="trk-kpis">
          <div className="trk-kpi"><b>{stats.running}</b><span>กำลังวิ่ง</span></div>
          <div className="trk-kpi"><b className="is-ok">{stats.delivered}</b><span>ส่งแล้ววันนี้</span></div>
          <div className="trk-kpi"><b className="is-warn">{stats.stale}</b><span>ขาดสัญญาณ</span></div>
        </div>

        <input
          className="trk-search"
          type="search"
          placeholder="ค้นทะเบียน คนขับ หรือเลขเที่ยว"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="trk-chips">
          <button type="button" className={`trk-chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>ทั้งหมด</button>
          <button type="button" className={`trk-chip${filter === 'live' ? ' on' : ''}`} onClick={() => setFilter('live')}>กำลังวิ่ง</button>
          <button type="button" className={`trk-chip${filter === 'stale' ? ' on' : ''}`} onClick={() => setFilter('stale')}>ขาดสัญญาณ</button>
          {TRAFFIC_URL && (
            <button type="button" className={`trk-chip${traffic ? ' on' : ''}`} onClick={() => setTraffic((v) => !v)}>จราจร</button>
          )}
        </div>

        <ul className="trk-list">
          {visible.length === 0 && <li className="trk-none">ไม่พบเที่ยวที่ตรงกับตัวกรอง</li>}
          {visible.map((t) => {
            const st = statusOf(t)
            const pct = t.stops_total > 0 ? Math.round((t.stops_done / t.stops_total) * 100) : 0
            return (
              <li key={t.trip_id} className="trk-trip-row">
                <button
                  type="button"
                  className={`trk-trip${t.trip_id === selected ? ' sel' : ''}`}
                  onClick={() => setSelected(t.trip_id === selected ? null : t.trip_id)}
                >
                  <span className="trk-row">
                    <span className="trk-plate">{t.plate_no}</span>
                    <span className={`trk-st ${st.cls}`}>{st.label}</span>
                  </span>
                  <span className="trk-row trk-mut">
                    <span>{t.drivers ?? 'ไม่ระบุคนขับ'}</span>
                    {/* เที่ยวที่จบแล้วไม่มี "เห็นล่าสุด" ที่มีความหมาย — คนขับปิดแอปไปแล้ว */}
                    {t.status !== 'completed' && t.last_seen && (
                      <span>อัปเดต {minutesAgo(t.last_seen.recorded_at)} นาทีก่อน</span>
                    )}
                  </span>
                  <span className="trk-bar"><i style={{ width: `${pct}%` }} /></span>
                  <span className="trk-mut">ส่งแล้ว {t.stops_done}/{t.stops_total} จุด</span>
                </button>
                {/* ปุ่มพี่น้อง ไม่ใช่ปุ่มซ้อนในปุ่ม — เที่ยวที่จบแล้วก็กดดูไทม์ไลน์ได้ */}
                <button
                  type="button"
                  className="trk-more"
                  onClick={() => { setDetailId(t.trip_id); setSelected(t.trip_id) }}
                  aria-label={`ไทม์ไลน์ของ ${t.plate_no}`}
                  title="ดูไทม์ไลน์ของเที่ยวนี้"
                >
                  <IconChevronRight size={16} />
                </button>
              </li>
            )
          })}
        </ul>

        {/* บอกข้อจำกัดไว้บนหน้า ไม่ใช่ให้คนอ่านสรุปเอาเองว่าหมุดที่เห็นคือตำแหน่งสด */}
        <p className="trk-note">
          ตำแหน่งส่งเข้ามาเฉพาะตอนคนขับเปิดแอปค้างไว้ · เส้นประคือช่วงที่ขาดการติดต่อ
          ไม่ใช่เส้นทางที่รถวิ่งจริง · เก็บย้อนหลัง 30 วันแล้วลบอัตโนมัติ
        </p>
        {withoutSignal > 0 && (
          <p className="trk-note">
            {withoutSignal} เที่ยวยังไม่ส่งตำแหน่งเข้ามา — คนขับอาจยังไม่กดรับงาน หรือปิดแอปไว้
          </p>
        )}
        {selected != null && track.length === 0 && (
          <p className="trk-note">เที่ยวนี้ยังไม่มีเส้นทางย้อนหลัง</p>
        )}
      </aside>

      <main className="trk-map">
        <div ref={holder} className="trk-leaflet" />

        <div className="trk-top">
          <div style={{ display: 'flex', gap: 8 }}>
            {!sideOpen && (
              <button type="button" className="trk-glass trk-open" onClick={() => setSideOpen(true)} aria-label="เปิดแผงรายการรถ">☰ รายการรถ</button>
            )}
            <div className="trk-glass trk-seg"><span className="on">สด</span></div>
          </div>
          <div className="trk-glass">
            อัปเดตอัตโนมัติทุก {REFRESH_MS / 1000} วิ
            {syncedAt && ` · ซิงก์ล่าสุด ${syncedAt.toLocaleTimeString('th-TH', { hour12: false })}`}
          </div>
        </div>

        {detailTrip && detailStatus && (
          <div className="trk-glass trk-detail">
            <div className="trk-row">
              <span className="trk-plate">{detailTrip.plate_no}</span>
              <span className={`trk-st ${detailStatus.cls}`}>{detailStatus.label}</span>
            </div>
            <div className="trk-mut">
              {detailTrip.trip_no} · {detailTrip.drivers ?? 'ไม่ระบุคนขับ'}
            </div>
            <dl className="trk-kv">
              <dt>ส่งแล้ว</dt>
              <dd>{detailTrip.stops_done}/{detailTrip.stops_total} จุด</dd>
              {/* เที่ยวที่จบแล้วไม่ต้องนับนาทีตั้งแต่เห็นล่าสุด — ตัวเลขจะโตทั้งคืนแล้วอ่านเหมือนรถหาย */}
              {detailTrip.status !== 'completed' && (
                <>
                  <dt>เห็นล่าสุด</dt>
                  <dd>
                    {detailTrip.last_seen
                      ? `${minutesAgo(detailTrip.last_seen.recorded_at)} นาทีที่แล้ว`
                      : 'ยังไม่ส่งตำแหน่งเข้ามา'}
                  </dd>
                </>
              )}
              <dt>จุดที่บันทึกไว้</dt>
              <dd>{track.length} จุด</dd>
            </dl>
            <div className="trk-tl">
              <Timeline steps={timelineOf(detailTrip)} />
            </div>
            <div className="trk-btns">
              <Button variant="ghost" onClick={() => void load()}>โหลดตำแหน่งใหม่</Button>
              <Button onClick={() => setDetailId(null)}>ปิด</Button>
            </div>
          </div>
        )}
      </main>
    </div>
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

  /* ปิดงานที่ร้านสุดท้าย กับกลับถึงคลัง เป็นคนละเวลา และช่วงระหว่างสองอันนี้คือ
     เวลาขากลับ ซึ่งเป็นตัวเลขที่ใช้ตอบเรื่องค่าเที่ยวและเวลาทำงานล่วงเวลา */
  if (t.arrived_at) {
    steps.push({ key: 'arrived', title: 'ปิดงานที่ร้านสุดท้าย', time: fmtDateTime(t.arrived_at), state: 'done' })
  }
  if (t.returned_at) {
    steps.push({ key: 'returned', title: 'กลับถึงคลัง', time: fmtDateTime(t.returned_at), state: 'done' })
  }

  return steps
}
