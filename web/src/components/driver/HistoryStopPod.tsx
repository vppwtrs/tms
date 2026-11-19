import { useEffect, useState } from 'react'
import { podOfOrder, type PodView } from '../../api/pod'
import { POD_PHOTO_KINDS } from '../../api/myjobs'
import { fmtDateTime } from '../../utils/format'
import { PhotoView } from './PhotoView'
import '../../styles/driver-pod.css'

const kindLabel = (kind: string): string =>
  POD_PHOTO_KINDS.find((k) => k.kind === kind)?.label ?? 'อื่น ๆ'

/**
 * จอ 14 — หลักฐานของใบหนึ่งในหน้าประวัติ: การ์ดรูปถ่าย · การ์ดลายเซ็น · การ์ดสรุป
 * หัวจอ (ชื่อร้าน เลขทริป) เป็นของหน้าที่เรียกใช้ คอมโพเนนต์นี้วาดแค่ส่วน main
 */
export function HistoryStopPod({ orderId }: { orderId: number }): React.JSX.Element {
  const [pod, setPod] = useState<PodView | null | undefined>(undefined)
  const [viewing, setViewing] = useState<number | null>(null)

  useEffect(() => {
    let dead = false
    podOfOrder(orderId)
      .then((p) => { if (!dead) setPod(p) })
      .catch(() => { if (!dead) setPod(null) })
    return () => { dead = true }
  }, [orderId])

  if (pod === undefined) {
    return (
      <div className="pod-scope hp" aria-busy="true">
        <section className="hp-card"><div className="hp-label">รูปถ่าย</div>
          <div className="hp-grid"><span className="hp-ph is-loading" /><span className="hp-ph is-loading" /><span className="hp-ph is-loading" /></div>
        </section>
      </div>
    )
  }
  if (!pod) return <p className="pod-scope hp-none">ไม่มีหลักฐาน</p>

  const photos = pod.photos.filter((ph) => ph.url).map((ph) => ({ src: ph.url as string, label: kindLabel(ph.kind) }))
  const when = fmtDateTime(pod.collected_at)

  return (
    <div className="pod-scope hp">
      <section className="hp-card">
        <div className="hp-label">รูปถ่าย · แตะเพื่อขยาย</div>
        {pod.photos.length === 0 ? <div className="hp-empty">ไม่มีรูปถ่าย</div> : (
          <div className="hp-grid">
            {pod.photos.map((ph) => {
              const i = photos.findIndex((p) => p.src === ph.url)
              return ph.url ? (
                <button key={ph.path} type="button" className="hp-ph" aria-label={`ดูรูป ${kindLabel(ph.kind)}`} onClick={() => setViewing(i)}>
                  <img src={ph.url} alt="" loading="lazy" />
                  <span>{kindLabel(ph.kind)}</span>
                </button>
              ) : (
                <span key={ph.path} className="hp-ph is-missing"><span>{kindLabel(ph.kind)} · โหลดไม่ได้</span></span>
              )
            })}
          </div>
        )}
      </section>

      <section className="hp-card">
        <div className="hp-label">ลายเซ็น</div>
        <div className="hp-sig">
          {pod.signature_data ? <img src={pod.signature_data} alt="ลายเซ็นผู้รับ" /> : <span className="hp-empty">ไม่มีลายเซ็น</span>}
        </div>
        {pod.recipient_name && <div className="hp-sub">ผู้รับ: {pod.recipient_name}</div>}
      </section>

      <section className="hp-card is-kv">
        <div className="hp-kv"><span>ส่งเมื่อ</span><span>{when}</span></div>
        {pod.collected_by_name && <div className="hp-kv"><span>คนขับ</span><span>{pod.collected_by_name}</span></div>}
        {pod.notes && <div className="hp-kv"><span>หมายเหตุ</span><span>{pod.notes}</span></div>}
        <div className="hp-kv"><span>ตำแหน่งตอนส่ง</span>
          <span className={pod.lat != null ? 'is-ok' : 'is-muted'}>{pod.lat != null ? 'บันทึกพิกัดแล้ว' : 'ไม่มีพิกัด'}</span></div>
      </section>

      {viewing !== null && photos[viewing] && (
        <PhotoView photos={photos} index={viewing} caption={when} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}
