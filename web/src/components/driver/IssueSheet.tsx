import { useEffect, useRef, useState } from 'react'
import '../../styles/driver-pod.css'

const REASONS = ['ร้านปิด', 'ติดต่อไม่ได้', 'ร้านปฏิเสธรับ', 'ที่อยู่ผิด', 'รถเสีย', 'อุบัติเหตุ', 'อื่นๆ']

/** จอ 08 — ส่งไม่ได้ / แจ้งปัญหา */
export function IssueSheet({ open, onClose, onSubmit, subtitle }: {
  open: boolean
  /* เช่น "ร้านศรีเจริญอะไหล่ · จุดที่ 3" */
  subtitle?: string
  onClose: () => void
  onSubmit: (reason: string, note: string, photo?: File) => void
}): React.JSX.Element | null {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | undefined>()
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!photo) { setPreview(null); return }
    const u = URL.createObjectURL(photo)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [photo])

  if (!open) return null
  const needNote = reason === 'อื่นๆ'
  const canSubmit = reason !== '' && (!needNote || note.trim() !== '')

  return (
    <div className="pod-scope iss">
      <div className="iss-veil" onClick={onClose} aria-hidden />
      <section className="iss-sheet" role="dialog" aria-modal="true" aria-labelledby="iss-title">
        <div className="iss-grab" aria-hidden />
        <div>
          <h2 id="iss-title">ส่งไม่ได้ / แจ้งปัญหา</h2>
          {subtitle && <div className="iss-sub">{subtitle}</div>}
        </div>
        <div className="iss-label" id="iss-q">เกิดอะไรขึ้น</div>
        <div className="iss-opts" role="group" aria-labelledby="iss-q">
          {REASONS.map((r) => (
            <button key={r} type="button" className={`iss-opt${reason === r ? ' on' : ''}`} aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>
          ))}
        </div>
        <label className="iss-label iss-field">รายละเอียด{needNote ? ' (ต้องกรอก)' : ''}
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ร้านปิด ป้ายเขียนหยุด 1 วัน" />
        </label>
        <input ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => setPhoto(e.target.files?.[0])} />
        {preview ? (
          <div className="iss-photo">
            <img src={preview} alt="รูปประกอบ" />
            <button type="button" className="pod-linkbtn" onClick={() => setPhoto(undefined)}>ลบรูป</button>
          </div>
        ) : (
          <button type="button" className="iss-shot" onClick={() => fileRef.current?.click()}>
            <svg className="pod-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            ถ่ายรูปประกอบ (แนะนำ)
          </button>
        )}
        <div className="iss-note">ของจะถูกนับเป็น "ตีกลับ" และแจ้งฝ่ายวางแผนทันที เลื่อนไปส่งรอบหลังได้</div>
        <button type="button" className="pod-btn pod-danbtn" disabled={!canSubmit} onClick={() => onSubmit(reason, note.trim(), photo)}>ยืนยัน ส่งไม่ได้</button>
        <button type="button" className="pod-btn pod-ghost" onClick={onClose}>ยกเลิก</button>
      </section>
    </div>
  )
}
