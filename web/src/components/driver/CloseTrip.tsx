import { useState } from 'react'
import { logCheckpoint } from '../../utils/checkpoints'
import '../../styles/driver-break.css'

export interface CloseTripResult {
  endOdometer: number
  odoConfirmedSuspect: boolean
  usedExpressway: boolean
  tollBaht: number | null
  dashPhoto: File | null
}

export interface CloseTripProps {
  tripId: string
  open: boolean
  onClose: () => void
  /** ผู้ mount เรียก RPC ปิดเที่ยวจริงในนี้ */
  onConfirm: (r: CloseTripResult) => Promise<void> | void
  tripLabel?: string
  /** เลขไมล์ครั้งก่อน (ตอนเริ่มเที่ยว) */
  startOdometer?: number | null
  /** ระยะจาก GPS (กม.) */
  gpsKm?: number | null
  /** เวลาที่ใช้ เช่น "5 ชม. 20 น." */
  durationText?: string
  delivered?: number
  partial?: number
  returned?: number
}

export type OdoAnomaly = null | { level: 'error' | 'warn'; message: string; odoKm?: number }

const sp = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ')
const toNum = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ''))
  return s.trim() && Number.isFinite(n) ? n : null
}

/** น้อยกว่าครั้งก่อน = ผิด; ต่างจาก GPS เกิน 30% และ 20 กม. (หรือเกิน 1000 กม. เมื่อไม่มี GPS) = สงสัย */
export function checkOdometer(end: number, start?: number | null, gpsKm?: number | null): OdoAnomaly {
  if (!Number.isFinite(end) || end <= 0) return { level: 'error', message: 'กรอกเลขไมล์ให้ถูกต้อง' }
  if (start == null) return null
  const d = end - start
  if (d < 0) return { level: 'error', message: `น้อยกว่าครั้งก่อน (${sp(start)})`, odoKm: d }
  const off = gpsKm != null ? Math.abs(d - gpsKm) > Math.max(20, gpsKm * 0.3) : d > 1000
  return off ? { level: 'warn', message: 'เลขไมล์ดูไม่ตรงกับ GPS', odoKm: d } : null
}

/** กล่องยืนยันตาม mockup OdoCheck */
export function OdoWarning(props: { entered: number; odoKm: number; gpsKm?: number | null; onFix: () => void; onConfirm: () => void; busy?: boolean }) {
  const { entered, odoKm, gpsKm, onFix, onConfirm, busy } = props
  return (
    <div className="dbk-root dbk-center">
      <section className="dbk-alert" role="alertdialog" aria-modal="true" aria-label="เลขไมล์ไม่ตรงกับ GPS">
        <div className="dbk-alert-ic">
          <svg className="dbk-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v4M12 17.5v.5" /></svg>
        </div>
        <h2>เลขไมล์ดูไม่ตรงกับ GPS</h2>
        <div className="dbk-cmp">
          <div><span>กรอกมา</span><b>{sp(entered)}</b></div>
          <div><span>ระยะจากเลขไมล์</span><b style={{ color: '#9B1C12' }}>{sp(odoKm)} กม.</b></div>
          {gpsKm != null && <div><span>ระยะจาก GPS</span><b>{sp(Math.round(gpsKm))} กม.</b></div>}
        </div>
        <p>ลองดูหน้าปัดอีกที ถ้าเลขถูกจริงกด "เลขถูกแล้ว" ระบบจะบันทึกและแจ้งแอดมินให้ตรวจ</p>
        <button type="button" className="dbk-btn dbk-pri" onClick={onFix} autoFocus>แก้เลข</button>
        <button type="button" className="dbk-btn dbk-sec" disabled={busy} onClick={onConfirm}>เลขถูกแล้ว ปิดงาน</button>
      </section>
    </div>
  )
}

const BackIcon = () => <svg className="dbk-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
const CamIcon = () => <svg className="dbk-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>

/** หน้า "ถึงคลัง ปิดงาน" (mockup CloseTrip) */
export default function CloseTrip(props: CloseTripProps) {
  const { tripId, open, onClose, onConfirm, tripLabel, startOdometer, gpsKm, durationText, delivered, partial, returned } = props
  const [odo, setOdo] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [exp, setExp] = useState<boolean | null>(null)
  const [toll, setToll] = useState('')
  const [suspect, setSuspect] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!open) return null

  const end = toNum(odo)
  const anomaly = end != null ? checkOdometer(end, startOdometer, gpsKm) : null
  const d = end != null && startOdometer != null ? end - startOdometer : null
  const canSubmit = end != null && anomaly?.level !== 'error' && exp !== null && (!exp || toNum(toll) != null) && !busy

  async function finish(confirmedSuspect: boolean) {
    if (end == null) return
    setBusy(true)
    try {
      const r: CloseTripResult = { endOdometer: end, odoConfirmedSuspect: confirmedSuspect, usedExpressway: !!exp, tollBaht: exp ? toNum(toll) : null, dashPhoto: photo }
      await onConfirm(r)
      void logCheckpoint(tripId, 'trip_end', {
        odometer_km: end,
        start_odometer_km: startOdometer ?? null,
        gps_km: gpsKm ?? null,
        odo_suspect: confirmedSuspect,
        toll_baht: r.tollBaht,
      })
      setSuspect(false)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dbk-root dbk-page" role="dialog" aria-modal="true" aria-label="ถึงคลัง ปิดงาน">
      <header className="dbk-head">
        <button type="button" className="dbk-back" aria-label="กลับ" onClick={onClose}><BackIcon /></button>
        <div style={{ flex: 1 }}>
          <div className="dbk-head-t">ถึงคลัง ปิดงาน</div>
          {tripLabel && <div className="dbk-head-s">{tripLabel}</div>}
        </div>
      </header>
      <main>
        <section className="dbk-card dbk-stats">
          <div><div className="dbk-stat-n" style={{ color: '#13795B' }}>{delivered ?? 0}</div><div className="dbk-stat-l">ส่งครบ</div></div>
          <div><div className="dbk-stat-n" style={{ color: '#7A5300' }}>{partial ?? 0}</div><div className="dbk-stat-l">ส่งบางส่วน</div></div>
          <div><div className="dbk-stat-n" style={{ color: '#9B1C12' }}>{returned ?? 0}</div><div className="dbk-stat-l">ตีกลับ</div></div>
          {(gpsKm != null || durationText) && (
            <div className="dbk-stats-foot">
              {gpsKm != null && <>ระยะทางจาก GPS <b>{gpsKm.toFixed(1)} กม.</b></>}
              {gpsKm != null && durationText ? ' · ' : ''}
              {durationText && `ใช้เวลา ${durationText}`}
            </div>
          )}
        </section>
        <label className="dbk-lbl">
          เลขไมล์ตอนนี้ (กม.)
          <input className="dbk-inp dbk-inp-big" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} />
          {anomaly?.level === 'error' ? (
            <span className="dbk-err" role="alert">{anomaly.message}</span>
          ) : startOdometer != null ? (
            <span className="dbk-sub400">
              ครั้งก่อน {sp(startOdometer)}
              {d != null && ` · ต่างกัน ${sp(d)} กม.`}
              {d != null && gpsKm != null && (anomaly ? ' ไม่ตรงกับ GPS' : ' ใกล้เคียง GPS')}
            </span>
          ) : null}
        </label>
        <label className="dbk-addrow">
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          <CamIcon />{photo ? 'ถ่ายรูปหน้าปัดแล้ว · ถ่ายใหม่' : 'ถ่ายรูปหน้าปัด'}
        </label>
        <div className="dbk-lbl">
          วันนี้ขึ้นทางด่วนไหม
          <div className="dbk-seg two" role="group" aria-label="ขึ้นทางด่วน">
            <button type="button" aria-pressed={exp === false} className={exp === false ? 'on' : ''} onClick={() => setExp(false)}>ไม่ขึ้น</button>
            <button type="button" aria-pressed={exp === true} className={exp === true ? 'on' : ''} onClick={() => setExp(true)}>ขึ้น</button>
          </div>
        </div>
        {exp && (
          <label className="dbk-lbl">
            ค่าทางด่วนรวม (บาท)
            <input className="dbk-inp" inputMode="numeric" value={toll} onChange={(e) => setToll(e.target.value)} />
          </label>
        )}
      </main>
      <div className="dbk-foot">
        <button type="button" className="dbk-btn dbk-pri" disabled={!canSubmit} onClick={() => (anomaly?.level === 'warn' ? setSuspect(true) : finish(false))}>
          {busy ? 'กำลังปิดงาน…' : 'ปิดงาน'}
        </button>
      </div>
      {suspect && end != null && anomaly?.odoKm != null && (
        <OdoWarning entered={end} odoKm={anomaly.odoKm} gpsKm={gpsKm} busy={busy} onFix={() => setSuspect(false)} onConfirm={() => finish(true)} />
      )}
    </div>
  )
}
