import { useEffect, useState } from 'react'
import { Badge, Button, Modal, Skeleton, Textarea } from './ui'
import { podOfOrder, verifyPod, unverifyPod, type PodView } from '../api/pod'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
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
 * แก้ไม่ได้โดยตั้งใจ: การแก้หลักฐานหลังเก็บแล้วเป็นเรื่องที่ต้องคิดแยกต่างหาก
 * หน้าต่างที่มีปุ่มแก้ซึ่งกดแล้วขึ้น error ครึ่งหนึ่งของเวลา แย่กว่าหน้าต่างที่บอก
 * ตรง ๆ ว่าดูได้อย่างเดียว
 *
 * สิ่งเดียวที่ทำได้จากที่นี่คือ "ยืนยัน" ซึ่งไม่ใช่การแก้ แต่เป็นการปิดใบไม่ให้แก้อีก
 * ก่อนหน้านี้ไม่มีทางทำได้เลยในสแตกคลาวด์ ทุกใบจึงค้างที่ collected ตลอดกาล
 * และกฎ "ยืนยันแล้วแก้ไม่ได้" ใน save_pod ไม่เคยมีผลกับใบไหนเลยสักใบ
 */
export function PodViewModal({
  orderId,
  billNo,
  covers = 1,
  onClose,
}: {
  orderId: number
  /** เลขที่คนใช้เรียกใบนี้จริง — PL ถ้ามี ไม่ใช่ ORD ที่ระบบสร้าง */
  billNo: string
  /** จำนวนใบที่ลายเซ็นชุดนี้ครอบอยู่ — คนขับเซ็นครั้งเดียวที่หน้าร้าน แล้วลายเซ็น
   *  ชุดนั้นถูกบันทึกลงทุกใบของร้านนั้น เปิดจากใบเดียวโดยไม่บอกจะเข้าใจว่าใบอื่นยังว่าง */
  covers?: number
  onClose: () => void
}): React.JSX.Element {
  const { can } = useCloudAuth()
  const toast = useToast()
  const [pod, setPod] = useState<PodView | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  /* ฟอร์มปลดการยืนยันอยู่ในหน้าต่างเดียวกัน ไม่ใช่ dialog ซ้อน dialog —
     คนที่จะปลดต้องเห็นลายเซ็นที่ตัวเองกำลังปลดอยู่ตรงหน้าขณะพิมพ์เหตุผล */
  const [unverifyOpen, setUnverifyOpen] = useState(false)
  const [reason, setReason] = useState('')

  const canVerify = can('pod.verify')

  const verify = async (): Promise<void> => {
    if (!pod) return
    setVerifying(true)
    try {
      const r = await verifyPod(pod.id)
      setPod({ ...pod, status: 'verified' })
      toast.push('success', r.already ? 'หลักฐานใบนี้ยืนยันไว้แล้ว' : 'ยืนยันหลักฐานแล้ว — แก้ไขไม่ได้อีก')
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setVerifying(false)
    }
  }

  const unverify = async (): Promise<void> => {
    if (!pod) return
    setVerifying(true)
    try {
      await unverifyPod(pod.id, reason)
      setPod({ ...pod, status: 'collected' })
      setUnverifyOpen(false)
      setReason('')
      toast.push('success', 'ยกเลิกการยืนยันแล้ว — บันทึกเหตุผลไว้ในประวัติหลักฐาน')
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setVerifying(false)
    }
  }

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
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ปิด</Button>
          {/* ขึ้นเฉพาะใบที่ยังยืนยันไม่ได้ยืนยัน และเฉพาะคนที่ถือสิทธิ์นั้นจริง
              ปุ่มที่กดแล้วฐานปฏิเสธ สอนให้คนเลิกเชื่อสิ่งที่หน้าจอบอก */}
          {pod && pod.status === 'collected' && canVerify && (
            <Button variant="success" loading={verifying} onClick={() => void verify()}>
              ยืนยันหลักฐาน
            </Button>
          )}
          {/* ทางออกฉุกเฉินสำหรับใบที่ยืนยันไปแล้วแต่ต้องลบเที่ยวจริง ๆ
              เป็นปุ่มจาง ๆ ไม่ใช่ปุ่มเด่น — ไม่ใช่สิ่งที่ควรกดในวันธรรมดา */}
          {pod && pod.status === 'verified' && canVerify && !unverifyOpen && (
            <Button variant="ghost" onClick={() => setUnverifyOpen(true)}>
              ยกเลิกการยืนยัน
            </Button>
          )}
        </>
      }
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
            {covers > 1 && (
              <span className="text-xs text-muted">· ลายเซ็นชุดนี้ใช้กับ {covers} ใบของร้านนี้</span>
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

          {unverifyOpen && (
            <div className="job-alert is-warn" style={{ marginBottom: 12 }}>
              <p style={{ marginBottom: 8 }}>
                ปลดการยืนยันแล้วใบนี้จะแก้ทับได้อีก และลบพร้อมเที่ยวได้ — เหตุผลจะถูกบันทึกพร้อมชื่อคุณ
              </p>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เหตุผลที่ต้องปลด เช่น ยืนยันผิดใบ / ต้องลบข้อมูลทดสอบ"
                aria-label="เหตุผลที่ยกเลิกการยืนยัน"
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={() => { setUnverifyOpen(false); setReason('') }}>
                  ไม่ปลด
                </Button>
                <Button variant="danger" loading={verifying} disabled={!reason.trim()} onClick={() => void unverify()}>
                  ยืนยันการปลด
                </Button>
              </div>
            </div>
          )}

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
