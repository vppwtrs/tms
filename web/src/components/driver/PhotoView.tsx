import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { allowZoomWhileOpen } from '../../utils/viewportZoom'
import '../../styles/driver-pod.css'

type Photo = { src: string; label: string }

/**
 * จอ 22 — ดูรูปหลักฐานเต็มจอ ที่เดียวที่ใช้สองนิ้วซูมได้
 * ส่งรูปเดียว (src) หรือหลายรูป (photos + index) — หลายรูปจะมีปุ่มก่อน/ถัดไปและแถบรูปย่อ
 */
export function PhotoView({ src, alt = 'รูปหลักฐาน', caption, photos, index = 0, onClose }: {
  src?: string
  alt?: string
  caption?: string
  photos?: Photo[]
  index?: number
  onClose: () => void
}): React.JSX.Element {
  const list: Photo[] = photos && photos.length ? photos : [{ src: src ?? '', label: alt }]
  const [i, setI] = useState(Math.min(Math.max(index, 0), list.length - 1))
  const cur = list[i] as Photo
  const many = list.length > 1
  const go = (d: number): void => setI((n) => (n + d + list.length) % list.length)

  useEffect(() => allowZoomWhileOpen(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (many && e.key === 'ArrowLeft') go(-1)
      else if (many && e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const sub = [many ? `${i + 1} / ${list.length}` : null, caption].filter(Boolean).join(' · ')

  return createPortal(
    <div className="pod-scope pv" role="dialog" aria-modal="true" aria-label={cur.label}>
      <header className="pv-head">
        <button type="button" className="pv-tb" onClick={onClose} aria-label="ปิดรูป">
          <svg className="pod-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div className="pv-title"><b>{cur.label}</b>{sub && <span>{sub}</span>}</div>
      </header>
      <main className="pv-body">
        <img src={cur.src} alt={cur.label} />
        {many && (
          <>
            <button type="button" className="pv-tb pv-prev" aria-label="รูปก่อนหน้า" onClick={() => go(-1)}>
              <svg className="pod-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <button type="button" className="pv-tb pv-next" aria-label="รูปถัดไป" onClick={() => go(1)}>
              <svg className="pod-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
            </button>
          </>
        )}
      </main>
      <p className="pv-hint">ใช้ 2 นิ้วขยายได้เฉพาะหน้านี้</p>
      {many && (
        <footer className="pv-thumbs">
          {list.map((p, n) => (
            <button key={p.src + n} type="button" className="pv-th" aria-label={`รูป${p.label}`}
              aria-current={n === i ? 'true' : undefined} onClick={() => setI(n)}>
              <img src={p.src} alt="" />
            </button>
          ))}
        </footer>
      )}
    </div>,
    document.body,
  )
}
