import { useEffect, useMemo, useState } from 'react'
import {
  listMyJobs, reloadJob, startTrip, completeTrip, deliverOrder,
  savePodWithPhotos, POD_PHOTO_KINDS, type PodPhoto,
  acceptTrip, reportIssue, saveStopOrder,
} from '../api/myjobs'
import { useRealtime } from '../hooks/useRealtime'
import { useTripTracking } from '../hooks/useTripTracking'
import { uploadPodPhoto } from '../api/storage'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { MyJob, MyJobOrder } from '../types'
import { jobTripNo, type StopGroup } from '../utils/stops'
import { TRIP_STATUS_LABEL } from '../utils/constants'
import { fmtDateTime, fmtLongToday, fmtWeightHuman } from '../utils/format'
import { applyTheme, currentTheme, type Theme } from '../utils/theme'
import { Badge, Button, EmptyState, ErrorBox, Field, Input, Modal, Select, Skeleton, Textarea } from '../components/ui'
import { SignaturePad } from '../components/SignaturePad'
import { CameraCapture } from '../components/CameraCapture'
import { JobFocus } from '../components/driver/JobFocus'
import type { CompressedImage } from '../utils/image'
import { IconCheck, IconTruck, IconUsers } from '../components/icons'
import { ChangePasswordModal } from '../components/ChangePasswordModal'

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
  const { can, user, logout } = useCloudAuth()
  const toast = useToast()
  const [jobs, setJobs] = useState<MyJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /* โหลดงานที่จบแล้วมาด้วยเสมอ — เดิมเป็นสวิตช์ "ดูงานที่จบแล้วด้วย" ที่คนขับต้องไปหาเจอก่อน
     ตอนนี้มันคือแท็บ "ประวัติ" ที่ล่างจอ ซึ่งเห็นตลอดเวลา */
  const showDone = true
  /* แท็บล่างจอ — โครงของแอปที่ใช้งานจริงบนมือถือ นิ้วโป้งถึงทุกอันโดยไม่ต้องขยับมือ */
  const [tab, setTab] = useState<'jobs' | 'history' | 'me'>('jobs')
  const [pwOpen, setPwOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => currentTheme())
  const [busy, setBusy] = useState(0)
  // แยกจาก busy เพราะ busy เก็บเลขเที่ยว ส่วนนี่เก็บร้านที่กำลังปิด — ชนกันได้ถ้าใช้ตัวเดียว
  const [delivering, setDelivering] = useState('')
  /* POD เก็บเป็นชุดของ "ร้าน" ไม่ใช่ใบเดียว — ลายเซ็นหนึ่งครั้งครอบทุกใบที่ส่งร้านนั้น
     ผู้รับเซ็นครั้งเดียวตอนรับของทั้งกอง ให้เซ็นซ้ำตามจำนวนใบคือเรื่องที่หน้างานไม่ยอมทำ */
  const [podFor, setPodFor] = useState<MyJobOrder[] | null>(null)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [issueFor, setIssueFor] = useState<MyJob | null>(null)
  const [issueNote, setIssueNote] = useState('')
  const [sendingIssue, setSendingIssue] = useState(false)

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

  useEffect(() => load(showDone), [])

  /* คนขับถือมือถือวิ่งอยู่ ฝ่ายจัดรถแก้เที่ยวให้ระหว่างทางได้ — งานที่ถูกเพิ่ม/ถอด
     ต้องขึ้นเองโดยไม่ต้องบอกให้คนขับดึงหน้าจอรีเฟรชกลางถนน */
  useRealtime(['trips', 'orders'], () => load(showDone))

  /* เที่ยวที่ควรโชว์เป็นค่าเริ่มต้น: กำลังวิ่งก่อน แล้วค่อยเที่ยวที่วางแผนไว้
     คนขับมีเที่ยวที่ยังไม่จบพร้อมกันได้หลายใบ แต่ "กำลังวิ่ง" มีความหมายชัดที่สุด */
  /* งานที่ยังไม่จบเท่านั้นที่อยู่ในแท็บงาน — งานที่ปิดแล้วเป็นประวัติ ไม่ใช่สิ่งที่ต้องทำ */
  const live = useMemo(() => jobs.filter((j) => j.status !== 'completed' && j.status !== 'cancelled'), [jobs])
  const done = useMemo(() => jobs.filter((j) => j.status === 'completed' || j.status === 'cancelled'), [jobs])
  const defaultJob = useMemo(
    () => live.find((j) => j.status === 'in_progress') ?? live.find((j) => j.status === 'planned') ?? live[0] ?? null,
    [live],
  )
  /* การ์ดที่กางอยู่ — ค่าเริ่มต้นคือเที่ยวที่กำลังวิ่ง ถ้าหุบหมดจะเก็บเป็น -1
     (ไม่ใช่ null เพราะ null แปลว่า "ยังไม่เลือก" ซึ่งต้องถอยไปใช้ค่าเริ่มต้น) */
  const active = activeId === -1 ? null : live.find((j) => j.id === activeId) ?? defaultJob
  /* งานใหม่ที่ยังไม่ได้กดรับ — ตัวเลขบนแท็บมีไว้ตอบว่า "มีอะไรรอฉันอยู่ไหม" โดยไม่ต้องเปิดดู */
  const unread = live.filter((j) => !(j.my_accepted_at ?? j.accepted_at)).length
  /* บันทึกตำแหน่งเฉพาะเที่ยวที่รับแล้วและยังไม่จบ — นอกช่วงนั้นไม่ใช่เรื่องของระบบนี้ */
  /* ตามตำแหน่งของเที่ยวที่กำลังวิ่ง ไม่ใช่การ์ดที่เผอิญกางอยู่ — คนขับหุบการ์ดแล้ว
     ตำแหน่งต้องไม่หยุดบันทึก งานยังวิ่งอยู่เหมือนเดิม */
  const tracked = live.find((j) => j.status === 'in_progress' && (j.my_accepted_at ?? j.accepted_at)) ?? null
  const tracking = useTripTracking(
    tracked?.id ?? null,
    /* ของ "ฉัน" ไม่ใช่ของเที่ยว — ผู้ช่วยที่ยังไม่กดรับไม่ควรถูกตามตำแหน่ง
       เขายังไม่ได้ยืนยันว่ารับงานนี้ด้วยซ้ำ */
    tracked !== null,
  )

  /* ขอสิทธิ์ตำแหน่งก่อนรับงาน ไม่ใช่หลังจากนั้น — งานที่รับแล้วแต่ตามไม่ได้
     ทำให้คนวางแผนตอบลูกค้าไม่ได้ทั้งวัน ปฏิเสธได้ แต่ต้องรู้ตัวว่ากำลังปฏิเสธอะไร */
  const askLocation = (): Promise<boolean> =>
    new Promise((resolve) => {
      if (!('geolocation' in navigator)) { resolve(false); return }
      navigator.geolocation.getCurrentPosition(() => resolve(true), () => resolve(false), { timeout: 10_000 })
    })

  const act = async (job: MyJob, action: 'start' | 'complete' | 'accept'): Promise<void> => {
    if (action === 'accept' && !(await askLocation())) {
      toast.push('warning',
        'ต้องอนุญาตให้แอปเห็นตำแหน่งก่อนรับงาน — เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์แล้วกดใหม่')
      return
    }
    setBusy(job.id)
    try {
      /* ฟังก์ชันฝั่ง DB คืน void ไม่ใช่เที่ยวที่อัปเดตแล้ว — ต้องโหลดกลับมาเอง
         ตั้งใจให้เป็นแบบนั้น: สถานะจริงถูกคำนวณจากออเดอร์ในเที่ยว การให้ฟังก์ชัน
         "เดา" ผลลัพธ์กลับมาเองคือเปิดช่องให้หน้าจอกับฐานข้อมูลไม่ตรงกัน */
      await (action === 'accept' ? acceptTrip(job.id)
        : action === 'start' ? startTrip(job.id)
        : completeTrip(job.id))
      const updated = await reloadJob(job.id, showDone)
      setJobs((list) => (updated ? list.map((j) => (j.id === job.id ? updated : j)) : list.filter((j) => j.id !== job.id)))
      toast.push('success',
        action === 'accept' ? `รับงาน ${jobTripNo(job)} แล้ว`
          : action === 'start' ? `เริ่มเดินทาง ${jobTripNo(job)}`
          : `ปิดงาน ${jobTripNo(job)} เรียบร้อย`)
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setBusy(0)
    }
  }

  const submitIssue = async (): Promise<void> => {
    if (!issueFor) return
    if (!issueNote.trim()) { toast.push('warning', 'ระบุปัญหาที่พบ'); return }
    setSendingIssue(true)
    try {
      await reportIssue(issueFor.id, issueNote.trim())
      const updated = await reloadJob(issueFor.id, showDone)
      setJobs((list) => (updated ? list.map((j) => (j.id === issueFor.id ? updated : j)) : list))
      toast.push('success', 'ส่งให้ฝ่ายวางแผนแล้ว')
      setIssueFor(null)
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setSendingIssue(false)
    }
  }

  /* ปิดร้านทีละร้าน ทุกใบของร้านนั้นพร้อมกัน แล้วเปิดฟอร์ม POD ต่อทันทีในจังหวะเดียว
     คนขับยืนอยู่หน้าร้านตอนนั้น ถ้าให้กลับมากดอีกทีทีหลัง ลายเซ็นก็เก็บไม่ได้แล้ว */
  const deliver = async (stop: StopGroup): Promise<void> => {
    setDelivering(stop.key)
    try {
      /* ทีละใบตามลำดับ ไม่ยิงพร้อมกัน — ฝั่งฐานคำนวณสถานะเที่ยวใหม่ทุกครั้งที่ปิดใบ
         ยิงขนานกันแล้วจะแย่งกันเขียนสถานะเดียวกัน */
      for (const order of stop.pending) await deliverOrder(order.id)
      const tripId = stop.orders[0]?.trip_id
      const updated = tripId ? await reloadJob(tripId, showDone) : null
      if (updated) setJobs((list) => list.map((j) => (j.id === updated.id ? updated : j)))
      toast.push('success', `ส่ง ${stop.customer_name ?? stop.destination} เรียบร้อย`)
      if (can('myjobs.pod')) {
        const ids = new Set(stop.orders.map((o) => o.id))
        setPodFor(updated ? updated.orders.filter((o) => ids.has(o.id)) : stop.orders)
      }
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setDelivering('')
    }
  }

  /* จัดลำดับแล้วเห็นผลทันทีบนจอ ไม่รอเซิร์ฟเวอร์ตอบ — คนขับกดขึ้น/ลงรัว ๆ ได้
     ถ้าบันทึกไม่ผ่าน ค่อยโหลดของจริงกลับมาแล้วบอกว่าไม่สำเร็จ */
  const reorder = async (job: MyJob, orderIds: number[]): Promise<void> => {
    const sorted = orderIds
      .map((id) => job.orders.find((o) => o.id === id))
      .filter((o): o is MyJobOrder => o !== undefined)
    setJobs((list) => list.map((j) => (j.id === job.id ? { ...j, orders: sorted } : j)))
    try {
      await saveStopOrder(job.id, orderIds)
    } catch (e) {
      const updated = await reloadJob(job.id, showDone)
      if (updated) setJobs((list) => list.map((j) => (j.id === updated.id ? updated : j)))
      toast.push('error', (e as Error).message)
    }
  }

  if (error) return <ErrorBox message={error} onRetry={() => load(showDone)} />

  return (
    <div className="driver-scope">
      <header className="driver-head">
        <h1 className="driver-title">
          {tab === 'jobs' ? 'งานของฉัน' : tab === 'history' ? 'ประวัติงาน' : 'บัญชีของฉัน'}
        </h1>
        {tab === 'jobs' && live.length > 1 && (
          <span className="text-xs text-muted">{live.length} เที่ยวที่ยังไม่จบ</span>
        )}
      </header>

      {tab === 'history' && (
        /* ประวัติเป็นรายการอ่านอย่างเดียว — ปิดงานแล้วไม่มีปุ่มอะไรให้กดอีก
           สิ่งที่คนขับมาหาที่นี่คือ "เมื่อวานฉันวิ่งกี่เที่ยว ร้านไหนบ้าง" */
        <ul className="trip-switch-list">
          {done.length === 0 && (
            <EmptyState icon={<IconTruck size={28} />} title="ยังไม่มีงานที่ปิดแล้ว" desc="งานที่ปิดงานเรียบร้อยจะมาอยู่ที่นี่" />
          )}
          {done.map((j) => (
            <li key={j.id}>
              <div className="trip-switch">
                <span className="trip-switch-no">{jobTripNo(j)}</span>
                <span className="trip-switch-meta">
                  {j.vehicle_plate} · {j.orders.length} ใบ · {fmtWeightHuman(j.total_weight)}
                  {j.arrived_at ? ` · ปิดงาน ${fmtDateTime(j.arrived_at)}` : ''}
                </span>
                <Badge label={TRIP_STATUS_LABEL[j.status]} tone={j.status} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {tab === 'me' && (
        <div className="driver-me">
          <div className="driver-me-card">
            <span className="driver-me-name">{user?.name}</span>
            <span className="driver-me-sub">{user?.username} · พนักงานขับรถ · {fmtLongToday()}</span>
          </div>
          {/* ปุ่มธีมเคยอยู่บนแถบบนที่ถูกถอดออกไป — กลางแดดกับตอนกลางคืนคนละเรื่องกัน
              คนขับต้องสลับเองได้ */}
          <Button variant="outline" className="driver-me-action"
            onClick={() => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); applyTheme(next) }}>
            {theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
          </Button>
          {/* สองอย่างที่คนขับต้องทำเองได้จริงจากในรถ ไม่ต้องโทรหาออฟฟิศ */}
          <Button variant="outline" className="driver-me-action" onClick={() => setPwOpen(true)}>
            เปลี่ยนรหัสผ่าน
          </Button>
          <Button variant="ghost" className="driver-me-action" onClick={() => void logout()}>
            ออกจากระบบ
          </Button>
          <p className="text-xs text-muted">
            เปิดหน้านี้ค้างไว้ระหว่างขับ ระบบถึงจะบันทึกตำแหน่งของเที่ยวให้ฝ่ายวางแผนเห็น
          </p>
        </div>
      )}

      {tab === 'jobs' && (loading ? (
        <Skeleton height={320} />
      ) : live.length === 0 ? (
        <EmptyState
          icon={<IconTruck size={28} />}
          title="ยังไม่มีงานที่มอบหมาย"
          desc="เมื่อฝ่ายวางแผนจัดเที่ยวให้ งานจะขึ้นที่นี่ทันที"
        />
      ) : (
        <div className="job-list">
          {/* ทุกเที่ยวหุบเป็นแถวเดียว กางทีละเที่ยว — คนขับถือหลายเที่ยวพร้อมกันได้
              กางทุกเที่ยวพร้อมกันคือจอที่ต้องเลื่อนผ่านจุดส่งของเที่ยวอื่นก่อนถึงของตัวเอง
              และเสี่ยงกดปิดจุดผิดเที่ยว ซึ่งย้อนกลับไม่ได้ */}
          {live.map((job) => {
            const open = job.id === active?.id
            const delivered = job.orders.filter((o) => o.status === 'delivered').length
            const mine = job.my_accepted_at ?? job.accepted_at
            return (
              <section key={job.id} className={`job-card${open ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="job-card-head"
                  aria-expanded={open}
                  onClick={() => setActiveId(open ? -1 : job.id)}
                >
                  <span className="job-card-text">
                    <span className="job-card-no">{jobTripNo(job)}</span>
                    <span className="job-card-meta">
                      {job.vehicle_plate} · ส่งแล้ว {delivered}/{job.orders.length} ใบ
                      {!mine ? ' · งานใหม่' : ''}
                    </span>
                  </span>
                  <Badge label={TRIP_STATUS_LABEL[job.status]} tone={job.status} dot={job.status === 'in_progress'} />
                </button>

                {open && (
                  <div className="job-card-body">
                    <JobFocus
                      job={job}
                      busy={busy === job.id}
                      deliveringKey={delivering}
                      canProgress={can('myjobs.progress')}
                      canPod={can('myjobs.pod')}
                      onAct={(j, action) => void act(j, action)}
                      onReportIssue={(j) => { setIssueFor(j); setIssueNote('') }}
                      onPod={(stop) => setPodFor(stop.needPod.length > 0 ? stop.needPod : stop.orders)}
                      onDeliver={(stop) => void deliver(stop)}
                      onReorder={(j, ids) => void reorder(j, ids)}
                    />

                    {/* บอกตรง ๆ ว่าตอนนี้บันทึกอยู่หรือไม่ — เบราว์เซอร์หยุดให้ตำแหน่งเมื่อพับหน้าจอ
                        ถ้าไม่บอก คนขับจะเชื่อว่ามีการบันทึกตลอดเวลา แล้ววันที่ต้องใช้จะไม่มีข้อมูล */}
                    {mine && (
                      <p className={`track-note${tracking === 'denied' ? ' is-off' : ''}`}>
                        {tracking === 'on'
                          ? 'กำลังบันทึกตำแหน่งของเที่ยวนี้ — เปิดหน้านี้ค้างไว้ระหว่างขับ'
                          : tracking === 'denied'
                            ? 'ไม่ได้รับสิทธิ์ตำแหน่ง — ฝ่ายวางแผนจะไม่เห็นว่ารถอยู่ไหน'
                            : tracking === 'unsupported'
                              ? 'เครื่องนี้ไม่รองรับการระบุตำแหน่ง'
                              : 'กำลังขอตำแหน่ง…'}
                      </p>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      ))}

      {/* แถบล่างจอ — โครงเดียวกับแอปที่คนใช้ทุกวัน ถึงด้วยนิ้วโป้งข้างเดียว
          ไม่ใช่เมนูที่ต้องกดเปิดจากมุมบนซ้ายก่อนถึงจะเห็นว่ามีอะไรบ้าง */}
      <nav className="driver-tabs" aria-label="เมนูหลัก">
        <button type="button" className={`driver-tab${tab === 'jobs' ? ' is-active' : ''}`}
          aria-current={tab === 'jobs' ? 'page' : undefined} onClick={() => setTab('jobs')}>
          <IconTruck size={20} />
          <span>งานของฉัน</span>
          {unread > 0 && <span className="driver-tab-badge" aria-label={`งานใหม่ ${unread}`}>{unread}</span>}
        </button>
        <button type="button" className={`driver-tab${tab === 'history' ? ' is-active' : ''}`}
          aria-current={tab === 'history' ? 'page' : undefined} onClick={() => setTab('history')}>
          <IconCheck size={20} />
          <span>ประวัติ</span>
        </button>
        <button type="button" className={`driver-tab${tab === 'me' ? ' is-active' : ''}`}
          aria-current={tab === 'me' ? 'page' : undefined} onClick={() => setTab('me')}>
          <IconUsers size={20} />
          <span>ฉัน</span>
        </button>
      </nav>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} onDone={() => setPwOpen(false)} />

      {podFor && (
        <PodSheet
          orders={podFor}
          onClose={() => setPodFor(null)}
          onSaved={() => {
            setPodFor(null)
            toast.push('success', 'บันทึกหลักฐานการส่งมอบแล้ว')
            load(showDone)
          }}
        />
      )}

      <Modal
        open={issueFor !== null}
        onClose={() => setIssueFor(null)}
        title={issueFor ? `แจ้งปัญหา — ${jobTripNo(issueFor)}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setIssueFor(null)}>ปิด</Button>
            <Button variant="accent" loading={sendingIssue} onClick={() => void submitIssue()}>
              ส่งให้ฝ่ายวางแผน
            </Button>
          </>
        }
      >
        {/* บอกให้ชัดว่านี่ไม่ใช่การคืนงาน ไม่งั้นคนขับจะกดแล้วเข้าใจว่าไม่ต้องไปแล้ว */}
        <p className="job-sub" style={{ marginBottom: 10 }}>
          งานยังเป็นของคุณอยู่ — ข้อความนี้จะไปขึ้นบนกระดานของฝ่ายวางแผนให้เขาติดต่อกลับ
        </p>
        <Field label="ปัญหาที่พบ" required>
          <Textarea
            value={issueNote}
            onChange={(e) => setIssueNote(e.target.value)}
            placeholder="เช่น รถเสีย / ของไม่ครบ / ไปไม่ทันเวลา"
            style={{ minHeight: 90 }}
          />
        </Field>
      </Modal>
    </div>
  )
}

const podKindLabel = (kind: string): string =>
  POD_PHOTO_KINDS.find((k) => k.kind === kind)?.label ?? kind

/**
 * เก็บ POD จากในรถ — ลายเซ็น + ชื่อผู้รับ + รูปหน้างาน + พิกัด ครบในครั้งเดียว
 *
 * รับมาเป็น "ใบทั้งหมดของร้านนี้" ลายเซ็นชุดเดียวถูกบันทึกลงทุกใบ เพราะผู้รับ
 * เซ็นรับของทั้งกองครั้งเดียวจริง ๆ ส่วนฐานยังเก็บ POD ผูกกับใบเหมือนเดิม
 * ฝ่ายบัญชีจึงยังเปิดหลักฐานรายใบได้
 */
function PodSheet({ orders, onClose, onSaved }: { orders: MyJobOrder[]; onClose: () => void; onSaved: () => void }): React.JSX.Element {
  const toast = useToast()
  const order = orders[0] as MyJobOrder
  const [name, setName] = useState(order.customer_name ?? '')
  const [sig, setSig] = useState('')
  const [note, setNote] = useState('')
  /* หลายมุมต่อหนึ่งใบ — ข้อโต้แย้งเรื่องการส่งของถามหลายอย่างพร้อมกัน
     ของที่ส่ง สภาพหน้าร้าน และใบเซ็นรับ รูปเดียวตอบได้ข้อเดียว */
  const [shots, setShots] = useState<{ img: CompressedImage; kind: string }[]>([])
  const [kind, setKind] = useState<string>(POD_PHOTO_KINDS[0].kind)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [saving, setSaving] = useState(false)

  // ปล่อย object URL ของรูปเมื่อปิดฟอร์ม — ไม่งั้นค้างใน memory ทั้งวัน
  useEffect(() => () => { shots.forEach((s) => URL.revokeObjectURL(s.img.url)) }, [shots])

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
      const photos: PodPhoto[] = []
      for (const shot of shots) {
        photos.push({ path: await uploadPodPhoto(order.id, shot.img.blob), kind: shot.kind })
      }

      /* ทีละใบตามลำดับ — รูปชุดเดียวถูกอ้างจากทุกใบ ไม่ต้องอัปซ้ำตามจำนวนใบ */
      for (const o of orders) {
        await savePodWithPhotos({
          orderId: o.id,
          recipientName: name,
          signatureData: sig,
          photos,
          notes: note || null,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        })
      }
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
      title={`หลักฐานการส่งมอบ — ${order.customer_name ?? order.destination}`}
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
      {orders.length > 1 && (
        <p className="job-sub" style={{ marginBottom: 10 }}>
          ลายเซ็นนี้ใช้กับใบทั้งหมด {orders.length} ใบของร้านนี้
        </p>
      )}
      <Field label="ชื่อผู้รับสินค้า" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="ลายเซ็นผู้รับ" required hint="ให้ผู้รับเซ็นบนหน้าจอด้วยนิ้ว">
        <div>
          <SignaturePad onChange={setSig} />
        </div>
      </Field>
      <Field label="รูปหน้างาน" hint="ถ่ายได้หลายมุม — เลือกว่ากำลังถ่ายอะไรก่อนกดถ่าย รูปส่งขึ้นระบบทันที ไม่เก็บลงเครื่อง">
        <div>
          {shots.length > 0 && (
            <div className="cam-shots">
              {shots.map((shot, i) => (
                <div className="cam-shot" key={shot.img.url}>
                  <img src={shot.img.url} alt={`รูป${podKindLabel(shot.kind)}ที่ถ่ายไว้`} />
                  <button
                    type="button"
                    aria-label={`ลบรูป${podKindLabel(shot.kind)}`}
                    onClick={() => {
                      URL.revokeObjectURL(shot.img.url)
                      setShots(shots.filter((_, x) => x !== i))
                    }}
                  >
                    ✕
                  </button>
                  <span className="cam-shot-kind">{podKindLabel(shot.kind)}</span>
                </div>
              ))}
            </div>
          )}
          <Select value={kind} onChange={(e) => setKind(e.target.value)} disabled={saving}>
            {POD_PHOTO_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>{k.label}</option>
            ))}
          </Select>
          <CameraCapture
            onCapture={(img) => setShots([...shots, { img, kind }])}
            disabled={saving}
          />
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
