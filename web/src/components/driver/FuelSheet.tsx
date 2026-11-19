import { useEffect, useState } from 'react'
import { logCheckpoint } from '../../utils/checkpoints'
import { uploadTripPhoto } from '../../api/storage'
import { useToast } from '../../context/ToastContext'
import '../../styles/driver-break.css'

export interface FuelSheetProps {
  tripId: string
  open: boolean
  onClose: () => void
  /** บรรทัดรองบนหัว เช่น "TRIP-2611-0142 · 70-1234" */
  tripLabel?: string
}

const FUELS = ['ดีเซล', 'B7', 'แก๊สโซฮอล์']
const PAYS = ['บัตรน้ำมัน', 'เงินสด', 'โอน']
const toNum = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ''))
  return s.trim() && Number.isFinite(n) ? n : null
}

const BackIcon = () => <svg className="dbk-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
const CamIcon = () => <svg className="dbk-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
const PinIcon = () => <svg className="dbk-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>

function Seg({ label, items, value, onChange }: { label: string; items: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className={`dbk-seg${items.length === 2 ? ' two' : ''}`} role="group" aria-label={label}>
      {items.map((i) => (
        <button key={i} type="button" aria-pressed={value === i} className={value === i ? 'on' : ''} onClick={() => onChange(i)}>{i}</button>
      ))}
    </div>
  )
}

/** หน้าบันทึกเติมน้ำมัน (mockup Fuel) — ส่งเป็น checkpoint 'fuel' */
export default function FuelSheet({ tripId, open, onClose, tripLabel }: FuelSheetProps) {
  const [fuelType, setFuelType] = useState(FUELS[0]!)
  const [pay, setPay] = useState(PAYS[0]!)
  const [liters, setLiters] = useState('')
  const [amount, setAmount] = useState('')
  const [odo, setOdo] = useState('')
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([])
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos])
  if (!open) return null

  const l = toNum(liters)
  const a = toNum(amount)
  const valid = l != null && l > 0 && a != null && a > 0 && photos.length > 0

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    try {
      /* อัปใบเสร็จก่อน — ล้มแล้วค้างฟอร์มไว้ให้กดส่งใหม่ ไม่ล้างตัวเลขที่กรอก */
      let receiptPaths: string[]
      try {
        receiptPaths = await Promise.all(photos.map((p) => uploadTripPhoto(tripId, 'fuel', p.file)))
      } catch (e) {
        toast.push('error', `อัปรูปใบเสร็จไม่สำเร็จ: ${(e as Error).message}`)
        return
      }
      await logCheckpoint(tripId, 'fuel', {
        fuel_type: fuelType,
        liters: l,
        amount_baht: a,
        price_per_liter: l && a ? Math.round((a / l) * 100) / 100 : null,
        odometer_km: toNum(odo),
        payment: pay,
        receipts: photos.map((p) => ({ name: p.file.name, size: p.file.size, type: p.file.type })),
        receipt_paths: receiptPaths,
      })
      setLiters('')
      setAmount('')
      setOdo('')
      setPhotos([])
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dbk-root dbk-page" role="dialog" aria-modal="true" aria-label="บันทึกเติมน้ำมัน">
      <header className="dbk-head">
        <button type="button" className="dbk-back" aria-label="กลับ" onClick={onClose}><BackIcon /></button>
        <div style={{ flex: 1 }}>
          <div className="dbk-head-t">บันทึกเติมน้ำมัน</div>
          {tripLabel && <div className="dbk-head-s">{tripLabel}</div>}
        </div>
      </header>
      <main>
        <div className="dbk-lbl">ชนิดน้ำมัน<Seg label="ชนิดน้ำมัน" items={FUELS} value={fuelType} onChange={setFuelType} /></div>
        <div className="dbk-2col">
          <label className="dbk-lbl">จำนวนลิตร<input className="dbk-inp" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} placeholder="0.00" /></label>
          <label className="dbk-lbl">ยอดเงิน (บาท)<input className="dbk-inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
        </div>
        {l && a ? <div style={{ fontSize: 13, color: '#56637A', marginTop: -6 }}>≈ {(a / l).toFixed(2)} บาท/ลิตร</div> : null}
        <label className="dbk-lbl">เลขไมล์ตอนเติม<input className="dbk-inp" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} /></label>
        <div className="dbk-lbl">จ่ายด้วย<Seg label="วิธีจ่าย" items={PAYS} value={pay} onChange={setPay} /></div>
        <div className="dbk-lbl">
          ใบเสร็จ (บังคับ)
          <div className="dbk-thumbs">
            {photos.map((p, i) => (
              <div key={p.url} className="dbk-thumb" style={{ backgroundImage: `url(${p.url})` }}>
                ใบเสร็จ {i + 1}
                <button type="button" aria-label={`ลบใบเสร็จ ${i + 1}`} onClick={() => setPhotos(photos.filter((x) => x !== p))}>×</button>
              </div>
            ))}
            <label className="dbk-add">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) setPhotos([...photos, { file: f, url: URL.createObjectURL(f) }])
                  e.target.value = ''
                }}
              />
              <CamIcon />เพิ่มรูป
            </label>
          </div>
        </div>
        <div className="dbk-gpsnote"><PinIcon />ปั๊ม: บันทึกตำแหน่งให้อัตโนมัติ</div>
      </main>
      <div className="dbk-foot">
        <button type="button" className="dbk-btn dbk-pri" disabled={!valid || busy} onClick={submit}>{busy ? 'กำลังบันทึก…' : 'บันทึกการเติม'}</button>
      </div>
    </div>
  )
}
