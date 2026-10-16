import { useEffect, useState } from 'react'
import { podOfOrder, type PodView } from '../../api/pod'
import { POD_PHOTO_KINDS } from '../../api/myjobs'
import { PhotoViewer } from '../PhotoViewer'

const kindLabel = (kind: string): string =>
  POD_PHOTO_KINDS.find((k) => k.kind === kind)?.label ?? 'อื่น ๆ'

/**
 * รูปหลักฐานของใบหนึ่งในหน้ารายละเอียดย้อนหลัง (mockup v2 "hdetail")
 * โชว์เป็นแถวรูปย่อในการ์ดของร้านเลย กดรูปแล้วเปิดเต็มจอ — ไม่เปิดหน้าต่างซ้อนอีกชั้น
 */
export function HistoryStopPod({ orderId }: { orderId: number }): React.JSX.Element {
  const [pod, setPod] = useState<PodView | null | undefined>(undefined)
  const [viewing, setViewing] = useState<{ src: string; alt: string } | null>(null)

  useEffect(() => {
    let dead = false
    podOfOrder(orderId)
      .then((p) => { if (!dead) setPod(p) })
      .catch(() => { if (!dead) setPod(null) })
    return () => { dead = true }
  }, [orderId])

  if (pod === undefined) return <div className="hd-photos" aria-busy="true"><span className="hd-ph is-loading" /><span className="hd-ph is-loading" /><span className="hd-ph is-loading" /></div>
  if (!pod) return <p className="dv-muted">ไม่มีหลักฐาน</p>

  const items = [
    ...pod.photos.map((ph) => ({ key: ph.path, src: ph.url, label: kindLabel(ph.kind), sign: false })),
    ...(pod.signature_data ? [{ key: 'sign', src: pod.signature_data, label: 'ลายเซ็น', sign: true }] : []),
  ]

  return (
    <>
      {pod.recipient_name && <p className="dv-muted">ผู้รับ {pod.recipient_name}</p>}
      <div className="hd-photos">
        {items.map((it) => it.src ? (
          <button key={it.key} type="button" className={`hd-ph${it.sign ? ' is-sign' : ''}`}
            aria-label={`ดูรูป ${it.label}`} onClick={() => setViewing({ src: it.src as string, alt: it.label })}>
            <img src={it.src} alt="" loading="lazy" />
            <span>{it.label}</span>
          </button>
        ) : (
          <span key={it.key} className="hd-ph is-missing"><span>{it.label}</span></span>
        ))}
      </div>
      {viewing && <PhotoViewer src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />}
    </>
  )
}
