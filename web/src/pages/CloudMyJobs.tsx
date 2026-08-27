import { useEffect, useMemo, useState } from 'react'
import {
  listMyJobs, reloadJob, startTrip, completeTrip, finishReturn, deliverOrder, undoDeliverOrder,
  cancelStop, undoCancelStop,
  acceptTrip, reportIssue, saveStopOrder,
  logOdometer, odometerStatus,
} from '../api/myjobs'
import { useRealtime } from '../hooks/useRealtime'
import { useTripTracking } from '../hooks/useTripTracking'
import { useScreenWakeLock } from '../hooks/useScreenWakeLock'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { useOdometer } from '../hooks/useOdometer'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { MyJob, MyJobOrder } from '../types'
import { groupStops, jobTripNo, type StopGroup } from '../utils/stops'
import { activeJob, autoOpenJob, doneJobs, dutyVehicle, groupHistory, liveJobs } from '../utils/jobs'
import { closingJobs, finishGate, needsOdometer, parseKm, podGapsOf, tollFor } from '../utils/driverActions'
import { CANCEL_STOP_REASONS, TRIP_STATUS_LABEL } from '../utils/constants'
import { fmtDateTime, fmtLongToday, fmtTime } from '../utils/format'
import { applyTheme, currentTheme, type Theme } from '../utils/theme'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, Skeleton, Textarea } from '../components/ui'
import { PodViewModal } from '../components/PodViewModal'
import { JobFocus } from '../components/driver/JobFocus'
import { PodSheet } from '../components/driver/PodSheet'
import {
  IconAlert, IconCheck, IconChevronRight, IconKey, IconLogout, IconMoon, IconSun, IconTruck, IconUsers,
} from '../components/icons'
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
  /* แท็บเริ่มต้นปกติคือ 'jobs' — ค่าจาก env มีไว้ให้ CI เปิดตรงไปแท็บที่จะถ่ายรูป
     ตั้งได้เฉพาะตอน build โหมดสาธิต ของจริงไม่เคยมีค่านี้จึงได้ 'jobs' เสมอ */
  const startTab = import.meta.env.VITE_DEMO_TAB
  const [tab, setTab] = useState<'jobs' | 'history' | 'me'>(
    startTab === 'history' || startTab === 'me' ? startTab : 'jobs',
  )
  const [pwOpen, setPwOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => currentTheme())
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
  /* ค่าทางด่วนของวัน — ถามตอนกดจบงาน จังหวะเดียวที่ใบเสร็จยังอยู่ในมือ
     null = ยังไม่ตอบ ต่างจาก false ที่แปลว่าตอบแล้วว่าไม่มี */
  const [tollHas, setTollHas] = useState<boolean | null>(null)
  const [tollAmount, setTollAmount] = useState('')
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

  /* โหลดใหม่แบบไม่ล้างจอ — ท่าลากลงต้องเห็นของเดิมค้างอยู่ระหว่างรอ
     ถ้าสลับไปเป็นโครงร่างเปล่าทุกครั้ง คนขับจะเสียตำแหน่งที่กำลังอ่านอยู่ */
  const refresh = async (): Promise<void> => {
    try {
      setJobs(await listMyJobs(showDone))
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
  useRealtime(['trips', 'orders'], () => load(showDone))

  /* เที่ยวที่ควรโชว์เป็นค่าเริ่มต้น: กำลังวิ่งก่อน แล้วค่อยเที่ยวที่วางแผนไว้
     คนขับมีเที่ยวที่ยังไม่จบพร้อมกันได้หลายใบ แต่ "กำลังวิ่ง" มีความหมายชัดที่สุด */
  /* กติกาว่าเที่ยวไหนอยู่จอไหนอยู่ใน utils/jobs — ตอบได้จากรายการเที่ยวอย่างเดียว
     ไม่ต้องรู้จัก React จึงเขียนเทสต์ให้มันได้ ต่างจากตอนที่ฝังอยู่ในนี้ */
  const live = useMemo(() => liveJobs(jobs), [jobs])
  const done = useMemo(() => doneJobs(jobs), [jobs])
  const historyGroups = useMemo(() => groupHistory(done), [done])
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
  const tracking = useTripTracking(
    tracked?.id ?? null,
    /* ของ "ฉัน" ไม่ใช่ของเที่ยว — ผู้ช่วยที่ยังไม่กดรับไม่ควรถูกตามตำแหน่ง
       เขายังไม่ได้ยืนยันว่ารับงานนี้ด้วยซ้ำ */
    tracked !== null,
  )
  /* กันจอดับเองระหว่างวิ่ง — ตำแหน่งหยุดส่งทันทีที่จอดับ และช่องว่างที่เคยเห็น
     บนแผนที่คือจอดับเองเพราะคนขับไม่ได้แตะมือถือ ไม่ใช่เขาตั้งใจปิดแอป
     ในแอป native ไม่ต้องฝืนจอแล้ว พิกัดเดินต่อเองขณะจอดับ การกันจอดับตรงนั้น
     เหลือแค่ผลข้างเคียงคือแบตหมดเร็ว */
  const screenAwake = useScreenWakeLock(tracked !== null && !tracking.backgroundCapable)

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
        const shops = gate.shops
        toast.push('warning',
          `ยังเก็บหลักฐานไม่ครบ ${shops.length} ร้าน (${shops.slice(0, 3).join(', ')}${shops.length > 3 ? ' และอื่น ๆ' : ''}) — เก็บให้ครบก่อนจบงาน`)
        setFinishing(null)
        return
      }
      if (gate.kind === 'ask-details') {
        setFinishing(job)
        setTollHas(null)
        setTollAmount('')
        setFinishOdo('')
        return
      }
    }
    /* เลขไมล์ต้นวันเป็นด่านของการ "เริ่มทำงาน" ไม่ใช่ของการเปิดแอป
       ขวางตรงรับงานกับเริ่มเดินทาง เพราะสองปุ่มนี้กดตอนอยู่หน้ารถแล้วเท่านั้น
       ขวางตั้งแต่เปิดแอปคือขวางคนที่นั่งดูงานพรุ่งนี้อยู่ที่บ้าน ซึ่งอ่านหน้าปัดไม่ได้ */
    if (action === 'accept' || action === 'start') {
      /* ถามสถานะของ "รถคันที่กำลังจะขับ" ไม่ใช่คันที่จอกำลังโชว์อยู่ — เงื่อนไขว่าค่าที่
         ถืออยู่ใช้กับคันนี้ได้ไหมอยู่ใน odometerCacheUsable ที่นี่เหลือแค่ยิงถามเมื่อใช้ไม่ได้ */
      const st = odometer.usableFor(job.vehicle_id)
        ? odometer.status
        : await odometerStatus(job.vehicle_id).catch(() => null)
      if (needsOdometer(action, st, opts?.odoDone)) {
        odometer.block({ id: job.vehicle_id, plate: job.vehicle_plate }, st, { job, action })
        toast.push('warning', 'กรอกเลขไมล์ตอนออกรถก่อน แล้วระบบจะทำงานที่กดค้างไว้ให้ต่อ')
        return
      }
    }
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
        if (km !== null) await logOdometer(job.vehicle_id, km, 'end')
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
        const fresh = await listMyJobs(showDone)
        setJobs(fresh)
        /* เที่ยวที่เพิ่งปิดไม่มีอะไรให้กางอีกแล้ว ปล่อยให้จอเลือกงานถัดไปเอง */
        if (activeId !== null && activeId !== -1 && ids.has(activeId)) setActiveId(-1)
      } else {
        const updated = await reloadJob(job.id, showDone)
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
      toast.push('error', (e as Error).message)
    } finally {
      setBusy(0)
      setFinishing(null)
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
      const ids = stop.orders.filter((o) => o.status !== 'delivered' && !o.has_pod).map((o) => o.id)
      if (ids.length === 0) throw new Error('ร้านนี้ไม่มีใบที่ยกเลิกได้แล้ว')
      await cancelStop(ids, reason)
      const tripId = stop.orders[0]?.trip_id
      const updated = tripId ? await reloadJob(tripId, showDone) : null
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
      const updated = tripId ? await reloadJob(tripId, showDone) : null
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
      const updated = tripId ? await reloadJob(tripId, showDone) : null
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
      const updated = await reloadJob(job.id, showDone)
      if (updated) setJobs((list) => list.map((j) => (j.id === updated.id ? updated : j)))
      toast.push('error', (e as Error).message)
    }
  }

  if (error) return <ErrorBox message={error} onRetry={() => load(showDone)} />

  return (
    <div className="driver-scope">
      {/* แถบสถานะของท่าลากลง ไหลตามนิ้วแล้วค้างไว้ระหว่างโหลด
          อยู่เหนือทุกอย่างและไม่กินที่ตอนไม่ได้ใช้ */}
      <div
        className={`pull-hint${pull.refreshing ? ' is-loading' : ''}${pull.ready ? ' is-ready' : ''}`}
        style={{ height: pull.distance }}
        aria-hidden={pull.distance === 0}
      >
        {pull.distance > 0 && (
          <span>{pull.refreshing ? 'กำลังโหลด…' : pull.ready ? 'ปล่อยเพื่อโหลดใหม่' : 'ลากลงเพื่อโหลดใหม่'}</span>
        )}
      </div>

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
        <div className="hist-list">
          {done.length === 0 && (
            <EmptyState icon={<IconTruck size={28} />} title="ยังไม่มีงานที่ปิดแล้ว" desc="งานที่ปิดงานเรียบร้อยจะมาอยู่ที่นี่" />
          )}
          {historyGroups.map((group) => (
            <section key={group.key} className="hist-group">
              <h2 className="hist-date">{group.label}</h2>
              <ul className="hist-rows">
                {group.jobs.map((j) => (
                  <li key={j.id}>
                    <div className="hist-row">
                      <span className={`hist-ic${j.issue_note ? ' is-flag' : ''}`} aria-hidden>
                        {j.issue_note ? <IconAlert size={17} /> : <IconCheck size={17} />}
                      </span>
                      <span className="hist-text">
                        <span className="hist-no">{jobTripNo(j)}</span>
                        <span className="hist-meta">
                          {j.vehicle_plate} · {groupStops(j.orders).length} จุดส่ง · {j.orders.length} ใบ
                          {j.arrived_at ? ` · ปิดงาน ${fmtTime(j.arrived_at)}` : ''}
                        </span>
                      </span>
                      <Badge label={TRIP_STATUS_LABEL[j.status]} tone={j.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {tab === 'me' && (
        <div className="driver-me">
          <div className="driver-me-card">
            {/* iOS2: avatar กล่องมนแก้วโปร่ง — ใช้อักษรแรกของชื่อ */}
            <span className="driver-me-avatar" aria-hidden>
              {(user?.name ?? '?').trim().charAt(0)}
            </span>
            <span className="driver-me-name">{user?.name}</span>
            <span className="driver-me-sub">{user?.username} · พนักงานขับรถ · {fmtLongToday()}</span>
          </div>
          {/* ปุ่มธีมเคยอยู่บนแถบบนที่ถูกถอดออกไป — กลางแดดกับตอนกลางคืนคนละเรื่องกัน
              คนขับต้องสลับเองได้ */}
          <Button variant="outline" className="driver-me-action"
            aria-pressed={theme === 'dark'}
            onClick={() => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); applyTheme(next) }}>
            <span className="driver-me-ic" aria-hidden>{theme === 'dark' ? <IconMoon size={16} /> : <IconSun size={16} />}</span>
            <span className="driver-me-label">{theme === 'dark' ? 'โหมดมืด' : 'โหมดสว่าง'}</span>
            <span className="driver-me-switch" aria-hidden />
          </Button>
          {/* สองอย่างที่คนขับต้องทำเองได้จริงจากในรถ ไม่ต้องโทรหาออฟฟิศ */}
          <Button variant="outline" className="driver-me-action" onClick={() => setPwOpen(true)}>
            <span className="driver-me-ic" aria-hidden><IconKey size={16} /></span>
            <span className="driver-me-label">เปลี่ยนรหัสผ่าน</span>
            <span className="driver-me-chev" aria-hidden><IconChevronRight size={16} /></span>
          </Button>
          <Button variant="ghost" className="driver-me-action is-danger" onClick={() => void logout()}>
            <span className="driver-me-ic" aria-hidden><IconLogout size={16} /></span>
            <span className="driver-me-label">ออกจากระบบ</span>
          </Button>
          <p className="text-xs text-muted">
            เปิดหน้านี้ค้างไว้ระหว่างขับ ระบบถึงจะบันทึกตำแหน่งของเที่ยวให้ฝ่ายวางแผนเห็น
          </p>
        </div>
      )}

      {/* แถบเตือนเลขไมล์ — อยู่บนสุดของแท็บงาน ไม่ใช่ toast ที่หายไปเอง
          เพราะเรื่องนี้ต้องค้างอยู่จนกว่าจะทำ ไม่ใช่แค่แจ้งให้รู้ */}
      {tab === 'jobs' && odometer.status && !odometer.status.logged_today && odometer.vehicle && (
        <button type="button" className="odo-bar" onClick={odometer.ask}>
          <span className="odo-bar-text">ยังไม่ได้กรอกเลขไมล์ตอนออกรถของ {odometer.vehicle.plate}</span>
          <span className="odo-bar-cta">กรอกเลย</span>
        </button>
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
          {/* เข้าเที่ยวไหนแล้วเห็นเที่ยวนั้นเที่ยวเดียว — การ์ดที่หุบอยู่ของเที่ยวอื่น
              ยังกดได้ ซึ่งแปลว่าระหว่างกดปิดจุดส่ง นิ้วพลาดไปโดนหัวการ์ดอีกเที่ยว
              แล้วจอสลับเที่ยวโดยไม่มีใครสั่ง ปุ่มถอยข้างล่างคือทางกลับทางเดียว */}
          {active && (
            <button type="button" className="job-back" onClick={() => setActiveId(-1)}>
              <span className="job-back-ic" aria-hidden><IconChevronRight size={16} /></span>
              งานของฉัน{live.length > 1 ? ` · อีก ${live.length - 1} เที่ยว` : ''}
            </button>
          )}
          {/* ทุกเที่ยวหุบเป็นแถวเดียว กางทีละเที่ยว — คนขับถือหลายเที่ยวพร้อมกันได้
              กางทุกเที่ยวพร้อมกันคือจอที่ต้องเลื่อนผ่านจุดส่งของเที่ยวอื่นก่อนถึงของตัวเอง
              และเสี่ยงกดปิดจุดผิดเที่ยว ซึ่งย้อนกลับไม่ได้ */}
          {(active ? [active] : live).map((job) => {
            const open = job.id === active?.id
            const delivered = job.orders.filter((o) => o.status === 'delivered').length
            const mine = job.my_accepted_at ?? job.accepted_at
            /* ยุบเป็นร้านเหมือนหน้าคนขับ — คนขับคิดเป็น "กี่ร้าน" ไม่ใช่ "กี่ใบ"
               คำนวณเฉพาะงานใหม่ งานที่รับแล้ว JobFocus ยุบให้อยู่แล้ว */
            const newStops = mine ? [] : groupStops(job.orders)
            const firstStop = newStops[0]
            const preview = !mine && previewId === job.id
            return (
              <section key={job.id} className={`job-card${open ? ' is-open' : ''}${!mine ? ' is-new' : ''}`}>
                {/* งานที่ยังไม่ได้กดรับ กางไม่ได้ — แถวเดียว จบที่ปุ่มรับงานทางขวา
                    รายละเอียดของงานเป็นของคนที่รับงานแล้ว และการกดรับไม่ใช่การเลือก
                    (ไม่มีปุ่มปฏิเสธ TMS จ่ายคนมาแล้ว) การกางให้อ่านก่อนจึงไม่ได้
                    ช่วยตัดสินใจอะไร มีแต่ทำให้จอแรกยาวเป็นสองเท่า */}
                {!mine ? (
                  <div className="job-card-head is-new">
                    <span className="job-card-text">
                      <span className="job-card-no">{jobTripNo(job)}</span>
                      {/* เลขเที่ยวอย่างเดียวตอบไม่ได้ว่างานนี้คืออะไร — กี่ร้าน ออกจากคลังไหน
                          นัดแรกกี่โมง คือสามอย่างที่คนขับถามก่อนเสมอ และสั้นพอจะอยู่ในบรรทัดเดียว */}
                      <span className="job-card-meta">
                        {job.vehicle_plate} · {newStops.length} ร้าน · {job.orders.length} ใบ
                        {job.warehouse_code ? ` · คลัง ${job.warehouse_code}` : ''}
                        {firstStop ? ` · นัดแรก ${fmtTime(firstStop.scheduled_at)}` : ''}
                      </span>
                    </span>
                    {/* ปุ่มเดียวในแถวนี้ — ปุ่มอ่านอยู่คนละแถวข้างล่าง ไม่ใช่ชิดกันแค่ 6px
                        ปุ่มที่ไม่ควรกดสลับกัน ต้องห่างกันจริง ไม่ใช่ห่างกันพอเป็นพิธี */}
                    <Button
                      className="job-card-accept"
                      loading={busy === job.id}
                      onClick={() => void act(job, 'accept')}
                    >
                      รับงาน
                    </Button>
                  </div>
                ) : (
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
                      </span>
                    </span>
                    <Badge label={TRIP_STATUS_LABEL[job.status]} tone={job.status} dot={job.status === 'in_progress'} />
                  </button>
                )}

                {/* ทางเดียวที่เหลือของคนที่รับงานนี้ไม่ได้จริง ๆ (รถเสีย ไม่ใช่คันนี้)
                    ต้องอยู่ตรงนี้ เพราะปุ่มแจ้งปัญหาเดิมอยู่ในการ์ดที่ตอนนี้กางไม่ได้แล้ว */}
                {/* พรีวิวเป็นรายการอ่านอย่างเดียว — ชื่อร้าน เวลานัด จำนวนใบ ไม่มีปุ่มปิดจุด
                    ไม่มีปุ่มเก็บหลักฐาน ไม่มีปุ่มจัดลำดับ ของพวกนั้นเป็นของคนที่รับงานแล้ว
                    ปิดด้วยการกด "ซ่อนจุดส่ง" ปุ่มเดิม ไม่มีปุ่มออกแยกให้ต้องหา */}
                {preview && (
                  <ol className="job-preview" aria-label={`จุดส่งของ ${jobTripNo(job)}`}>
                    {newStops.map((s, i) => (
                      <li key={s.key}>
                        <span className="job-preview-seq">{i + 1}</span>
                        <span className="job-preview-name">{s.customer_name ?? s.destination}</span>
                        <span className="job-preview-meta">
                          {fmtTime(s.scheduled_at)}
                          {s.orders.length > 1 ? ` · ${s.orders.length} ใบ` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}

                {!mine && (
                  <div className="job-card-newbar">
                    {/* ปุ่มอ่าน อยู่คนละแถวกับปุ่มรับงาน และมีขอบของตัวเอง
                        แบบ ghost จาง ๆ อ่านไม่ออกกลางแดด ซึ่งเป็นที่ที่จอนี้ถูกใช้จริง */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="job-card-peek"
                      aria-expanded={preview}
                      onClick={() => setPreviewId(preview ? null : job.id)}
                    >
                      {preview ? 'ซ่อนจุดส่ง' : `ดูจุดส่ง ${newStops.length} ร้าน`}
                    </Button>
                    <button type="button" className="job-card-issue" onClick={() => { setIssueFor(job); setIssueNote('') }}>
                      แจ้งปัญหา
                    </button>
                  </div>
                )}

                {open && mine && (
                  <div className="job-card-body">
                    <JobFocus
                      job={job}
                      busy={busy === job.id}
                      deliveringKey={delivering}
                      canProgress={can('myjobs.progress')}
                      canPod={can('myjobs.pod')}
                      unfinishedOthers={unfinishedOthers(job)}
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

                    {/* บอกตรง ๆ ว่าตอนนี้บันทึกอยู่หรือไม่ — เบราว์เซอร์หยุดให้ตำแหน่งเมื่อพับหน้าจอ
                        ถ้าไม่บอก คนขับจะเชื่อว่ามีการบันทึกตลอดเวลา แล้ววันที่ต้องใช้จะไม่มีข้อมูล */}
                    {mine && (
                      <p className={`track-note${tracking.state === 'denied' ? ' is-off' : ''}`}>
                        {tracking.state === 'on'
                          ? tracking.backgroundCapable
                            /* ในแอป พิกัดเดินต่อขณะจอดับ การสั่งให้เปิดหน้าค้างไว้
                               ตรงนี้จะเป็นคำสั่งที่ไม่จำเป็นและกินแบตฟรี */
                            ? 'กำลังบันทึกเส้นทาง — ล็อกจอได้ตามปกติ บันทึกต่อจนกว่าจะปิดเที่ยว'
                            : screenAwake
                              /* จอไม่ดับเองแล้ว แต่กดปุ่มปิดจอเองยังหลุดอยู่ดี บอกให้ครบ
                                 และเตือนเรื่องแบตด้วย เพราะเราเป็นคนทำให้จอค้างเอง */
                              ? 'กำลังบันทึกตำแหน่ง — จอจะไม่ดับเอง เสียบสายชาร์จไว้ระหว่างขับ'
                              : 'กำลังบันทึกตำแหน่งของเที่ยวนี้ — เปิดหน้านี้ค้างไว้ระหว่างขับ'
                          : tracking.state === 'denied'
                            ? 'ไม่ได้รับสิทธิ์ตำแหน่ง — ฝ่ายวางแผนจะไม่เห็นว่ารถอยู่ไหน'
                            : tracking.state === 'unsupported'
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

      {podView && (
        <PodViewModal
          orderId={podView.id}
          billNo={podView.tms_picking_list_no ?? podView.order_no}
          onClose={() => setPodView(null)}
        />
      )}

      {/* ถามชื่อร้านกลับไปให้เห็นเต็ม ๆ — คนที่กดผิดร้านหนึ่งครั้งแล้ว กำลังจะ
          กดถอยจากรายการเดียวกันนั้น ต้องอ่านชื่อก่อนว่าถอยถูกใบ */}
      {/* จบงานคือขั้นสุดท้ายของวัน กดพลาดแล้วรถถูกนับว่าว่างทั้งที่ยังอยู่บนถนน
          และเที่ยวหลุดจากจอไปอยู่ในประวัติ ถามหนึ่งครั้งก่อนพอ */}
      {/* จบงาน + ค่าทางด่วน อยู่ในกล่องเดียวกัน ไม่ใช่ถามต่อกันสองกล่อง
          ถามหลังจบงานสำเร็จ = คนขับปิดแอปเดินลงจากรถได้ก่อนตอบ แล้วเงินที่สำรอง
          จ่ายไปไม่มีใครรู้ ถามก่อน = ตัวเลขถูกส่งไปพร้อมคำสั่งเดียวกัน */}
      <Modal
        open={finishing !== null}
        title="จบงานเที่ยวนี้"
        onClose={() => setFinishing(null)}
        footer={
          <div className="pod-actions">
            <Button variant="ghost" onClick={() => setFinishing(null)}>ยังไม่จบ</Button>
            <Button
              loading={finishing !== null && busy === finishing.id}
              disabled={tollHas === null
                || (tollHas && !(Number(tollAmount.replace(/[^0-9.]/g, '')) > 0))
                || !(Number(finishOdo.replace(/[^0-9]/g, '')) > 0)}
              onClick={() => { if (finishing) void act(finishing, 'finish') }}
            >
              กลับถึงคลังแล้ว
            </Button>
          </div>
        }
      >
        {finishing && (
          <div className="finish-box">
            <p className="finish-lead">
              ยืนยันว่ารถกลับถึงคลังแล้วใช่หรือไม่?{' '}
              {returningJobs.length > 1
                ? <>ทั้ง <b>{returningJobs.length} เที่ยว</b> ที่รออยู่ ({returningJobs.map(jobTripNo).join(', ')}) จะถูกปิดพร้อมกัน</>
                : <>เที่ยว <b>{jobTripNo(finishing)}</b> จะถูกปิด</>}{' '}
              รถกับคนขับจะถูกนับว่าว่าง และการบันทึกตำแหน่งจะหยุดทันที
            </p>
            {/* เลขไมล์อยู่ก่อนค่าทางด่วน — อ่านหน้าปัดคือสิ่งที่ต้องทำตอนยังอยู่ในรถ
                ส่วนใบเสร็จทางด่วนหยิบจากกระเป๋าได้ทีหลัง */}
            <Field label={`เลขไมล์ตอนกลับถึงคลัง ${finishing.vehicle_plate} (กม.)`} required>
              <Input
                type="text"
                inputMode="numeric"
                autoFocus
                value={finishOdo}
                placeholder="เช่น 128400"
                onChange={(e) => setFinishOdo(e.target.value)}
              />
            </Field>
            {/* เลขตอนออกรถของวันนี้มีค่ามากกว่าเลขของเมื่อวาน เพราะคนขับกำลังจะ
                กรอกเลขที่ต้องมากกว่ามัน และผลต่างคือระยะของวันที่เขาเพิ่งวิ่งจบ */}
            {odometer.vehicle?.id === finishing.vehicle_id && odometer.status?.start_km != null && (
              <p className="odo-last">
                ตอนออกรถ {odometer.status.start_km.toLocaleString('th-TH')} กม.
                {(parseKm(finishOdo) ?? 0) > odometer.status.start_km
                  && ` · วันนี้วิ่ง ${((parseKm(finishOdo) ?? 0) - odometer.status.start_km).toLocaleString('th-TH')} กม.`}
              </p>
            )}
            <p className="finish-toll-q">วันนี้มีค่าทางด่วนไหม</p>
            <div className="finish-toll-pick">
              <button
                type="button"
                className={`pod-kind${tollHas === true ? ' is-on' : ''}`}
                aria-pressed={tollHas === true}
                onClick={() => setTollHas(true)}
              >
                มี
              </button>
              <button
                type="button"
                className={`pod-kind${tollHas === false ? ' is-on' : ''}`}
                aria-pressed={tollHas === false}
                onClick={() => { setTollHas(false); setTollAmount('') }}
              >
                ไม่มี
              </button>
            </div>
            {tollHas && (
              <Field label="ค่าทางด่วนรวม (บาท)" required>
                <Input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={tollAmount}
                  placeholder="เช่น 120"
                  onChange={(e) => setTollAmount(e.target.value)}
                />
              </Field>
            )}
            {returningJobs.length > 1 && tollHas && (
              <p className="finish-toll-note">
                บันทึกกับเที่ยว <b>{jobTripNo(finishing)}</b> เที่ยวเดียว — ทางด่วนที่วิ่งคือขากลับเส้นเดียว
              </p>
            )}
          </div>
        )}
      </Modal>

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
          title={`ยกเลิกร้าน — ${cancelling.customer_name ?? cancelling.destination}`}
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
                ยืนยันยกเลิกร้านนี้
              </Button>
            </div>
          }
        >
          <div className="cancel-stop">
            <p className="cancel-stop-lead">
              ร้านนี้มี <b>{cancelling.pending.length} ใบ</b> ที่ยังไม่ได้ส่ง
              ทั้งหมดจะถูกทำเครื่องหมายว่ายกเลิก แล้วร้านนี้จะไม่นับเป็นงานค้างอีก
              ทำให้ปิดเที่ยวได้เมื่อร้านที่เหลือส่งครบ
            </p>
            <p className="cancel-stop-note">
              ไม่ได้ลบข้อมูลทิ้ง ออฟฟิศเห็นทั้งร้านและเหตุผล และเป็นคนตัดสินว่า
              จะปล่อยใบกลับไปสั่งใหม่หรือไม่ · ถ้ากดผิด ถอนคืนได้จากการ์ดร้านนี้
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
            load(showDone)
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
