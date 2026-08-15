import { useEffect, useMemo, useState } from 'react'
import { listMyJobs, reloadJob, startTrip, completeTrip, deliverOrder, savePod } from '../api/myjobs'
import { uploadPodPhoto } from '../api/storage'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { MyJob, MyJobOrder } from '../types'
import { TRIP_STATUS_LABEL } from '../utils/constants'
import { fmtWeightHuman } from '../utils/format'
import { Badge, Button, EmptyState, ErrorBox, Field, Input, Modal, Skeleton, Textarea } from '../components/ui'
import { SignaturePad } from '../components/SignaturePad'
import { CameraCapture } from '../components/CameraCapture'
import { JobFocus } from '../components/driver/JobFocus'
import type { CompressedImage } from '../utils/image'
import { IconTruck } from '../components/icons'

/**
 * หน้าของคนขับ — ออกแบบให้ใช้บนมือถือในรถเป็นหลัก
 *
 * โครงหลักคือ "หนึ่งงานเต็มจอ" ไม่ใช่รายการงานทั้งหมด:
 *  • เปิดมาแล้วเห็นเที่ยวที่กำลังวิ่งทันที ไม่ต้องเลื่อนหา
 *  • จุดส่งถัดไปได้พื้นที่มากที่สุด จุดอื่นย่อเหลือบรรทัดเดียว
 *  • ปุ่มหลักตรึงล่างจอเสมอ อยู่ในระยะนิ้วโป้ง
 *  • เที่ยวอื่นย้ายไปอยู่หลังปุ่มเดียว เปิดเป็นแผ่นซ้อน
 *  • ที่อยู่/เบอร์โทรเป็นปุ่มใหญ่ กดแล้วเปิดแผนที่/โทรออกได้ทันที
 *  • ไม่มีตัวเลขเงินเลย — server ไม่ได้ส่งมาให้ตั้งแต่ต้น
 */
export default function CloudMyJobs(): React.JSX.Element {
  const { can } = useCloudAuth()
  const toast = useToast()
  const [jobs, setJobs] = useState<MyJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [busy, setBusy] = useState(0)
  // แยกจาก busy เพราะ busy เก็บเลขเที่ยว ส่วนนี่เก็บเลขออเดอร์ — ชนกันได้ถ้าใช้ตัวเดียว
  const [delivering, setDelivering] = useState(0)
  const [podFor, setPodFor] = useState<MyJobOrder | null>(null)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [switching, setSwitching] = useState(false)

  const load = (all: boolean): void => {
    setLoading(true)
    listMyJobs(all)
      .then((d) => {
        setJobs(d)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => load(showDone), [showDone])

  /* เที่ยวที่ควรโชว์เป็นค่าเริ่มต้น: กำลังวิ่งก่อน แล้วค่อยเที่ยวที่วางแผนไว้
     คนขับมีเที่ยวที่ยังไม่จบพร้อมกันได้หลายใบ แต่ "กำลังวิ่ง" มีความหมายชัดที่สุด */
  const defaultJob = useMemo(
    () => jobs.find((j) => j.status === 'in_progress') ?? jobs.find((j) => j.status === 'planned') ?? jobs[0] ?? null,
    [jobs],
  )
  const active = jobs.find((j) => j.id === activeId) ?? defaultJob
  const others = jobs.filter((j) => j.id !== active?.id)

  const act = async (job: MyJob, action: 'start' | 'complete'): Promise<void> => {
    setBusy(job.id)
    try {
      /* ฟังก์ชันฝั่ง DB คืน void ไม่ใช่เที่ยวที่อัปเดตแล้ว — ต้องโหลดกลับมาเอง
         ตั้งใจให้เป็นแบบนั้น: สถานะจริงถูกคำนวณจากออเดอร์ในเที่ยว การให้ฟังก์ชัน
         "เดา" ผลลัพธ์กลับมาเองคือเปิดช่องให้หน้าจอกับฐานข้อมูลไม่ตรงกัน */
      await (action === 'start' ? startTrip(job.id) : completeTrip(job.id))
      const updated = await reloadJob(job.id, showDone)
      setJobs((list) => (updated ? list.map((j) => (j.id === job.id ? updated : j)) : list.filter((j) => j.id !== job.id)))
      toast.push('success', action === 'start' ? `เริ่มเดินทาง ${job.trip_no}` : `ปิดงาน ${job.trip_no} เรียบร้อย`)
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setBusy(0)
    }
  }

  /* ปิดร้านทีละจุด แล้วเปิดฟอร์ม POD ต่อทันทีในจังหวะเดียว
     คนขับยืนอยู่หน้าร้านตอนนั้น ถ้าให้กลับมากดอีกทีทีหลัง ลายเซ็นก็เก็บไม่ได้แล้ว */
  const deliver = async (order: MyJobOrder): Promise<void> => {
    setDelivering(order.id)
    try {
      await deliverOrder(order.id)
      const updated = await reloadJob(order.trip_id, showDone)
      if (updated) setJobs((list) => list.map((j) => (j.id === updated.id ? updated : j)))
      toast.push('success', `ส่ง ${order.destination} เรียบร้อย`)
      if (can('myjobs.pod')) setPodFor(updated?.orders.find((o) => o.id === order.id) ?? order)
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setDelivering(0)
    }
  }

  if (error) return <ErrorBox message={error} onRetry={() => load(showDone)} />

  return (
    <div className="driver-scope">
      <header className="driver-head">
        <h1 className="driver-title">งานของฉัน</h1>
        <Button variant="ghost" size="sm" onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'ดูเฉพาะงานค้าง' : 'ดูงานที่จบแล้วด้วย'}
        </Button>
      </header>

      {loading ? (
        <Skeleton height={320} />
      ) : !active ? (
        <EmptyState
          icon={<IconTruck size={28} />}
          title="ยังไม่มีงานที่มอบหมาย"
          desc="เมื่อฝ่ายวางแผนจัดเที่ยวให้ งานจะขึ้นที่นี่ทันที"
        />
      ) : (
        <>
          <JobFocus
            job={active}
            busy={busy === active.id}
            deliveringId={delivering}
            canProgress={can('myjobs.progress')}
            canPod={can('myjobs.pod')}
            onAct={(job, action) => void act(job, action)}
            onPod={setPodFor}
            onDeliver={(order) => void deliver(order)}
          />

          {others.length > 0 && (
            <Button variant="outline" className="driver-switch" onClick={() => setSwitching(true)}>
              เที่ยวอื่น ({others.length})
            </Button>
          )}
        </>
      )}

      {switching && (
        <Modal open onClose={() => setSwitching(false)} title="เลือกเที่ยววิ่ง">
          <ul className="trip-switch-list">
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  className={`trip-switch${j.id === active?.id ? ' is-active' : ''}`}
                  onClick={() => {
                    setActiveId(j.id)
                    setSwitching(false)
                  }}
                  aria-current={j.id === active?.id ? 'true' : undefined}
                >
                  <span className="trip-switch-no">{j.trip_no}</span>
                  <span className="trip-switch-meta">
                    {j.vehicle_plate} · {j.orders.length} จุดส่ง · {fmtWeightHuman(j.total_weight)}
                  </span>
                  <Badge label={TRIP_STATUS_LABEL[j.status]} tone={j.status} />
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {podFor && (
        <PodSheet
          order={podFor}
          onClose={() => setPodFor(null)}
          onSaved={() => {
            setPodFor(null)
            toast.push('success', 'บันทึกหลักฐานการส่งมอบแล้ว')
            load(showDone)
          }}
        />
      )}
    </div>
  )
}

/** เก็บ POD จากในรถ — ลายเซ็น + ชื่อผู้รับ + รูปหน้างาน + พิกัด ครบในครั้งเดียว */
function PodSheet({ order, onClose, onSaved }: { order: MyJobOrder; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const toast = useToast()
  const [name, setName] = useState(order.customer_name ?? '')
  const [sig, setSig] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<CompressedImage | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [saving, setSaving] = useState(false)

  // ปล่อย object URL ของรูปเมื่อเปลี่ยนรูปหรือปิดฟอร์ม — ไม่งั้นค้างใน memory ทั้งวัน
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url) }, [photo])

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {
        /* ปฏิเสธตำแหน่งได้ — POD ยังบันทึกได้ แค่ไม่มีพิกัดแนบ */
      },
      { timeout: 8000 },
    )
  }, [])

  const submit = async (): Promise<void> => {
    if (!sig) {
      toast.push('warning', 'ให้ผู้รับเซ็นก่อน')
      return
    }
    setSaving(true)
    try {
      /* อัปโหลดรูปขึ้น Storage ก่อน แล้วค่อยบันทึก POD พร้อม path
         ลำดับนี้สำคัญ: ถ้าบันทึก POD ก่อนแล้วอัปรูปพลาด จะได้หลักฐานที่อ้างถึงรูปที่ไม่มีอยู่
         กลับกัน ถ้าอัปรูปสำเร็จแต่บันทึกพลาด ก็แค่มีรูปกำพร้าค้างในถัง ซึ่งไม่ทำใครเดือดร้อน */
      const photoPath = photo ? await uploadPodPhoto(order.id, photo.blob) : null

      await savePod({
        orderId: order.id,
        recipientName: name,
        signatureData: sig,
        photoPath,
        notes: note || null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      })
      onSaved()
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`หลักฐานการส่งมอบ — ${order.order_no}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={() => void submit()} loading={saving} disabled={!name.trim() || !sig}>
            บันทึกหลักฐาน
          </Button>
        </>
      }
    >
      <Field label="ชื่อผู้รับสินค้า" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="ลายเซ็นผู้รับ" required hint="ให้ผู้รับเซ็นบนหน้าจอด้วยนิ้ว">
        <div>
          <SignaturePad onChange={setSig} />
        </div>
      </Field>
      <Field label="รูปหน้างาน" hint="ถ่ายสภาพสินค้า/จุดส่ง — รูปถูกส่งขึ้นระบบทันที ไม่เก็บลงเครื่อง">
        <div>
          {photo ? (
            <div className="cam-shots">
              <div className="cam-shot">
                <img src={photo.url} alt="รูปหน้างานที่ถ่ายไว้" />
                <button type="button" aria-label="ลบรูปนี้แล้วถ่ายใหม่" onClick={() => setPhoto(null)}>
                  ✕
                </button>
              </div>
              <span className="text-xs text-muted">{Math.round(photo.bytes / 1024)} KB</span>
            </div>
          ) : (
            <CameraCapture onCapture={setPhoto} disabled={saving} />
          )}
        </div>
      </Field>
      <Field label="หมายเหตุ">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ของครบ สภาพเรียบร้อย" />
      </Field>
      <p className="text-xs text-muted">
        {coords ? `แนบพิกัด ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'ไม่ได้ตำแหน่ง GPS — บันทึกได้ตามปกติ'}
      </p>
    </Modal>
  )
}
