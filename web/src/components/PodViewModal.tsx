import { useEffect, useState } from 'react'
import { Badge, Button, Modal, Skeleton } from './ui'
import { podOfOrder, type PodView } from '../api/pod'
import { POD_PHOTO_KINDS } from '../api/myjobs'
import { fmtDateTime } from '../utils/format'

const kindLabel = (kind: string): string =>
  POD_PHOTO_KINDS.find((k) => k.kind === kind)?.label ?? 'อื่น ๆ'

/**
 * เปิดดูหลักฐานการส่งมอบ — อ่านอย่างเดียว
 *
 * ตัวที่เคยทำหน้าที่นี้คือ PodModal ซึ่งยิง /pod/order/:id ของ Express ฝั่ง LAN
 * สแตกคลาวด์ไม่มี endpoint นั้น หน้าออเดอร์จึงบอกได้แค่ว่ามีหรือไม่มีหลักฐาน
 * กดเข้าไปดูของจริงไม่ได้เลย ตัวนี้อ่านผ่าน RPC pod_of_order แทน
 *
 * อ่านอย่างเดียวโดยตั้งใจ: การแก้หลักฐานหลังเก็บแล้วเป็นเรื่องที่ต้องคิดแยกต่างหาก
 * และ POD ที่ยืนยันแล้วฐานปฏิเสธการแก้อยู่แล้ว หน้าต่างที่มีปุ่มแก้ซึ่งกดแล้ว
 * ขึ้น error ครึ่งหนึ่งของเวลา แย่กว่าหน้าต่างที่บอกตรง ๆ ว่าดูได้อย่างเดียว
 */
export function PodViewModal({
  orderId,
  billNo,
  onClose,
}: {
  orderId: number
  /** เลขที่คนใช้เรียกใบนี้จริง — PL ถ้ามี ไม่ใช่ ORD ที่ระบบสร้าง */
  billNo: string
  onClose: () => void
}): React.JSX.Element {
  const [pod, setPod] = useState<PodView | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let dead = false
    setLoading(true)
    setErr(null)
    podOfOrder(orderId)
      .then((p) => { if (!dead) setPod(p) })
      .catch((e: Error) => { if (!dead) setErr(e.message) })
      .finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [orderId])

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`หลักฐานการส่งมอบ — ${billNo}`}
      footer={<Button variant="ghost" onClick={onClose}>ปิด</Button>}
    >
      {loading && <Skeleton height={220} />}
      {!loading && err && <p className="job-alert is-warn">{err}</p>}
      {!loading && !err && !pod && (
        <p className="job-sub">ใบนี้ยังไม่มีหลักฐานการส่งมอบ</p>
      )}

      {pod && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <Badge
              label={pod.status === 'verified' ? 'ยืนยันแล้ว' : 'เก็บแล้ว'}
              tone={pod.status === 'verified' ? 'delivered' : 'in_transit'}
              dot={pod.status === 'collected'}
            />
            <span className="text-xs text-muted">{fmtDateTime(pod.collected_at)}</span>
            {pod.collected_by_name && (
              <span className="text-xs text-muted">· เก็บโดย {pod.collected_by_name}</span>
            )}
          </div>

          <dl className="stop-item-facts">
            <div>
              <dt>ผู้รับ</dt>
              <dd>{pod.recipient_name || '—'}</dd>
            </div>
            {pod.notes && (
              <div>
                <dt>หมายเหตุ</dt>
                <dd>{pod.notes}</dd>
              </div>
            )}
            <div>
              <dt>พิกัดตอนเก็บ</dt>
              <dd>
                {/* พิกัดที่ระบบเก็บมาจากมือถือของคนขับ และไม่ได้เก็บค่าความแม่นไว้
                    จึงบอกได้แค่ว่า "รายงานมาว่าอยู่ตรงนี้" ไม่ใช่หลักฐานยืนยันตำแหน่ง
                    ให้เป็นลิงก์ไปแผนที่ ให้คนตัดสินเองว่าใกล้ร้านพอหรือไม่ */}
                {pod.lat != null && pod.lng != null ? (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${pod.lat},${pod.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {pod.lat.toFixed(5)}, {pod.lng.toFixed(5)}
                  </a>
                ) : (
                  'ไม่มีพิกัด'
                )}
              </dd>
            </div>
          </dl>

          <h4 style={{ margin: '16px 0 6px', fontSize: 13 }}>ลายเซ็นผู้รับ</h4>
          {pod.signature_data ? (
            /* พื้นขาวเสมอ — ลายเซ็นวาดด้วยเส้นสีเข้มบนพื้นโปร่ง ถ้าปล่อยให้ทับพื้นมืด
               ของธีมกลางคืนจะกลายเป็นภาพว่างเปล่า ซึ่งอ่านได้ว่า "ไม่มีลายเซ็น" */
            <img
              src={pod.signature_data}
              alt="ลายเซ็นผู้รับ"
              style={{
                width: '100%', maxHeight: 200, objectFit: 'contain',
                background: '#fff', border: '1px solid var(--line)', borderRadius: 10,
              }}
            />
          ) : (
            <p className="job-sub">ไม่มีลายเซ็น</p>
          )}

          <h4 style={{ margin: '16px 0 6px', fontSize: 13 }}>
            รูปหลักฐาน {pod.photos.length > 0 ? `(${pod.photos.length})` : ''}
          </h4>
          {pod.photos.length === 0 ? (
            <p className="job-sub">ไม่มีรูปแนบ</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {pod.photos.map((ph) => (
                /* เปิดเต็มจอในแท็บใหม่ได้ — ข้อโต้แย้งเรื่องสภาพของต้องซูมดูของจริง
                   ลิงก์มีอายุจำกัด หมดอายุแล้วเปิดหน้าต่างนี้ใหม่จะได้ลิงก์ใหม่ */
                <a key={ph.path} href={ph.url} target="_blank" rel="noreferrer">
                  <img
                    src={ph.url}
                    alt={kindLabel(ph.kind)}
                    style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }}
                  />
                  <span className="text-xs text-muted">{kindLabel(ph.kind)}</span>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
