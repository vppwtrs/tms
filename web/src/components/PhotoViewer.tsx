import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { allowZoomWhileOpen } from '../utils/viewportZoom'

/**
 * ดูรูปเต็มจอ พื้นดำ — ที่เดียวบนจอคนขับที่ใช้สองนิ้วซูมได้
 * คนขับต้องเพ่งตัวหนังสือบนใบเซ็นรับว่าอ่านเลขที่ใบออกไหม ซึ่งรูปย่อในแถบทำไม่ได้
 */
export function PhotoViewer({ src, alt = 'รูปหลักฐาน', onClose }: {
  src: string
  alt?: string
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => allowZoomWhileOpen(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={alt}>
      <button type="button" className="photo-viewer-close" onClick={onClose} aria-label="ปิดรูป">✕</button>
      <img src={src} alt={alt} />
      <p className="photo-viewer-hint">ใช้สองนิ้วซูมได้</p>
    </div>,
    document.body,
  )
}
