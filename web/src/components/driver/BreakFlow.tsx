import { useEffect, useState } from 'react'
import { logCheckpoint } from '../../utils/checkpoints'
import FuelSheet from './FuelSheet'
import '../../styles/driver-break.css'

export interface BreakFlowProps {
  tripId: string
  open: boolean
  onClose: () => void
  /** ป้ายเที่ยวบนแถบเหลือง เช่น TRIP-2611-0142 */
  tripLabel?: string
  stopsDone?: number
  stopsTotal?: number
  /** จุดถัดไป เช่น "ร้านศรีเจริญอะไหล่ · นัด 13:00" */
  nextStop?: string
}

interface ActiveBreak {
  tripId: string
  reason: string
  startedAt: number
}
interface BreakLog {
  tripId: string
  day: string
  minutes: number
}

const KEY = 'tms.activeBreak.v1'
const LOG_KEY = 'tms.breakLog.v1'
const WARN_MS = 60 * 60 * 1000
const REASONS = ['กินข้าว', 'เติมน้ำมัน', 'ห้องน้ำ', 'รอร้านเปิด', 'รถติด/ซ่อม', 'อื่นๆ']

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function save(key: string, v: unknown): void {
  try {
    if (v == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* ไม่มี storage ก็ยังพักได้ */
  }
}
const today = () => new Date().toISOString().slice(0, 10)
const readActive = (tripId: string): ActiveBreak | null => {
  const v = load<ActiveBreak | null>(KEY, null)
  return v && v.tripId === tripId ? v : null
}
const hhmm = (t: number) => new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`
}

const PauseIcon = () => (
  <svg className="dbk-ic" aria-hidden="true" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
)
const PlayIcon = () => (
  <svg className="dbk-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4l12 8-12 8z" /></svg>
)

/** BreakPick (เลือกเหตุผล) → OnBreak (จับเวลา ค้างไว้แม้รีโหลด) → กลับมาวิ่งต่อ */
export default function BreakFlow({ tripId, open, onClose, tripLabel, stopsDone, stopsTotal, nextStop }: BreakFlowProps) {
  const [active, setActive] = useState<ActiveBreak | null>(() => readActive(tripId))
  const [pick, setPick] = useState('กินข้าว')
  const [other, setOther] = useState('')
  const [fuel, setFuel] = useState<null | 'pick' | 'onbreak'>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => setActive(readActive(tripId)), [tripId])
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])

  function start() {
    const reason = pick === 'อื่นๆ' ? `อื่นๆ: ${other.trim()}` : pick
    const b: ActiveBreak = { tripId, reason, startedAt: Date.now() }
    save(KEY, b)
    setActive(b)
    setNow(Date.now())
    void logCheckpoint(tripId, 'break_start', { reason })
  }

  function resume() {
    if (!active) return
    const minutes = Math.round((Date.now() - active.startedAt) / 60000)
    const log = load<BreakLog[]>(LOG_KEY, []).filter((l) => l.day === today())
    save(LOG_KEY, [...log, { tripId, day: today(), minutes }])
    save(KEY, null)
    void logCheckpoint(tripId, 'break_end', { reason: active.reason, minutes })
    setActive(null)
    setOther('')
    onClose()
  }

  if (fuel) {
    return (
      <FuelSheet
        tripId={tripId}
        tripLabel={tripLabel}
        open
        onClose={() => {
          const back = fuel
          setFuel(null)
          if (back === 'pick') onClose()
        }}
      />
    )
  }

  if (active) {
    const elapsed = now - active.startedAt
    const todayLogs = load<BreakLog[]>(LOG_KEY, []).filter((l) => l.day === today())
    const totalMin = todayLogs.reduce((a, l) => a + l.minutes, 0) + Math.floor(elapsed / 60000)
    const sub = [tripLabel, stopsTotal != null ? `ส่งแล้ว ${stopsDone ?? 0}/${stopsTotal}` : null].filter(Boolean).join(' · ')
    return (
      <div className="dbk-root dbk-page" role="dialog" aria-modal="true" aria-label="กำลังพัก">
        <header className="dbk-bhead">
          <PauseIcon />
          <div style={{ flex: 1 }}>
            <div className="dbk-bhead-t">พักอยู่ · {active.reason}</div>
            {sub && <div className="dbk-bhead-s">{sub}</div>}
          </div>
        </header>
        <main>
          <section className="dbk-timercard">
            <div className="dbk-muted">เวลาพัก</div>
            <div className="dbk-timer" role="timer">{fmt(elapsed)}</div>
            <div style={{ fontSize: 14, color: '#56637A' }}>
              เริ่ม {hhmm(active.startedAt)} · {elapsed >= 3600000 ? 'ชม.:นาที:วินาที' : 'นาที:วินาที'}
            </div>
            {elapsed >= WARN_MS && (
              <div className="dbk-pill-warn" role="alert">พักเกิน 60 นาที ระบบจะแจ้งฝ่ายวางแผน</div>
            )}
          </section>
          <section className="dbk-card dbk-kvs">
            <div className="dbk-kv"><span>ตำแหน่งที่พัก</span><span>บันทึกพิกัดแล้ว</span></div>
            {nextStop && <div className="dbk-kv"><span>จุดถัดไป</span><span>{nextStop}</span></div>}
            <div className="dbk-kv"><span>พักวันนี้รวม</span><span>{totalMin} นาที ({todayLogs.length + 1} ครั้ง)</span></div>
          </section>
          <button type="button" className="dbk-btn dbk-sec" style={{ height: 48, fontSize: 15 }} onClick={() => setFuel('onbreak')}>
            เติมน้ำมันด้วย
          </button>
        </main>
        <div className="dbk-foot">
          <button type="button" className="dbk-btn dbk-pri" onClick={resume}><PlayIcon />กลับมาวิ่งต่อ</button>
        </div>
      </div>
    )
  }

  if (!open) return null
  const canStart = pick !== 'อื่นๆ' || other.trim() !== ''

  return (
    <div className="dbk-root">
      <div className="dbk-scrim" onClick={onClose} />
      <section className="dbk-sheet" role="dialog" aria-modal="true" aria-label="เริ่มพัก">
        <div className="dbk-grab" />
        <div>
          <h2 className="dbk-h2">พักระหว่างทาง</h2>
          <div className="dbk-hint">เลือกเหตุผล ระบบบันทึกเวลาและตำแหน่งที่พัก</div>
        </div>
        <div className="dbk-rsgrid" role="radiogroup" aria-label="เหตุผลการพัก">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={pick === r}
              className={`dbk-rs${pick === r ? ' on' : ''}`}
              onClick={() => (r === 'เติมน้ำมัน' ? setFuel('pick') : setPick(r))}
            >
              {r}
            </button>
          ))}
        </div>
        {pick === 'อื่นๆ' && (
          <label className="dbk-lbl">
            ระบุเหตุผล
            <input className="dbk-inp" value={other} onChange={(e) => setOther(e.target.value)} autoFocus />
          </label>
        )}
        <div className="dbk-note">เวลาพักไม่นับเป็นความล่าช้าของร้านถัดไป ฝ่ายวางแผนเห็นว่าพักที่ไหน กี่นาที</div>
        <button type="button" className="dbk-btn dbk-pri" disabled={!canStart} onClick={start}>เริ่มพัก</button>
        <button type="button" className="dbk-btn dbk-ghost" onClick={onClose}>ยกเลิก</button>
      </section>
    </div>
  )
}
