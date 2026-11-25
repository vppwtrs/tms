import { useEffect, useMemo, useState } from 'react'
import {
  listMyJobs, reloadJob, startTrip, completeTrip, finishReturn, deliverOrder, undoDeliverOrder,
  cancelStop, undoCancelStop,
  acceptTrip, reportIssue, saveStopOrder,
  logOdometer, odometerStatus, ODOMETER_SUSPECT,
} from '../api/myjobs'
import { useRealtime } from '../hooks/useRealtime'
import { useScreenWakeLock } from '../hooks/useScreenWakeLock'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { useOdometer } from '../hooks/useOdometer'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { MyJob, MyJobOrder } from '../types'
import { groupStops, jobTripNo, type StopGroup } from '../utils/stops'
import { activeJob, autoOpenJob, doneJobs, dutyVehicle, filterHistory, groupHistory, liveJobs, presetRange } from '../utils/jobs'
import type { HistoryRange } from '../utils/jobs'
import { closingJobs, finishGate, parseKm, podGapsOf, podRowsOf, tollFor } from '../utils/driverActions'
import { CANCEL_STOP_REASONS, TRIP_STATUS_LABEL } from '../utils/constants'
import { fmtDate, fmtDateTime, fmtLongToday, fmtTime } from '../utils/format'
import { applyThemePref, getThemePref, type ThemePref } from '../utils/theme'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, Skeleton, Textarea } from '../components/ui'
import { HistoryStopPod } from '../components/driver/HistoryStopPod'
import { PodViewModal } from '../components/PodViewModal'
import { JobFocus } from '../components/driver/JobFocus'
import { RangeCalendar, shortThai } from '../components/driver/RangeCalendar'
import { PodSheet } from '../components/driver/PodSheet'
import { IssueSheet } from '../components/driver/IssueSheet'
import {
  IconAlert, IconCalendar, IconChevronLeft, IconCheck, IconClock, IconChevronRight, IconKey, IconLogout, IconMoon, IconSun, IconTruck, IconUsers,
} from '../components/icons'
import { OdoWarning } from '../components/driver/CloseTrip'
import '../styles/driver-break.css'
import { uploadTripPhoto } from '../api/storage'
import { logCheckpoint } from '../utils/checkpoints'
import { ChangePasswordModal } from '../components/ChangePasswordModal'
import { listShotBackups } from '../utils/podBackup'

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
  /* แท็บล่างจอ — โครงของแอปที่ใช้งานจริงบนมือถือ นิ้วโป้งถึงทุกอันโดยไม่ต้องขยับมือ */
  /* แท็บเริ่มต้นปกติคือ 'jobs' — ค่าจาก env มีไว้ให้ CI เปิดตรงไปแท็บที่จะถ่ายรูป
     ตั้งได้เฉพาะตอน build โหมดสาธิต ของจริงไม่เคยมีค่านี้จึงได้ 'jobs' เสมอ */
  const startTab = import.meta.env.VITE_DEMO_TAB
  const [tab, setTab] = useState<'jobs' | 'history' | 'me'>(
    startTab === 'history' || startTab === 'me' ? startTab : 'jobs',
  )
  const [pwOpen, setPwOpen] = useState(false)
  const [theme, setTheme] = useState<ThemePref>(() => getThemePref())
  /* ตามเครื่อง: ต้องเริ่มฟังการสลับโหมดของเครื่องตั้งแต่เปิดแอป ไม่ใช่แค่ตอนกดเลือก */
  useEffect(() => { if (getThemePref() === 'auto') applyThemePref('auto') }, [])
  const [busy, setBusy] = useState(0)
  // แยกจาก busy เพราะ busy เก็บเลขเที่ยว ส่วนนี่เก็บร้านที่กำลังปิด — ชนกันได้ถ้าใช้ตัวเดียว
  const [delivering, setDelivering] = useState('')
  /* POD เก็บเป็นชุดของ "ร้าน" ไม่ใช่ใบเดียว — ลายเซ็นหนึ่งครั้งครอบทุกใบที่ส่งร้านนั้น
     ผู้รับเซ็นครั้งเดียวตอนรับของทั้งกอง ให้เซ็นซ้ำตามจำนวนใบคือเรื่องที่หน้างานไม่ยอมทำ */
  const [podFor, setPodFor] = useState<MyJobOrder[] | null>(null)
  /* ร้านที่ฟอร์ม POD ที่เปิดอยู่เป็นของมัน — เก็บไว้เพื่อให้ถอนการส่งจากในฟอร์มได้
     คนที่กดปิดผิดร้านรู้ตัวตอนอ่านชื่อร้านบนหัวฟอร์ม ไม่ใช่ตอนกลับไปที่รายการ */
  const [podStop, setPodStop] = useState<StopGroup | null>(null)
  /* ร้านที่กำลังจะถอนการปิดส่ง — ถามก่อนเสมอ การถอยผิดจุดคือกดผิดซ้ำสอง */
  const [undoing, setUndoing] = useState<StopGroup | null>(null)
  /* ร้านที่กำลังจะยกเลิก + เหตุผลที่เลือกไว้ — เก็บแยกกันเพราะกล่องต้องเปิดค้าง
     ระหว่างเลือกเหตุผล ปิดแล้วเปิดใหม่ต้องไม่จำของเดิม */
  const [cancelling, setCancelling] = useState<StopGroup | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelNote, setCancelNote] = useState('')
  const [undoCancelling, setUndoCancelling] = useState<StopGroup | null>(null)
  /* จบงานคือขั้นที่ย้อนไม่ได้จากฝั่งคนขับ — รถถูกนับว่าว่างทันที และเที่ยวหลุดจากจอไปเลย
     ถามยืนยันก่อนหนึ่งครั้ง ไม่ใช่หน่วงเวลา เพราะคนที่กลับถึงคลังจริงไม่ควรต้องรอ */
  const [finishing, setFinishing] = useState<MyJob | null>(null)
  /* ใบที่กำลังเปิดดูหลักฐานย้อนหลัง — คนละอย่างกับ podFor ที่เป็นการเก็บใหม่ */
  const [podView, setPodView] = useState<MyJobOrder | null>(null)
  /* เที่ยวที่กดดูรายละเอียดจากประวัติ — แสดงจุดส่งกับปุ่มเปิดรูปหลักฐานของแต่ละร้าน */
  const [historyJob, setHistoryJob] = useState<MyJob | null>(null)
  const [activeId, setActiveId] = useState<number | null>(null)
  /* เที่ยวใหม่ที่กางพรีวิวอยู่ — อ่านอย่างเดียว ไม่มีปุ่มสั่งงานสักปุ่ม
     คนละอย่างกับ activeId ซึ่งเป็นการ์ดของงานที่รับแล้วและกดสั่งงานได้ */
  const [previewId, setPreviewId] = useState<number | null>(null)
  /* เลขไมล์ประจำวัน — ถามตอนกดจบงาน จังหวะเดียวกับค่าทางด่วน
     ไม่ถามตอนล็อกอิน เพราะคนขับเปิดแอปดูงานจากที่บ้านหรือระหว่างเดินทางมาคลังก็ได้
     ซึ่งตอนนั้นอ่านหน้าปัดไม่ได้ แล้วได้เลขที่เดาส่ง ๆ มา
     ตอนจบงานคนขับจอดแล้ว ยืนอยู่หน้ารถ ใบเสร็จทางด่วนอยู่ในมือ — ถามทีเดียวจบ
     แถบเตือนกับกล่องเดี่ยวยังอยู่ ไว้ใช้วันที่ปิดงานไปแล้วแต่ยังไม่ได้กรอก */
  /* เลขไมล์ที่กรอกในกล่องจบงาน — คนละช่องกับช่องของ useOdometer
     เพราะสองกล่องเปิดพร้อมกันได้ และค่าที่ค้างจากกล่องหนึ่งต้องไม่ไหลไปอีกกล่อง */
  const [finishOdo, setFinishOdo] = useState('')
  const [finishPhoto, setFinishPhoto] = useState<File | null>(null)
  /* ฐานมองว่าเลขตอนกลับผิดปกติ — กดอีกครั้ง = ยืนยัน ส่งให้แอดมินตรวจ
     ไม่มีทางนี้ คนขับที่เลขตอนออกรถผิดจะจบงานไม่ได้เลย (เหตุการณ์ 22 ก.ย. 69) */
  const [finishSuspect, setFinishSuspect] = useState<string | null>(null)
  /* ค่าทางด่วนของวัน — ถามตอนกดจบงาน จังหวะเดียวที่ใบเสร็จยังอยู่ในมือ
     null = ยังไม่ตอบ ต่างจาก false ที่แปลว่าตอบแล้วว่าไม่มี */
  const [tollHas, setTollHas] = useState<boolean | null>(null)
  const [tollAmount, setTollAmount] = useState('')
  /* พับไว้ก่อนเสมอ — คนขับส่วนใหญ่เชื่อระบบและกดผ่านไปเลย เห็นรายการทุกครั้งคือ
     ความยาวที่ต้องเลื่อนผ่านโดยไม่ได้ใช้ เปิดเองเมื่ออยากตรวจจริง ๆ เท่านั้น */
  const [podListOpen, setPodListOpen] = useState(false)
  const [issueFor, setIssueFor] = useState<MyJob | null>(null)
  const [issueNote, setIssueNote] = useState('')
  const [sendingIssue, setSendingIssue] = useState(false)

  const load = (): void => {
    setLoading(true)
    listMyJobs()
      .then((d) => {
        setJobs(d)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => load(), [])

  /* โหลดใหม่แบบไม่ล้างจอ — ท่าลากลงต้องเห็นของเดิมค้างอยู่ระหว่างรอ
     ถ้าสลับไปเป็นโครงร่างเปล่าทุกครั้ง คนขับจะเสียตำแหน่งที่กำลังอ่านอยู่ */
  const refresh = async (): Promise<void> => {
    try {
      setJobs(await listMyJobs())
      setError('')
    } catch (e) {
      toast.push('error', (e as Error).message)
    }
  }

  /* ลากลงจากบนสุดเพื่อโหลดใหม่ — ไม่มีปุ่มรีเฟรชบนแถบหัวโดยตั้งใจ
     ปุ่มกินที่ที่แคบอยู่แล้วและต้องเล็งกด ส่วนท่าลากลงทุกคนทำเป็นอยู่แล้ว */
  const pull = usePullToRefresh(refresh)

  /* คนขับถือมือถือวิ่งอยู่ ฝ่ายจัดรถแก้เที่ยวให้ระหว่างทางได้ — งานที่ถูกเพิ่ม/ถอด
     ต้องขึ้นเองโดยไม่ต้องบอกให้คนขับดึงหน้าจอรีเฟรชกลางถนน */
  useRealtime(['trips', 'orders'], () => load())

  /* เที่ยวที่ควรโชว์เป็นค่าเริ่มต้น: กำลังวิ่งก่อน แล้วค่อยเที่ยวที่วางแผนไว้
     คนขับมีเที่ยวที่ยังไม่จบพร้อมกันได้หลายใบ แต่ "กำลังวิ่ง" มีความหมายชัดที่สุด */
  /* กติกาว่าเที่ยวไหนอยู่จอไหนอยู่ใน utils/jobs — ตอบได้จากรายการเที่ยวอย่างเดียว
     ไม่ต้องรู้จัก React จึงเขียนเทสต์ให้มันได้ ต่างจากตอนที่ฝังอยู่ในนี้ */
  const live = useMemo(() => liveJobs(jobs), [jobs])
  /* คิวรอส่ง (จอ 20) — รูปที่ถ่ายแล้วยังค้างในเครื่อง ยังไม่ขึ้นระบบ อ่านอย่างเดียว */
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncQueue, setSyncQueue] = useState<Array<{ orderNo: string; count: number }>>([])
  useEffect(() => {
    if (tab !== 'me' && !syncOpen) return
    let off = false
    void Promise.all(live.flatMap((j) => j.orders).map(async (o) => ({ orderNo: o.order_no, count: (await listShotBackups(o.id)).length })))
      .then((rows) => { if (!off) setSyncQueue(rows.filter((r) => r.count > 0)) })
    return () => { off = true }
  }, [tab, live, syncOpen])
  const done = useMemo(() => doneJobs(jobs), [jobs])
  /* ประวัติกรองตามวันปิดงาน — ค่าเริ่ม 7 วัน พอสำหรับคำถาม "สัปดาห์นี้วิ่งอะไรไปบ้าง" */
  const [histRange, setHistRange] = useState<HistoryRange>(() => presetRange('7d'))
  const [rangeOpen, setRangeOpen] = useState(false)
  const [gpsDenied, setGpsDenied] = useState<MyJob | null>(null)
  const [podBlocked, setPodBlocked] = useState(false)
  const [draftRange, setDraftRange] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const shown = useMemo(() => filterHistory(done, histRange), [done, histRange])
  const historyGroups = useMemo(() => groupHistory(shown), [shown])
  const shownStops = useMemo(
    () => shown.reduce((n, j) => n + groupStops(j.orders).filter((st) => !st.cancelled).length, 0),
    [shown],
  )
  const active = activeJob(live, activeId)
  /* คันที่ต้องถามเลขไมล์ — คนขับคนเดียวอาจถือหลายเที่ยวคนละคัน แต่คันที่ขับอยู่มีคันเดียว */
  const duty = useMemo(() => dutyVehicle(live), [live])
  /* ชั้นเลขไมล์ทั้งชุดอยู่ใน useOdometer — งานที่ถูกกล่องขวางไว้ถูกส่งกลับมาทาง
     onResume เพราะตัวที่เดินงานคือ act() ซึ่งอยู่ที่นี่ ไม่ใช่ที่ hook */
  const odometer = useOdometer({
    duty,
    live,
    onResume: (next) => void act(next.job, next.action, { odoDone: true }),
    onError: (m) => toast.push('error', m),
    onSaved: (km) => toast.push('success', `บันทึกเลขไมล์ออกรถ ${km.toLocaleString('th-TH')} กม. แล้ว`),
  })
  /* เด้งเข้าเที่ยวที่วิ่งค้างอยู่ครั้งเดียวตอนเปิดแอป — เงื่อนไขว่าเมื่อไหร่ควรเด้ง
     อยู่ใน autoOpenJob ที่นี่เหลือแค่การสั่งให้จอเปลี่ยน */
  useEffect(() => {
    const running = autoOpenJob(live, activeId)
    if (running) setActiveId(running.id)
  }, [live, activeId])

  /* วันของเครื่อง ไม่ใช่ของ UTC — ฐานตัดวันตามเวลาไทย จอต้องตัดตรงกัน
     ไม่งั้นระหว่าง 00:00–07:00 จอจะเชื่อว่าเป็นวันใหม่ก่อนฐานหนึ่งวัน */
  const today = (): string => new Date().toLocaleDateString('sv-SE')

  /* งานใหม่ที่ยังไม่ได้กดรับ — ตัวเลขบนแท็บมีไว้ตอบว่า "มีอะไรรอฉันอยู่ไหม" โดยไม่ต้องเปิดดู */
  const unread = live.filter((j) => !(j.my_accepted_at ?? j.accepted_at)).length
  /* เที่ยวอื่นที่ยังไม่จบ — รถกลับเข้าคลังครั้งเดียว ไม่ใช่ครั้งละเที่ยว
     นับงานที่ยังไม่ได้กดรับด้วย เพราะคนวางแผนจ่ายมาแล้ว มันคืองานของวันนี้ที่ยังไม่ได้วิ่ง
     ไม่ใช่ข้อเสนอที่ปฏิเสธได้ — กดจบงานทั้งที่ยังมีของบนรถคือรถถูกนับว่าว่างผิด
     ไม่นับเที่ยวที่ถึงขั้น "กำลังกลับคลัง" แล้ว เพราะนั่นคือขากลับเดียวกันของรถคันเดียวกัน */
  /* ทุกเที่ยวที่รออยู่บนขากลับคันเดียวกัน — ปุ่มจบงานปิดทั้งชุดนี้พร้อมกัน */
  const returningJobs = live.filter((j) => j.status === 'returning')
  /* ใบที่ปิดส่งไปแล้วแต่ยังไม่มีหลักฐาน — ฝั่งฐานกันไว้ตอนปิดงานที่ร้านสุดท้ายแล้ว
     แต่ระหว่างที่รถวิ่งกลับ ออฟฟิศถอนตรวจหรือลบรูปได้ และคนวางแผนเพิ่มใบเข้าเที่ยวได้
     เที่ยวที่ผ่านด่านนั้นมาแล้วจึงกลับมาขาดหลักฐานได้อีก ตรวจซ้ำตอนจบงาน */
  const podGaps = podGapsOf(returningJobs)
  /* ร้านที่ยังขาดหลักฐาน พร้อมเที่ยวของมัน — แผ่น "ยังปิดงานไม่ได้" ใช้เปิดฟอร์มเติมได้ทันที */
  const podGapStops = returningJobs.flatMap((j) =>
    groupStops(j.orders).filter((st) => st.done && st.needPod.length > 0).map((st) => ({ job: j, stop: st })))
  /* ร้านที่ส่งครบของทุกเที่ยวขากลับ — ให้คนขับตรวจด้วยตาก่อนกดจบงานจริง
     ไม่ใช่ด่านใหม่ ด่านจริงคือ podGaps ด้านบน ถึงตรงนี้ได้แปลว่าครบทุกร้านแล้ว */
  const podRows = podRowsOf(returningJobs)
  const unfinishedOthers = (job: MyJob): number =>
    live.filter((j) =>
      j.id !== job.id
      && j.status !== 'completed'
      && j.status !== 'cancelled'
      && j.status !== 'returning').length
  /* บันทึกตำแหน่งเฉพาะเที่ยวที่รับแล้วและยังไม่จบ — นอกช่วงนั้นไม่ใช่เรื่องของระบบนี้ */
  /* ตามตำแหน่งของเที่ยวที่กำลังวิ่ง ไม่ใช่การ์ดที่เผอิญกางอยู่ — คนขับหุบการ์ดแล้ว
     ตำแหน่งต้องไม่หยุดบันทึก งานยังวิ่งอยู่เหมือนเดิม */
  /* ขากลับคลังก็ยังต้องตามตำแหน่ง — เที่ยวยังไม่จบจนกว่ารถจะถึงคลัง
     ถ้าหยุดตรงร้านสุดท้าย เส้นทางกลับจะหายไปจากระบบทั้งท่อนเหมือนเดิม */
  const tracked = live.find(
    (j) => (j.status === 'in_progress' || j.status === 'returning') && (j.my_accepted_at ?? j.accepted_at),
  ) ?? null
  /* GPS เก็บเฉพาะจุดเช็กพอยต์ (JobFocus เรียก logCheckpoint) — ไม่ตามตำแหน่งแบบต่อเนื่องแล้ว */
  /* กันจอดับเองระหว่างวิ่ง — ตำแหน่งหยุดส่งทันทีที่จอดับ และช่องว่างที่เคยเห็น
     บนแผนที่คือจอดับเองเพราะคนขับไม่ได้แตะมือถือ ไม่ใช่เขาตั้งใจปิดแอป
     ในแอป native ไม่ต้องฝืนจอแล้ว พิกัดเดินต่อเองขณะจอดับ การกันจอดับตรงนั้น
     เหลือแค่ผลข้างเคียงคือแบตหมดเร็ว */
  useScreenWakeLock(tracked !== null)

  /* ขอสิทธิ์ตำแหน่งก่อนรับงาน ไม่ใช่หลังจากนั้น — งานที่รับแล้วแต่ตามไม่ได้
     ทำให้คนวางแผนตอบลูกค้าไม่ได้ทั้งวัน ปฏิเสธได้ แต่ต้องรู้ตัวว่ากำลังปฏิเสธอะไร */
  const askLocation = (): Promise<boolean> =>
    new Promise((resolve) => {
      if (!('geolocation' in navigator)) { resolve(false); return }
      navigator.geolocation.getCurrentPosition(() => resolve(true), () => resolve(false), { timeout: 10_000 })
    })

  /* odoDone: มาจากการกรอกเลขไมล์ที่เพิ่งเสร็จ ต้องข้ามด่านเลขไมล์ ไม่งั้นวนกลับ
     เข้ากล่องเดิม — ค่า odo ใน closure ของกล่องยังเป็นของก่อนบันทึกเสมอ */
  const act = async (
    job: MyJob,
    action: 'start' | 'complete' | 'accept' | 'finish',
    opts?: { odoDone?: boolean },
  ): Promise<void> => {
    if (action === 'finish') {
      const gate = finishGate(job.id, podGaps, finishing?.id ?? null)
      if (gate.kind === 'missing-pod') {
        /* บอกว่าร้านไหน ไม่ใช่แค่ว่าไม่ครบ — คนขับต้องรู้ว่าต้องกลับไปเก็บของใคร */
        /* แผ่น "ยังปิดงานไม่ได้" — บอกร้านพร้อมปุ่มไปเติม ไม่ใช่ toast ที่หายเองก่อนอ่านจบ */
        setFinishing(null)
        setPodBlocked(true)
        return
      }
      if (gate.kind === 'ask-details') {
        setFinishing(job)
        setTollHas(null)
        setTollAmount('')
        setFinishOdo('')
        setFinishPhoto(null)
        setFinishSuspect(null)
        setPodListOpen(false)
        return
      }
    }
    if (action === 'accept' && !(await askLocation())) {
      /* จอเต็มบอกวิธีเปิด ไม่ใช่ toast ที่หายไปใน 4 วินาที — คนขับต้องทำตามทีละขั้น */
      setGpsDenied(job)
      return
    }
    setBusy(job.id)
    let keepOpen = false
    try {
      /* ฟังก์ชันฝั่ง DB คืน void ไม่ใช่เที่ยวที่อัปเดตแล้ว — ต้องโหลดกลับมาเอง
         ตั้งใจให้เป็นแบบนั้น: สถานะจริงถูกคำนวณจากออเดอร์ในเที่ยว การให้ฟังก์ชัน
         "เดา" ผลลัพธ์กลับมาเองคือเปิดช่องให้หน้าจอกับฐานข้อมูลไม่ตรงกัน */
      /* รถกลับเข้าคลังครั้งเดียว การกดหนึ่งครั้งจึงต้องปิดทุกเที่ยวที่รออยู่บนขากลับ
         ไม่ใช่ให้คนขับกดปุ่มเดียวกันซ้ำทีละเที่ยว ซึ่งเป็นการถามคำถามเดิมซ้ำ ๆ
         ในเรื่องที่เกิดขึ้นครั้งเดียว */
      const closing = closingJobs(action, job, returningJobs)
      /* ตัวเลขเดียวต่อการกดหนึ่งครั้ง ผูกกับเที่ยวที่คนขับกดจบ ไม่ใช่หารใส่ทุกเที่ยว
         ทางด่วนที่วิ่งคือขากลับเส้นเดียว การหารเลขที่ไม่มีใครหารจริงคือการแต่งตัวเลข
         เที่ยวอื่นส่ง null ไป = ไม่แตะ toll_cost ที่ออฟฟิศอาจกรอกไว้แล้ว */
      /* ค่าทางด่วนลงเฉพาะเที่ยวที่กดจบ — tollFor ตัดสินให้ทีละเที่ยวตอนยิงจริงข้างล่าง */
      /* เลขไมล์ไปก่อนจบงาน ไม่ใช่หลัง — ฐานปฏิเสธเลขที่ถอยหลัง ถ้าปิดเที่ยวไปแล้ว
         ค่อยรู้ว่าเลขผิด เที่ยวจะปิดไปโดยไม่มีเลขไมล์ และแก้ทีหลังจากจอคนขับไม่ได้แล้ว */
      if (action === 'finish') {
        const km = parseKm(finishOdo)
        if (km !== null) await logOdometer(job.vehicle_id, km, 'end', finishSuspect !== null)
        /* รูปหน้าปัดไม่บังคับ — อัปไม่ผ่านไม่ขวางการจบงาน แจ้งเตือนแล้วไปต่อ */
        let photoPath: string | null = null
        if (finishPhoto) {
          try {
            photoPath = await uploadTripPhoto(job.id, 'odometer', finishPhoto)
          } catch (err) {
            toast.push('warning', `อัปรูปหน้าปัดไม่สำเร็จ: ${(err as Error).message}`)
          }
        }
        /* จุดเดียวที่บันทึก trip_end — มีหรือไม่มีรูปก็บันทึกพิกัดตอนจบเที่ยว */
        void logCheckpoint(String(job.id), 'trip_end', { odometer_km: km, odometer_photo_path: photoPath })
      }
      await (action === 'accept' ? acceptTrip(job.id)
        : action === 'start' ? startTrip(job.id)
        /* ทีละเที่ยวตามลำดับ ไม่ใช่ยิงพร้อมกัน — ฝั่งฐานคิดสถานะรถจากเที่ยวที่ค้างอยู่
           การยิงขนานกันทำให้สองคำสั่งอ่านสถานะเดียวกันก่อนอีกตัวเขียนเสร็จ */
        : action === 'finish'
          ? (async () => {
              for (const j of closing) await finishReturn(j.id, tollFor(j.id, job.id, tollHas, tollAmount))
            })()
        : completeTrip(job.id))
      if (action === 'finish') {
        const ids = new Set(closing.map((j) => j.id))
        const fresh = await listMyJobs()
        setJobs(fresh)
        /* เที่ยวที่เพิ่งปิดไม่มีอะไรให้กางอีกแล้ว ปล่อยให้จอเลือกงานถัดไปเอง */
        if (activeId !== null && activeId !== -1 && ids.has(activeId)) setActiveId(-1)
      } else {
        const updated = await reloadJob(job.id)
        setJobs((list) => (updated ? list.map((j) => (j.id === job.id ? updated : j)) : list.filter((j) => j.id !== job.id)))
      }
      /* รับแล้วกางทันที — การกดรับงานคือการบอกว่า "งานนี้แหละที่ฉันกำลังจะทำ"
         ให้ต้องกดอีกครั้งเพื่อดูจุดส่ง คือการกดที่ไม่ตอบอะไรเลย */
      if (action === 'accept') setActiveId(job.id)
      toast.push('success',
        action === 'accept' ? `รับงาน ${jobTripNo(job)} แล้ว`
          : action === 'start' ? `เริ่มเดินทาง ${jobTripNo(job)}`
          : action === 'finish'
            ? (closing.length > 1 ? `จบงานแล้ว ${closing.length} เที่ยว` : `จบงาน ${jobTripNo(job)} เรียบร้อย`)
            : `ปิดงาน ${jobTripNo(job)} เรียบร้อย`)
    } catch (e) {
      /* เลขผิดปกติไม่ใช่ความล้มเหลว — ค้างกล่องไว้ให้แก้เลขหรือกดยืนยัน */
      if (action === 'finish' && (e as { code?: string }).code === ODOMETER_SUSPECT) {
        setFinishSuspect((e as Error).message)
        keepOpen = true
      } else {
        toast.push('error', (e as Error).message)
      }
    } finally {
      setBusy(0)
      if (!keepOpen) setFinishing(null)
    }
  }

  const submitIssue = async (text: string = issueNote, photo?: File): Promise<void> => {
    if (!issueFor) return
    if (!text.trim()) { toast.push('warning', 'ระบุปัญหาที่พบ'); return }
    setSendingIssue(true)
    try {
      /* รูปขึ้นก่อน — ล้มแล้วค้างแผ่นไว้ (issueFor ยังอยู่) ข้อความกับรูปที่เลือกไม่หาย */
      let photoPath: string | null = null
      if (photo) {
        try {
          photoPath = await uploadTripPhoto(issueFor.id, 'issue', photo)
        } catch (e) {
          toast.push('error', `อัปรูปไม่สำเร็จ: ${(e as Error).message}`)
          return
        }
      }
      await reportIssue(issueFor.id, text.trim())
      if (photoPath) await logCheckpoint(String(issueFor.id), 'issue', { note: text.trim(), photo_path: photoPath })
      const updated = await reloadJob(issueFor.id)
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
      const updated = tripId ? await reloadJob(tripId) : null
      if (updated) setJobs((list) => list.map((j) => (j.id === updated.id ? updated : j)))
      toast.push('success', `ส่ง ${stop.customer_name ?? stop.destination} เรียบร้อย`)
      if (can('myjobs.pod')) {
        const ids = new Set(stop.orders.map((o) => o.id))
        setPodStop(stop)
        setPodFor(updated ? updated.orders.filter((o) => ids.has(o.id)) : stop.orders)
      }
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setDelivering('')
    }
  }

  /* ถอนการปิดส่งทั้งร้าน — ปิดทีเดียวทั้งร้าน ก็ต้องถอยทีเดียวทั้งร้าน
     ถอยทีละใบจะเหลือร้านที่ส่งไปครึ่งเดียวโดยไม่มีใครตั้งใจให้เป็นแบบนั้น */
  /* ยกเลิกทั้งร้าน — ทุกใบที่ยังไม่ส่งของร้านนั้นไปพร้อมกัน
     ใบที่เก็บหลักฐานไปแล้วไม่ถูกแตะ ฝั่งฐานปฏิเสธทั้งชุดถ้าเจอ POD อยู่แล้ว */
  const doCancelStop = async (stop: StopGroup, reason: string): Promise<void> => {
    setDelivering(stop.key)
    try {
      /* ตัดใบที่ยกเลิกไปแล้วออกด้วย — ไม่ใช่แค่ delivered ร้านที่มีหลายใบและ
         ยกเลิกไปแล้วบางใบ ไม่ควรส่งใบเดิมกลับเข้า cancel_stop ซ้ำ */
      const ids = stop.orders
        .filter((o) => o.status !== 'delivered' && o.status !== 'cancelled' && !o.has_pod)
        .map((o) => o.id)
      if (ids.length === 0) throw new Error('ร้านนี้ไม่มีใบที่ยกเลิกได้แล้ว')
      await cancelStop(ids, reason)
      const tripId = stop.orders[0]?.trip_id
      const updated = tripId ? await reloadJob(tripId) : null
      if (updated) setJobs((list) => list.map((j) => (j.id === updated.id ? updated : j)))
      toast.push('success', `ยกเลิก ${stop.customer_name ?? stop.destination} แล้ว — แจ้งออฟฟิศให้ทราบแล้ว`)
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setDelivering('')
      setCancelling(null)
      setCancelReason('')
      setCancelNote('')
    }
  }

  const doUndoCancelStop = async (stop: StopGroup): Promise<void> => {
    setDelivering(stop.key)
    try {
      await undoCancelStop(stop.orders.filter((o) => o.status === 'cancelled').map((o) => o.id))
      const tripId = stop.orders[0]?.trip_id
      const updated = tripId ? await reloadJob(tripId) : null
      if (updated) setJobs((list) => list.map((j) => (j.id === updated.id ? updated : j)))
      toast.push('success', `ถอนการยกเลิก ${stop.customer_name ?? stop.destination} แล้ว`)
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setDelivering('')
      setUndoCancelling(null)
    }
  }

  const undoDeliver = async (stop: StopGroup): Promise<void> => {
    setDelivering(stop.key)
    try {
      /* สถานะที่ติดมากับ stop อาจเป็นของก่อนกดปิดส่ง (ฟอร์ม POD เด้งขึ้นก่อนที่
         หน้าจะโหลดใหม่เสร็จ) — อ่านสถานะล่าสุดจาก jobs เสมอ ไม่งั้นจะไม่ถอนอะไรเลย
         แล้วขึ้นว่าสำเร็จ ซึ่งแย่กว่าขึ้น error */
      const ids = new Set(stop.orders.map((o) => o.id))
      const latest = jobs.find((j) => j.id === stop.orders[0]?.trip_id)?.orders.filter((o) => ids.has(o.id))
      for (const order of (latest ?? stop.orders).filter((o) => o.status === 'delivered')) {
        await undoDeliverOrder(order.id)
      }
      const tripId = stop.orders[0]?.trip_id
      const updated = tripId ? await reloadJob(tripId) : null
      if (updated) setJobs((list) => list.map((j) => (j.id === updated.id ? updated : j)))
      toast.push('success', `ยกเลิกการส่ง ${stop.customer_name ?? stop.destination} แล้ว`)
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setDelivering('')
      setUndoing(null)
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
      const updated = await reloadJob(job.id)
      if (updated) setJobs((list) => list.map((j) => (j.id === updated.id ? updated : j)))
      toast.push('error', (e as Error).message)
    }
  }

  if (error) return <ErrorBox message={error} onRetry={() => load()} />

  return (
    <div className="driver-scope dv-app">
      {/* โครงแอป (mockup v2): หัวจอตรึงบน · เนื้อหาเลื่อนขึ้นลงอย่างเดียว · เมนูล่างตรึง
          หน้าเที่ยวที่เปิดอยู่ หัวจอเป็นของ JobFocus (ตรึงในกล่องเนื้อหา) */}
      {!(tab === 'jobs' && active) && (
        <header className="dv-head">
          {tab === 'history' && historyJob ? (
            <>
              <button type="button" className="dv-icon-btn" aria-label="กลับไปประวัติ" onClick={() => setHistoryJob(null)}>
                <IconChevronLeft size={22} />
              </button>
              <h1 className="dv-title" style={{ flex: 1 }}>
                {historyJob.arrived_at ? shortThai(historyJob.arrived_at.slice(0, 10)) : jobTripNo(historyJob)}
                <span className="dv-sub">{jobTripNo(historyJob)} · {historyJob.vehicle_plate}</span>
              </h1>
            </>
          ) : (<>
          <h1 className="dv-title">
            {tab === 'jobs' ? 'งานวันนี้' : tab === 'history' ? 'ประวัติ' : 'ฉัน'}
            {tab !== 'me' && (
              <span className="dv-sub">{tab === 'jobs' ? fmtLongToday() : 'เที่ยวที่ปิดแล้ว'}</span>
            )}
          </h1>
          {tab === 'history' && (
            <button type="button" className="dv-icon-btn" aria-label="เลือกช่วงวันที่" onClick={() => {
              setDraftRange({ from: histRange.from ?? '', to: histRange.to ?? '' })
              setRangeOpen(true)
            }}>
              <IconCalendar size={22} />
            </button>
          )}
          </>)}
        </header>
      )}

      <main className="dv-body">
      {/* แถบสถานะของท่าลากลง ไหลตามนิ้วแล้วค้างไว้ระหว่างโหลด */}
      <div
        className={`pull-hint${pull.refreshing ? ' is-loading' : ''}${pull.ready ? ' is-ready' : ''}`}
        style={{ height: pull.distance }}
        aria-hidden={pull.distance === 0}
      >
        {pull.distance > 0 && (
          <span>{pull.refreshing ? 'กำลังโหลด…' : pull.ready ? 'ปล่อยเพื่อโหลดใหม่' : 'ลากลงเพื่อโหลดใหม่'}</span>
        )}
      </div>

      {tab === 'history' && historyJob && (
        /* รายละเอียดย้อนหลังเป็นหน้าเต็ม (mockup v2) — การ์ดละร้าน รูปหลักฐานอยู่ในการ์ดเลย กดรูปเปิดเต็มจอ */
        <div className="hist-list">
          <div className="dv-card">
            <dl className="hd-kv">
              <dt>ปิดงาน</dt><dd>{historyJob.arrived_at ? fmtDateTime(historyJob.arrived_at) : '—'}</dd>
              <dt>จุดส่ง</dt><dd>{groupStops(historyJob.orders).filter((st) => !st.cancelled).length} จุด · {historyJob.orders.length} ใบ</dd>
              {historyJob.issue_note && (<><dt>แจ้งปัญหา</dt><dd>{historyJob.issue_note}</dd></>)}
            </dl>
          </div>
          {groupStops(historyJob.orders).map((stop, i) => (
            <div key={stop.key} className="dv-card hd-stop">
              <div className="hd-stop-head">
                <span className="hd-num" aria-hidden>{i + 1}</span>
                <span className="hd-name">
                  <b>{stop.customer_name ?? stop.destination}</b>
                  {stop.customer_address && <small>{stop.customer_address}</small>}
                </span>
                {stop.cancelled
                  ? <span className="hist-pill is-bad">ส่งไม่ได้</span>
                  : <span className="hist-pill is-ok">ส่งแล้ว</span>}
              </div>
              {/* ร้านเดียวอาจมีหลายใบ แต่ละใบมีหลักฐานแยกกัน */}
              {stop.orders.filter((o) => o.has_pod > 0).map((o) => (
                <div key={o.id} className="hd-bill">
                  {stop.orders.length > 1 && <p className="dv-label">{o.tms_picking_list_no ?? o.order_no}</p>}
                  <HistoryStopPod orderId={o.id} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'history' && !historyJob && (
        /* ประวัติเป็นรายการอ่านอย่างเดียว — ปิดงานแล้วไม่มีปุ่มอะไรให้กดอีก
           สิ่งที่คนขับมาหาที่นี่คือ "เมื่อวานฉันวิ่งกี่เที่ยว ร้านไหนบ้าง" */
        <div className="hist-list">
          {/* ตัวกรองวันที่แบบมือถือ — ปุ่มลัดแถวเดียว ส่วน "เลือกเอง" เปิดแผ่นล่างที่ใช้ปฏิทินของเครื่อง */}
          <div className="hist-filter" role="group" aria-label="ช่วงวันที่">
            {([['today', 'วันนี้'], ['7d', '7 วัน'], ['30d', '30 วัน'], ['all', 'ทั้งหมด']] as const).map(([k, label]) => (
              <button key={k} type="button" className="hist-chip" aria-pressed={histRange.preset === k}
                onClick={() => setHistRange(presetRange(k))}>
                {label}
              </button>
            ))}
            <button type="button" className="hist-chip" aria-pressed={histRange.preset === 'custom'}
              onClick={() => {
                setDraftRange({ from: histRange.from ?? '', to: histRange.to ?? '' })
                setRangeOpen(true)
              }}>
              {histRange.preset === 'custom' && histRange.from && histRange.to
                ? 'กำหนดเอง ✓' : 'กำหนดเอง'}
            </button>
          </div>
          {done.length > 0 && (
            <p className="hist-sum">
              <span>{histRange.from && histRange.to
                ? (histRange.from === histRange.to ? shortThai(histRange.from) : `${shortThai(histRange.from)} – ${shortThai(histRange.to)}`)
                : 'ทุกวัน'}</span>
              <span>{shown.length} เที่ยว · {shownStops} จุด</span>
            </p>
          )}
          {shown.length > 0 && (() => {
            /* สรุปช่วงที่เลือก (mockup จอ 13) — ส่งครบ = เที่ยวที่ไม่มีใบส่งไม่ได้ */
            const full = shown.filter((j) => j.status !== 'cancelled' && !j.orders.some((o) => o.status === 'cancelled')).length
            return (
              <div className="dv-stats">
                <div><b>{shown.length}</b><small>เที่ยว</small></div>
                <div><b>{shownStops}</b><small>จุดส่ง</small></div>
                <div><b className="is-ok">{Math.round((full / shown.length) * 100)}%</b><small>ส่งครบ</small></div>
              </div>
            )
          })()}
          {done.length === 0 && (
            <EmptyState icon={<IconTruck size={28} />} title="ยังไม่มีงานที่ปิดแล้ว" desc="งานที่ปิดงานเรียบร้อยจะมาอยู่ที่นี่" />
          )}
          {done.length > 0 && shown.length === 0 && (
            <EmptyState icon={<IconTruck size={28} />} title="ไม่มีเที่ยวในช่วงนี้" desc="ลองเลือกช่วงวันที่กว้างขึ้น" />
          )}
          {historyGroups.map((group) => (
            <section key={group.key} className="hist-group" aria-label={group.label}>
              <ul className="hist-rows">
                {group.jobs.map((j) => (
                  <li key={j.id}>
                    <button type="button" className="hist-row" onClick={() => setHistoryJob(j)}>
                      <span className="hist-day" aria-hidden>
                        <b>{j.arrived_at ? new Date(j.arrived_at).getDate() : '—'}</b>
                        <small>{j.arrived_at ? new Date(j.arrived_at).toLocaleDateString('th-TH', { month: 'short' }) : ''}</small>
                      </span>
                      <span className="hist-text">
                        <span className="hist-no">{jobTripNo(j)}{j.issue_note ? ' · แจ้งปัญหา' : ''}</span>
                        <span className="hist-meta">
                          {/* ร้านที่ยกเลิกทั้งร้านไม่นับเป็นจุดส่ง — รถไม่ได้วิ่งไปถึงจริง */}
                          {j.vehicle_plate} · {groupStops(j.orders).filter((s) => !s.cancelled).length} จุดส่ง · {j.orders.length} ใบ
                          {j.arrived_at ? ` · ปิดงาน ${fmtTime(j.arrived_at)}` : ''}
                        </span>
                      </span>
                      {/* ป้ายผลของเที่ยว (mockup) — ส่งครบ = เขียว, มีร้านส่งไม่ได้ = แดง, เที่ยวถูกยกเลิก = เทา */}
                      {(() => {
                        const failed = groupStops(j.orders).filter((st) => st.cancelled).length
                        if (j.status === 'cancelled') return <span className="hist-pill is-off">ยกเลิกเที่ยว</span>
                        return failed > 0
                          ? <span className="hist-pill is-bad">ส่งไม่ได้ {failed}</span>
                          : <span className="hist-pill is-ok">ส่งครบ</span>
                      })()}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {tab === 'me' && (
        /* หน้าฉัน (mockup จอ 15) — หัวโปรไฟล์ แล้วกลุ่มรายการตั้งค่า */
        <div className="driver-me dv-page">
          <div className="me-head">
            <span className="me-avatar" aria-hidden>{(user?.name ?? '?').trim().slice(0, 2)}</span>
            <span className="me-who">
              <b>{user?.name}</b>
              <small>คนขับ · {user?.username}</small>
            </span>
          </div>
          {(() => {
            /* รถประจำ + เดือนนี้ (mockup จอ 15) — ใช้ข้อมูลที่มีในเครื่อง ไม่มีก็ซ่อน */
            const ym = new Date().toISOString().slice(0, 7)
            const month = done.filter((j) => (j.arrived_at ?? j.departed_at ?? '').slice(0, 7) === ym && j.status !== 'cancelled')
            if (!duty && month.length === 0) return null
            const full = month.filter((j) => !j.orders.some((o) => o.status === 'cancelled')).length
            return (
              <div className="me-tiles">
                {duty && <div><small>รถประจำ</small><b>{duty.plate}</b></div>}
                {month.length > 0 && (
                  <div><small>เดือนนี้</small><b>{month.length} เที่ยว</b><small className="is-ok">ส่งครบ {Math.round((full / month.length) * 100)}%</small></div>
                )}
              </div>
            )
          })()}
          <div className="grp">
            <div className="it">
              <span className="it-l">ธีมหน้าจอ</span>
              <div className="seg3" role="group" aria-label="ธีมหน้าจอ">
                {(['light', 'dark', 'auto'] as const).map((t) => (
                  <button key={t} type="button" aria-pressed={theme === t} className={theme === t ? 'on' : undefined}
                    onClick={() => { setTheme(t); applyThemePref(t) }}>
                    {t === 'dark' ? 'มืด' : t === 'light' ? 'สว่าง' : 'อัตโนมัติ'}
                  </button>
                ))}
              </div>
            </div>
            <div className="it">
              <span className="it-l">ตำแหน่ง GPS</span>
              <span className="it-v">ใช้เฉพาะตอนถึงจุดส่ง</span>
            </div>
            <button type="button" className="it" onClick={() => setSyncOpen(true)}>
              <span className="it-l">ข้อมูลรอส่ง</span>
              <span className={`it-v${syncQueue.length ? ' is-wait' : ''}`}>{syncQueue.length ? `${syncQueue.length} รายการ` : 'ไม่มี'}</span>
              <IconChevronRight size={16} aria-hidden />
            </button>
          </div>
          <div className="grp">
            <button type="button" className="it" onClick={() => setPwOpen(true)}>
              <span className="it-l">เปลี่ยนรหัสผ่าน</span>
              <IconChevronRight size={16} aria-hidden />
            </button>
            <button type="button" className="it is-bad" onClick={() => void logout()}>
              <span className="it-l">ออกจากระบบ</span>
            </button>
          </div>
          <p className="me-foot">{fmtLongToday()}</p>
        </div>
      )}

      {syncOpen && (
        /* ข้อมูลรอส่ง (mockup จอ 20) — ชีตล่าง อ่านอย่างเดียว */
        <div className="sheet-veil" onClick={() => setSyncOpen(false)}>
          <section className="sheet" role="dialog" aria-label="ข้อมูลรอส่ง" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" aria-hidden />
            <h2 className="sheet-head">ข้อมูลรอส่ง</h2>
            <div className="sheet-body">
              {syncQueue.length > 0 && (
                <p role="status" className="sync-warn">ข้อมูลเก็บไว้ในเครื่องแล้ว จะส่งเองเมื่อมีสัญญาณ อย่าออกจากระบบหรือล้างแอป</p>
              )}
              {syncQueue.length === 0 ? (
                <p className="sync-row"><b>ส่งครบแล้ว ไม่มีรายการค้าง</b><span className="chip c-ok">ส่งแล้ว</span></p>
              ) : (
                <ul className="sync-list">
                  {syncQueue.map((q) => (
                    <li key={q.orderNo} className="sync-row">
                      <b>{q.orderNo}<small>รูปค้างในเครื่อง {q.count} รูป</small></b>
                      <span className="chip c-wait">รอส่ง</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="sheet-foot">
              <button type="button" className="btn ghost block" onClick={() => setSyncOpen(false)}>ปิด</button>
            </div>
          </section>
        </div>
      )}

      {tab === 'jobs' && (loading ? (
        <Skeleton height={320} />
      ) : live.length === 0 ? (
        /* ไม่มีงาน (mockup จอ 24) */
        <div className="dv-empty">
          <span className="dv-empty-ic" aria-hidden><IconTruck size={40} /></span>
          <h2>ยังไม่มีงานวันนี้</h2>
          <p>เมื่อฝ่ายวางแผนมอบเที่ยวให้ งานจะขึ้นที่นี่ทันที<br />ดึงหน้าจอลงเพื่อโหลดใหม่</p>
        </div>
      ) : active ? (
        /* เปิดเที่ยวอยู่ — เห็นเที่ยวนั้นเที่ยวเดียว ทางกลับไปรายการเที่ยวมีทางเดียวคือชิปข้างบน
           การ์ดเที่ยวอื่นไม่อยู่บนจอ นิ้วพลาดระหว่างปิดจุดจึงไม่สลับเที่ยวโดยไม่มีใครสั่ง */
        <div className="dv-page">
          <JobFocus
            job={active}
            onBack={() => setActiveId(-1)}
            backLabel={`เที่ยวทั้งหมด${live.length > 1 ? ` (${live.length})` : ''}`}
            busy={busy === active.id}
            deliveringKey={delivering}
            canProgress={can('myjobs.progress')}
            canPod={can('myjobs.pod')}
            unfinishedOthers={unfinishedOthers(active)}
            returningCount={returningJobs.length}
            podMissing={podGaps.length}
            onAct={(j, action) => void act(j, action)}
            onReportIssue={(j) => { setIssueFor(j); setIssueNote('') }}
            onPod={(stop) => {
              setPodStop(stop)
              setPodFor(stop.needPod.length > 0 ? stop.needPod : stop.orders)
            }}
            onViewPod={setPodView}
            onDeliver={(stop) => void deliver(stop)}
            onUndoDeliver={(stop) => setUndoing(stop)}
            onCancelStop={(stop) => { setCancelling(stop); setCancelReason(''); setCancelNote('') }}
            onUndoCancelStop={(stop) => setUndoCancelling(stop)}
            onReorder={(j, ids) => void reorder(j, ids)}
          />
        </div>
      ) : (
        /* รายการเที่ยวที่ยังไม่จบ (mockup จอ 1 + 6) — งานใหม่เป็นการ์ดเต็มพร้อมปุ่มรับงาน
           เที่ยวที่รับแล้วเป็นการ์ดย่อ แตะเพื่อเปิด */
        <div className="dv-page jobs-list">
          {unread > 0 && (
            <p className="dv-banner"><span className="dv-chip is-info">งานใหม่ {unread}</span> ฝ่ายวางแผนมอบเที่ยวให้คุณ กดรับงานก่อนออกเดินทาง</p>
          )}
          {live.some((j) => !(j.my_accepted_at ?? j.accepted_at)) && <p className="dv-label jl-new">งานใหม่ รอรับ</p>}
          {live.some((j) => j.my_accepted_at ?? j.accepted_at) && <p className="dv-label jl-next">ถัดไปวันนี้</p>}
          {live.map((job) => {
            const delivered = job.orders.filter((o) => o.status === 'delivered').length
            const mine = job.my_accepted_at ?? job.accepted_at
            const jobStops = groupStops(job.orders)
            const firstStop = jobStops[0]
            const crew = job.driver_count ?? 1
            if (!mine) {
              /* งานใหม่ — ไม่มีปุ่มปฏิเสธ (TMS จ่ายคนมาแล้ว) มีปัญหาให้กดแจ้ง */
              return (
                /* งานใหม่หุบไว้ก่อน — แถวเดียวบอกเลขเที่ยว รถ กี่ร้าน นัดแรก พร้อมปุ่มรับงาน
                   แตะ "ดูรายละเอียด" ถึงกางรายชื่อร้าน คลัง คนไปด้วย */
                <section key={job.id} className="card jc is-new">
                  <div className="jc-row">
                    <span className="chip c-wait">รอรับงาน</span>
                    {firstStop && <span className="jc-time">นัดแรก {fmtTime(firstStop.scheduled_at)}</span>}
                  </div>
                  <div>
                    <div className="jc-no">{jobTripNo(job)}</div>
                    <div className="jc-route">
                      {job.warehouse_code ? `คลัง ${job.warehouse_code} → ` : ''}
                      {jobStops.slice(0, 2).map((st) => st.customer_name ?? st.destination).join(', ')}
                      {jobStops.length > 2 ? ' …' : ''}
                    </div>
                  </div>
                  <div className="jc-meta">
                    <span>{jobStops.length} จุด</span>
                    <span>{job.vehicle_plate}</span>
                    {crew > 1 && <span>ไปด้วยกัน {crew} คน · รับแล้ว {job.accepted_count}/{crew}</span>}
                  </div>
                  {previewId === job.id && (
                    <div className="jc-detail">
                      <ol className="dv-newjob-stops" aria-label={`จุดส่งของ ${jobTripNo(job)}`}>
                        {jobStops.map((st, k) => (
                          <li key={st.key}><span>{k + 1}</span>{st.customer_name ?? st.destination}</li>
                        ))}
                      </ol>
                      <button type="button" className="dv-link" onClick={() => { setIssueFor(job); setIssueNote('') }}>
                        แจ้งปัญหา
                      </button>
                    </div>
                  )}
                  <button type="button" className="btn ghost sm" aria-expanded={previewId === job.id}
                    onClick={() => setPreviewId(previewId === job.id ? null : job.id)}>
                    {previewId === job.id ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}
                  </button>
                  <button type="button" className="btn pri block" disabled={busy === job.id} aria-busy={busy === job.id}
                    onClick={() => void act(job, 'accept')}>
                    {busy === job.id ? 'กำลังรับงาน…' : 'รับงานนี้'}
                  </button>
                </section>
              )
            }
            return (
              <button key={job.id} type="button" className="card jc" onClick={() => setActiveId(job.id)}>
                <span className="jc-row">
                  <span className={`chip ${job.status === 'in_progress' || job.status === 'returning' ? 'c-run' : 'c-mute'}`}>
                    {TRIP_STATUS_LABEL[job.status]}
                  </span>
                  {firstStop && <span className="jc-time">{fmtTime(firstStop.scheduled_at)}</span>}
                </span>
                <span className="jc-no sm">{jobTripNo(job)}</span>
                <span className="jc-meta">
                  <span>{jobStops.length} จุด</span>
                  <span>ส่งแล้ว {delivered}/{job.orders.length}</span>
                  {(() => {
                    const next = jobStops.find((st) => !st.done && !st.cancelled)
                    return next ? <span>ถัดไป {next.customer_name ?? next.destination}</span> : null
                  })()}
                </span>
              </button>
            )
          })}
        </div>
      ))}

      </main>

      {/* แถบล่างจอ — โครงเดียวกับแอปที่คนใช้ทุกวัน ถึงด้วยนิ้วโป้งข้างเดียว
          ไม่ใช่เมนูที่ต้องกดเปิดจากมุมบนซ้ายก่อนถึงจะเห็นว่ามีอะไรบ้าง */}
      <nav className="dv-nav" aria-label="เมนูหลัก"
        style={{ '--nav-i': tab === 'jobs' ? 0 : tab === 'history' ? 1 : 2 } as React.CSSProperties}>
        {/* แถบสีเลื่อนไปอยู่เหนือเมนูที่เลือก — บอกว่าตอนนี้อยู่หน้าไหน */}
        <span className="dv-nav-ind" aria-hidden />
        <button type="button" className={`dv-nav-btn${tab === 'jobs' ? ' is-active' : ''}`}
          aria-current={tab === 'jobs' ? 'page' : undefined}
          /* แตะ "งาน" ตอนอยู่ในเที่ยว = กลับไปรายการเที่ยว เหมือนแท็บของแอปทั่วไป */
          onClick={() => { if (tab === 'jobs') setActiveId(-1); setTab('jobs') }}>
          <span className="dv-nav-pill" aria-hidden><IconTruck size={22} /></span>
          <span>งาน</span>
          {unread > 0 && <span className="dv-nav-badge" aria-label={`งานใหม่ ${unread}`}>{unread}</span>}
        </button>
        <button type="button" className={`dv-nav-btn${tab === 'history' ? ' is-active' : ''}`}
          aria-current={tab === 'history' ? 'page' : undefined} onClick={() => { setTab('history'); setHistoryJob(null) }}>
          <span className="dv-nav-pill" aria-hidden><IconClock size={22} /></span>
          <span>ประวัติ</span>
        </button>
        <button type="button" className={`dv-nav-btn${tab === 'me' ? ' is-active' : ''}`}
          aria-current={tab === 'me' ? 'page' : undefined} onClick={() => setTab('me')}>
          <span className="dv-nav-pill" aria-hidden><IconUsers size={22} /></span>
          <span>ฉัน</span>
        </button>
      </nav>

      <ChangePasswordModal page open={pwOpen} onClose={() => setPwOpen(false)} onDone={() => setPwOpen(false)} />

      {podView && (
        <PodViewModal
          orderId={podView.id}
          billNo={podView.tms_picking_list_no ?? podView.order_no}
          onClose={() => setPodView(null)}
        />
      )}

      {gpsDenied && (
        <Modal
          open
          onClose={() => setGpsDenied(null)}
          size="sheet"
          title="ต้องเปิดตำแหน่งก่อนรับงาน"
          footer={
            <div className="pod-actions">
              <Button variant="ghost" onClick={() => setGpsDenied(null)}>กลับ</Button>
              <Button onClick={() => {
                const job = gpsDenied
                setGpsDenied(null)
                void act(job, 'accept')
              }}>
                ลองอีกครั้ง
              </Button>
            </div>
          }
        >
          <div className="gps-denied">
            <span className="gps-denied-ic" aria-hidden><IconAlert size={36} /></span>
            <p>บริษัทใช้ตำแหน่งดูว่ารถอยู่ไหนระหว่างส่งของ บันทึกเฉพาะตอนมีเที่ยวที่กำลังวิ่งเท่านั้น</p>
            <ol>
              <li>แตะไอคอนแม่กุญแจ (หรือ ⓘ) ข้างช่องที่อยู่เว็บ</li>
              <li>เลือก ตำแหน่ง → อนุญาต</li>
              <li>กลับมากด "ลองอีกครั้ง"</li>
            </ol>
          </div>
        </Modal>
      )}


      {podBlocked && (
        <Modal
          open
          onClose={() => setPodBlocked(false)}
          size="sheet"
          title="ยังปิดงานไม่ได้"
          footer={<Button variant="ghost" onClick={() => setPodBlocked(false)}>ปิด</Button>}
        >
          <p className="job-sub" style={{ marginBottom: 12 }}>
            มี {podGapStops.length} ร้านที่หลักฐานยังไม่ครบ — เติมให้ครบแล้วกด "ถึงคลังแล้ว" อีกครั้ง
          </p>
          <ul className="gap-list">
            {podGapStops.map(({ job, stop }) => (
              <li key={`${job.id}-${stop.key}`}>
                <button type="button" className="gap-row" onClick={() => {
                  setPodBlocked(false)
                  setActiveId(job.id)
                  setPodStop(stop)
                  setPodFor(stop.needPod)
                }}>
                  <span>
                    <b>{stop.customer_name ?? stop.destination}</b>
                    <small>{jobTripNo(job)} · ขาดหลักฐาน {stop.needPod.length} ใบ</small>
                  </span>
                  <span className="gap-row-go">เติม ›</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {rangeOpen && (
        <Modal
          open
          onClose={() => setRangeOpen(false)}
          size="sheet"
          title="เลือกช่วงวันที่"
          footer={
            <div className="pod-foot">
              <Button
                size="lg"
                className="dv-cta"
                disabled={!draftRange.from}
                onClick={() => {
                  const to = draftRange.to || draftRange.from
                  setHistRange({ preset: 'custom', from: draftRange.from, to })
                  setRangeOpen(false)
                }}
              >
                {(() => {
                  if (!draftRange.from) return 'แตะวันเริ่มต้น'
                  const to = draftRange.to || draftRange.from
                  const n = filterHistory(done, { preset: 'custom', from: draftRange.from, to }).length
                  const days = Math.round((Date.parse(to) - Date.parse(draftRange.from)) / 86_400_000) + 1
                  return `ดู ${days} วัน · ${n} เที่ยว`
                })()}
              </Button>
            </div>
          }
        >
          <div className="dv-cal-top">
            <button type="button" className="dv-link" onClick={() => setDraftRange({ from: '', to: '' })}>ล้าง</button>
          </div>
          <RangeCalendar from={draftRange.from} to={draftRange.to}
            onChange={(from, to) => setDraftRange({ from, to })} />
        </Modal>
      )}


      {/* ถามชื่อร้านกลับไปให้เห็นเต็ม ๆ — คนที่กดผิดร้านหนึ่งครั้งแล้ว กำลังจะ
          กดถอยจากรายการเดียวกันนั้น ต้องอ่านชื่อก่อนว่าถอยถูกใบ */}
      {/* จบงานคือขั้นสุดท้ายของวัน กดพลาดแล้วรถถูกนับว่าว่างทั้งที่ยังอยู่บนถนน
          และเที่ยวหลุดจากจอไปอยู่ในประวัติ ถามหนึ่งครั้งก่อนพอ */}
      {/* จบงาน + ค่าทางด่วน อยู่ในกล่องเดียวกัน ไม่ใช่ถามต่อกันสองกล่อง
          ถามหลังจบงานสำเร็จ = คนขับปิดแอปเดินลงจากรถได้ก่อนตอบ แล้วเงินที่สำรอง
          จ่ายไปไม่มีใครรู้ ถามก่อน = ตัวเลขถูกส่งไปพร้อมคำสั่งเดียวกัน */}
      {finishing && (() => {
        /* ถึงคลัง ปิดงาน (mockup CloseTrip) — ตรรกะเดิม แค่จัดหน้าใหม่ */
        const closeOrders = returningJobs.length > 1 ? returningJobs.flatMap((j) => j.orders) : finishing.orders
        const okN = closeOrders.filter((o) => o.status === 'delivered').length
        const badN = closeOrders.filter((o) => o.status === 'cancelled').length
        const startKm = odometer.vehicle?.id === finishing.vehicle_id ? odometer.status?.start_km ?? null : null
        const entered = parseKm(finishOdo)
        return (
          <div className="dbk-root dbk-page" role="dialog" aria-modal="true" aria-label="ถึงคลัง ปิดงาน">
            <header className="dbk-head">
              <button type="button" className="dbk-back" aria-label="กลับ" onClick={() => setFinishing(null)}>
                <IconChevronLeft size={22} />
              </button>
              <div style={{ flex: 1 }}>
                <div className="dbk-head-t">ถึงคลัง ปิดงาน</div>
                <div className="dbk-head-s">
                  {returningJobs.length > 1 ? `${returningJobs.length} เที่ยว · ${returningJobs.map(jobTripNo).join(', ')}` : `${jobTripNo(finishing)} · ${finishing.vehicle_plate}`}
                </div>
              </div>
            </header>
            <main>
              <section className="dbk-card dbk-stats">
                <div><div className="dbk-stat-n" style={{ color: 'var(--ok)' }}>{okN}</div><div className="dbk-stat-l">ส่งครบ</div></div>
                <div><div className="dbk-stat-n" style={{ color: 'var(--danger)' }}>{badN}</div><div className="dbk-stat-l">ตีกลับ</div></div>
                <div><div className="dbk-stat-n">{closeOrders.length}</div><div className="dbk-stat-l">ใบทั้งหมด</div></div>
                {podGaps.length === 0 && <div className="dbk-stats-foot">หลักฐานครบทุกร้าน ✓</div>}
              </section>
              <label className="dbk-lbl">
                เลขไมล์บนหน้าปัด {finishing.vehicle_plate} (กม.)
                <input className="dbk-inp dbk-inp-big" type="text" inputMode="numeric" autoFocus value={finishOdo}
                  placeholder="เช่น 128400"
                  onChange={(e) => { setFinishOdo(e.target.value); setFinishSuspect(null) }} />
                {startKm != null && (
                  <span className="dbk-sub400">
                    ครั้งก่อน {startKm.toLocaleString('th-TH')} กม.
                    {(entered ?? 0) > startKm && ` · วันนี้วิ่ง ${((entered ?? 0) - startKm).toLocaleString('th-TH')} กม.`}
                  </span>
                )}
              </label>
              <label className="dbk-addrow">
                <input type="file" accept="image/*" onChange={(e) => setFinishPhoto(e.target.files?.[0] ?? null)} />
                <svg className="dbk-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
                {finishPhoto ? 'ถ่ายรูปหน้าปัดแล้ว · ถ่ายใหม่' : 'ถ่ายรูปหน้าปัด (ไม่บังคับ)'}
              </label>
              <div className="dbk-lbl">
                วันนี้ขึ้นทางด่วนไหม
                <div className="dbk-seg two" role="group" aria-label="ขึ้นทางด่วน">
                  <button type="button" aria-pressed={tollHas === false} className={tollHas === false ? 'on' : ''}
                    onClick={() => { setTollHas(false); setTollAmount('') }}>ไม่ขึ้น</button>
                  <button type="button" aria-pressed={tollHas === true} className={tollHas === true ? 'on' : ''}
                    onClick={() => setTollHas(true)}>ขึ้น</button>
                </div>
              </div>
              {tollHas && (
                <label className="dbk-lbl">
                  ค่าทางด่วน (บาท)
                  <input className="dbk-inp" type="text" inputMode="decimal" autoFocus value={tollAmount}
                    placeholder="เช่น 120" onChange={(e) => setTollAmount(e.target.value)} />
                  {returningJobs.length > 1 && <span className="dbk-sub400">บันทึกกับเที่ยว {jobTripNo(finishing)} เที่ยวเดียว — ทางด่วนที่วิ่งคือขากลับเส้นเดียว</span>}
                </label>
              )}
            {/* ตรวจ POD ทั้งหมด — ระบบกันร้านที่ขาดหลักฐานไว้ตั้งแต่ก่อนกล่องนี้จะเปิดแล้ว
                (ดู podGaps ด้านบน) รายการนี้จึงไม่ใช่ด่านใหม่ แค่ให้คนขับเห็นด้วยตาเอง
                ก่อนกดจบงานจริง ว่าร้านไหนของเที่ยวไหนมีหลักฐานครบแล้วบ้าง */}
            {podRows.length > 0 && (
              <>
                <button
                  type="button"
                  className="pod-check-toggle"
                  aria-expanded={podListOpen}
                  onClick={() => setPodListOpen((v) => !v)}
                >
                  <span>✓ ตรวจ POD ทั้งหมด · {podRows.length} ร้าน ครบทุกร้าน</span>
                  <span className="pod-check-chev">{podListOpen ? 'ซ่อน ▲' : 'ดู ▼'}</span>
                </button>
                {podListOpen && (
                  <div className="pod-check-list">
                    {podRows.map((r, i) => (
                      <div className="pod-check-row" key={`${r.trip}-${r.name}-${i}`}>
                        <span className="pod-check-name">
                          {r.name} <span className="pod-check-trip">{r.trip}</span>
                        </span>
                        <Badge label="ครบ" tone="success" />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            </main>
            <div className="dbk-foot">
              <button type="button" className="dbk-btn dbk-pri"
                disabled={busy === finishing.id || tollHas === null
                  || (tollHas && !(Number(tollAmount.replace(/[^0-9.]/g, '')) > 0))
                  || entered === null}
                onClick={() => void act(finishing, 'finish')}>
                {busy === finishing.id ? 'กำลังปิดงาน…' : 'ปิดงาน ย้ายไปประวัติ'}
              </button>
            </div>
            {finishSuspect && entered !== null && (
              <OdoWarning entered={entered} odoKm={startKm != null ? entered - startKm : 0} busy={busy === finishing.id}
                onFix={() => { setFinishSuspect(null); setFinishOdo('') }}
                onConfirm={() => void act(finishing, 'finish')} />
            )}
          </div>
        )
      })()}

      {/* กล่องเลขไมล์ ปิดได้ เพราะคนขับที่ยังไม่ได้อยู่หน้ารถกรอกไม่ได้จริง ๆ
          ปิดแล้วยังมีแถบเตือนค้างอยู่บนจอจนกว่าจะกรอก */}
      <Modal
        open={odometer.open}
        title="เลขไมล์ตอนออกรถ"
        onClose={odometer.close}
        footer={
          <div className="pod-actions">
            <Button variant="ghost" onClick={odometer.close}>ยังไม่ได้อยู่ที่รถ</Button>
            <Button
              loading={odometer.busy}
              disabled={parseKm(odometer.value) === null}
              onClick={() => void odometer.save()}
            >
              บันทึก
            </Button>
          </div>
        }
      >
        <div className="odo-box">
          <p className="odo-lead">
            อ่านเลขบนหน้าปัดรถ <b>{odometer.vehicle?.plate ?? ''}</b> แล้วกรอกตามที่เห็น
            {odometer.pending && <> — {odometer.pending.action === 'accept' ? 'รับงาน' : 'เริ่มเดินทาง'}ได้หลังกรอกเลขนี้</>}
          </p>
          <Field label="เลขไมล์ (กม.)" required>
            <Input
              type="text"
              inputMode="numeric"
              autoFocus
              value={odometer.value}
              placeholder="เช่น 128400"
              onChange={(e) => odometer.setValue(e.target.value)}
            />
          </Field>
          {odometer.status?.last_km != null && (
            /* เลขครั้งก่อนคือสิ่งเดียวที่ทำให้คนขับรู้ทันทีว่าตัวเองอ่านผิดหลัก */
            <p className="odo-last">ครั้งก่อน {odometer.status.last_km.toLocaleString('th-TH')} กม.</p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={undoing !== null}
        title="ยกเลิกการส่งร้านนี้"
        message={undoing ? (
          <>ยกเลิกการปิดส่ง <b>{undoing.customer_name ?? undoing.destination}</b>{' '}
            ({undoing.orders.length} ใบ) ใช่หรือไม่? ใบจะกลับไปเป็นยังไม่ส่ง
            และร้านนี้จะขึ้นในรายการที่ต้องแวะอีกครั้ง</>
        ) : ''}
        confirmLabel="ยกเลิกการส่ง"
        danger
        loading={undoing !== null && delivering === undoing.key}
        onConfirm={() => { if (undoing) void undoDeliver(undoing) }}
        onClose={() => setUndoing(null)}
      />

      {/* ยกเลิกร้าน — ต้องเลือกเหตุผลก่อน ปุ่มยืนยันปิดอยู่จนกว่าจะเลือก
          และกล่องบอกจำนวนใบจริงของร้านนั้น ไม่ใช่คำเตือนลอย ๆ */}
      {cancelling && (
        <Modal
          open
          onClose={() => setCancelling(null)}
          size="sheet"
          title={`ส่งไม่ได้เพราะอะไร — ${cancelling.customer_name ?? cancelling.destination}`}
          footer={
            <div className="pod-actions">
              <Button variant="ghost" onClick={() => setCancelling(null)}>ไม่ยกเลิก</Button>
              <Button
                variant="danger"
                disabled={!cancelReason || (cancelReason === 'อื่น ๆ' && !cancelNote.trim())}
                loading={delivering === cancelling.key}
                onClick={() => {
                  const reason = cancelReason === 'อื่น ๆ'
                    ? cancelNote.trim()
                    : cancelNote.trim() ? `${cancelReason} — ${cancelNote.trim()}` : cancelReason
                  void doCancelStop(cancelling, reason)
                }}
              >
                ยืนยันส่งไม่ได้
              </Button>
            </div>
          }
        >
          <div className="cancel-stop">
            {/* ไม่ได้ลบข้อมูลทิ้ง — ออฟฟิศเห็นร้านและเหตุผล ถอนคืนได้จาก "รายละเอียดเที่ยว" */}
            <p className="cancel-stop-lead">
              {cancelling.pending.length} ใบที่ยังไม่ได้ส่ง · ออฟฟิศจะเห็นเหตุผลนี้ · ถ้ากดผิดถอนคืนได้ภายหลัง
            </p>

            <div className="cancel-stop-reasons" role="group" aria-label="เหตุผลที่ยกเลิก">
              {[...CANCEL_STOP_REASONS, 'อื่น ๆ'].map((r) => (
                <button
                  key={r}
                  type="button"
                  className="pod-kind"
                  aria-pressed={cancelReason === r}
                  onClick={() => setCancelReason(r)}
                >
                  {r}
                </button>
              ))}
            </div>

            <Field label={cancelReason === 'อื่น ๆ' ? 'เหตุผลที่ยกเลิก (จำเป็น)' : 'รายละเอียดเพิ่มเติม (ไม่บังคับ)'}>
              <Textarea
                rows={2}
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                placeholder="เช่น ร้านแจ้งว่าสั่งซ้ำ ให้ส่งคืนคลัง"
              />
            </Field>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={undoCancelling !== null}
        title="ถอนการยกเลิกร้านนี้"
        message={undoCancelling ? (
          <>ให้ <b>{undoCancelling.customer_name ?? undoCancelling.destination}</b>{' '}
            กลับมาเป็นร้านที่ต้องส่งอีกครั้งใช่หรือไม่?</>
        ) : ''}
        confirmLabel="ถอนการยกเลิก"
        loading={undoCancelling !== null && delivering === undoCancelling.key}
        onConfirm={() => { if (undoCancelling) void doUndoCancelStop(undoCancelling) }}
        onClose={() => setUndoCancelling(null)}
      />

      {podFor && (
        <PodSheet
          orders={podFor}
          onClose={() => { setPodFor(null); setPodStop(null) }}
          onSaved={() => {
            setPodFor(null)
            setPodStop(null)
            toast.push('success', 'บันทึกหลักฐานการส่งมอบแล้ว')
            load()
          }}
          /* ปิดฟอร์มก่อนแล้วค่อยถาม — กล่องยืนยันซ้อนบนแผ่นที่เปิดอยู่
             อ่านยากบนจอมือถือ และคนกำลังจะตัดสินใจถอยของจริง */
          onUndo={podStop && can('myjobs.progress') ? () => {
            const stop = podStop
            setPodFor(null)
            setPodStop(null)
            setUndoing(stop)
          } : undefined}
        />
      )}

      {/* จอ 08 — ข้อความไปช่อง issue_note เดิม รูปขึ้น R2 (issue/) path เก็บใน trip_checkpoints kind 'issue' */}
      <IssueSheet
        key={issueFor?.id ?? 'none'}
        open={issueFor !== null && !sendingIssue}
        onClose={() => setIssueFor(null)}
        onSubmit={(reason, note, photo) => {
          const text = note.trim() ? `${reason} · ${note.trim()}` : reason
          void submitIssue(text, photo)
        }}
      />
    </div>
  )
}

/** เลขที่ฐานมองว่าผิดปกติ — บอกเหตุผลกับทางไปต่อ ไม่ใช่แค่บอกว่าผิด
 *  คนขับที่มั่นใจว่าอ่านหน้าปัดถูกต้องมีทางบันทึกได้ ไม่งั้นเขาจะไปหาเลขอื่นมากรอกให้ผ่าน */
