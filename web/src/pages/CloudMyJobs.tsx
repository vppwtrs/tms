import { useEffect, useMemo, useState } from 'react'
import {
  listMyJobs, reloadJob, startTrip, completeTrip, finishReturn, deliverOrder, undoDeliverOrder,
  savePodWithPhotos, POD_PHOTO_KINDS, type PodPhoto,
  acceptTrip, reportIssue, saveStopOrder,
} from '../api/myjobs'
import { useRealtime } from '../hooks/useRealtime'
import { useTripTracking } from '../hooks/useTripTracking'
import { useScreenWakeLock } from '../hooks/useScreenWakeLock'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { uploadPodPhoto } from '../api/storage'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { MyJob, MyJobOrder } from '../types'
import { groupStops, jobTripNo, type StopGroup } from '../utils/stops'
import { TRIP_STATUS_LABEL } from '../utils/constants'
import { fmtDateTime, fmtLongToday, fmtTime } from '../utils/format'
import { applyTheme, currentTheme, type Theme } from '../utils/theme'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, Skeleton, Textarea } from '../components/ui'
import { SignaturePad } from '../components/SignaturePad'
import { PodViewModal } from '../components/PodViewModal'
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
  /* ร้านที่ฟอร์ม POD ที่เปิดอยู่เป็นของมัน — เก็บไว้เพื่อให้ถอนการส่งจากในฟอร์มได้
     คนที่กดปิดผิดร้านรู้ตัวตอนอ่านชื่อร้านบนหัวฟอร์ม ไม่ใช่ตอนกลับไปที่รายการ */
  const [podStop, setPodStop] = useState<StopGroup | null>(null)
  /* ร้านที่กำลังจะถอนการปิดส่ง — ถามก่อนเสมอ การถอยผิดจุดคือกดผิดซ้ำสอง */
  const [undoing, setUndoing] = useState<StopGroup | null>(null)
  /* จบงานคือขั้นที่ย้อนไม่ได้จากฝั่งคนขับ — รถถูกนับว่าว่างทันที และเที่ยวหลุดจากจอไปเลย
     ถามยืนยันก่อนหนึ่งครั้ง ไม่ใช่หน่วงเวลา เพราะคนที่กลับถึงคลังจริงไม่ควรต้องรอ */
  const [finishing, setFinishing] = useState<MyJob | null>(null)
  /* ใบที่กำลังเปิดดูหลักฐานย้อนหลัง — คนละอย่างกับ podFor ที่เป็นการเก็บใหม่ */
  const [podView, setPodView] = useState<MyJobOrder | null>(null)
  const [activeId, setActiveId] = useState<number | null>(null)
  /* เที่ยวใหม่ที่กางพรีวิวอยู่ — อ่านอย่างเดียว ไม่มีปุ่มสั่งงานสักปุ่ม
     คนละอย่างกับ activeId ซึ่งเป็นการ์ดของงานที่รับแล้วและกดสั่งงานได้ */
  const [previewId, setPreviewId] = useState<number | null>(null)
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
  /* งานที่ยังไม่จบเท่านั้นที่อยู่ในแท็บงาน — งานที่ปิดแล้วเป็นประวัติ ไม่ใช่สิ่งที่ต้องทำ */
  const live = useMemo(() => jobs.filter((j) => j.status !== 'completed' && j.status !== 'cancelled'), [jobs])
  const done = useMemo(() => jobs.filter((j) => j.status === 'completed' || j.status === 'cancelled'), [jobs])
  /* การ์ดที่กางเองตอนเปิดแอป — เฉพาะงานที่ "รับแล้ว" เท่านั้น งานใหม่หุบไว้เสมอ
     จนกว่าจะกดรับ ไม่งั้นจอแรกที่เห็นคือจุดส่งของงานที่ยังไม่ได้ตกลงรับ */
  const defaultJob = useMemo(() => {
    const accepted = live.filter((j) => j.my_accepted_at ?? j.accepted_at)
    return accepted.find((j) => j.status === 'in_progress')
      ?? accepted.find((j) => j.status === 'planned')
      ?? accepted[0] ?? null
  }, [live])
  /* การ์ดที่กางอยู่ — ค่าเริ่มต้นคือเที่ยวที่กำลังวิ่ง ถ้าหุบหมดจะเก็บเป็น -1
     (ไม่ใช่ null เพราะ null แปลว่า "ยังไม่เลือก" ซึ่งต้องถอยไปใช้ค่าเริ่มต้น) */
  const active = activeId === -1 ? null : live.find((j) => j.id === activeId) ?? defaultJob
  /* งานใหม่ที่ยังไม่ได้กดรับ — ตัวเลขบนแท็บมีไว้ตอบว่า "มีอะไรรอฉันอยู่ไหม" โดยไม่ต้องเปิดดู */
  const unread = live.filter((j) => !(j.my_accepted_at ?? j.accepted_at)).length
  /* เที่ยวอื่นที่ยังไม่จบ — รถกลับเข้าคลังครั้งเดียว ไม่ใช่ครั้งละเที่ยว
     นับงานที่ยังไม่ได้กดรับด้วย เพราะคนวางแผนจ่ายมาแล้ว มันคืองานของวันนี้ที่ยังไม่ได้วิ่ง
     ไม่ใช่ข้อเสนอที่ปฏิเสธได้ — กดจบงานทั้งที่ยังมีของบนรถคือรถถูกนับว่าว่างผิด
     ไม่นับเที่ยวที่ถึงขั้น "กำลังกลับคลัง" แล้ว เพราะนั่นคือขากลับเดียวกันของรถคันเดียวกัน */
  /* ทุกเที่ยวที่รออยู่บนขากลับคันเดียวกัน — ปุ่มจบงานปิดทั้งชุดนี้พร้อมกัน */
  const returningJobs = live.filter((j) => j.status === 'returning')
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

  const act = async (job: MyJob, action: 'start' | 'complete' | 'accept' | 'finish'): Promise<void> => {
    if (action === 'finish' && finishing?.id !== job.id) {
      setFinishing(job)
      return
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
      const closing = action === 'finish' ? returningJobs : [job]
      await (action === 'accept' ? acceptTrip(job.id)
        : action === 'start' ? startTrip(job.id)
        /* ทีละเที่ยวตามลำดับ ไม่ใช่ยิงพร้อมกัน — ฝั่งฐานคิดสถานะรถจากเที่ยวที่ค้างอยู่
           การยิงขนานกันทำให้สองคำสั่งอ่านสถานะเดียวกันก่อนอีกตัวเขียนเสร็จ */
        : action === 'finish' ? (async () => { for (const j of closing) await finishReturn(j.id) })()
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
        <ul className="trip-switch-list">
          {done.length === 0 && (
            <EmptyState icon={<IconTruck size={28} />} title="ยังไม่มีงานที่ปิดแล้ว" desc="งานที่ปิดงานเรียบร้อยจะมาอยู่ที่นี่" />
          )}
          {done.map((j) => (
            <li key={j.id}>
              <div className="trip-switch">
                <span className="trip-switch-no">{jobTripNo(j)}</span>
                <span className="trip-switch-meta">
                  {j.vehicle_plate} · {j.orders.length} ใบ
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
                      onAct={(j, action) => void act(j, action)}
                      onReportIssue={(j) => { setIssueFor(j); setIssueNote('') }}
                      onPod={(stop) => {
                        setPodStop(stop)
                        setPodFor(stop.needPod.length > 0 ? stop.needPod : stop.orders)
                      }}
                      onViewPod={setPodView}
                      onDeliver={(stop) => void deliver(stop)}
                      onUndoDeliver={(stop) => setUndoing(stop)}
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
      <ConfirmDialog
        open={finishing !== null}
        title="จบงานเที่ยวนี้"
        message={finishing ? (
          <>ยืนยันว่ารถกลับถึงคลังแล้วใช่หรือไม่?{' '}
            {returningJobs.length > 1
              ? <>ทั้ง <b>{returningJobs.length} เที่ยว</b> ที่รออยู่ ({returningJobs.map(jobTripNo).join(', ')}) จะถูกปิดพร้อมกัน</>
              : <>เที่ยว <b>{jobTripNo(finishing)}</b> จะถูกปิด</>}{' '}
            รถกับคนขับจะถูกนับว่าว่าง และการบันทึกตำแหน่งจะหยุดทันที</>
        ) : ''}
        confirmLabel="กลับถึงคลังแล้ว"
        loading={finishing !== null && busy === finishing.id}
        onConfirm={() => { if (finishing) void act(finishing, 'finish') }}
        onClose={() => setFinishing(null)}
      />

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

const podKindLabel = (kind: string): string =>
  POD_PHOTO_KINDS.find((k) => k.kind === kind)?.label ?? kind

/* สามมุมที่ต้องมีทุกครั้ง เรียงตามลำดับที่มันเกิดขึ้นจริงหน้าร้าน —
   ยกของลง (สินค้า) ยืนถอยออกมา (หน้าร้าน) ยื่นเอกสารให้เซ็น (ใบเซ็นรับ)
   ลำดับนี้ไม่ใช่ความชอบ มันคือทางเดินของคนถือของ การให้เลือกเองทุกครั้ง
   แปลว่าต้องคิดเรื่องลำดับใหม่ที่ร้านที่ห้าสิบของสัปดาห์ */
const POD_STEPS = [
  { kind: 'goods', hint: 'ให้เห็นของทั้งกองที่ยกลงจากรถ' },
  { kind: 'shopfront', hint: 'ให้เห็นป้ายชื่อร้านหรือหน้าอาคาร' },
  { kind: 'document', hint: 'ให้อ่านเลขที่ใบและลายเซ็นออก' },
] as const

const podStepHint = (kind: string): string => POD_STEPS.find((s) => s.kind === kind)?.hint ?? ''

/**
 * เก็บ POD จากในรถ — ลายเซ็น + ชื่อผู้รับ + รูปหน้างาน + พิกัด ครบในครั้งเดียว
 *
 * รับมาเป็น "ใบทั้งหมดของร้านนี้" ลายเซ็นชุดเดียวถูกบันทึกลงทุกใบ เพราะผู้รับ
 * เซ็นรับของทั้งกองครั้งเดียวจริง ๆ ส่วนฐานยังเก็บ POD ผูกกับใบเหมือนเดิม
 * ฝ่ายบัญชีจึงยังเปิดหลักฐานรายใบได้
 */
function PodSheet({ orders, onClose, onSaved, onUndo }: {
  orders: MyJobOrder[]
  onClose: () => void
  onSaved: () => void
  /* กดผิดร้าน — ถอนการปิดส่งทั้งร้านแล้วออกจากฟอร์ม ไม่ส่งมา = ไม่มีสิทธิ์ถอน */
  onUndo?: () => void
}): React.JSX.Element {
  const toast = useToast()
  const order = orders[0] as MyJobOrder
  /* สองหน้า ไม่ใช่ฟอร์มเดียวยาว ๆ — หน้าแรกทำด้วยมือตัวเอง (ถ่ายรูป)
     หน้าสองต้องยื่นมือถือให้คนอื่น (เซ็น) คนละสถานการณ์ทางกายภาพ
     ยัดไว้หน้าเดียวแปลว่าต้องเลื่อนหาของกลางฟอร์มขณะยืนถือของอยู่ */
  const [step, setStep] = useState<'photo' | 'sign'>('photo')
  /* path ของรูปที่อัปขึ้นถังแล้วตั้งแต่จบหน้าแรก — หน้าสองมีแค่ลายเซ็นกับปุ่มบันทึก
     ซึ่งเร็ว ผู้รับจึงไม่ต้องยืนรอโหลดรูปทั้งกองโดยถือมือถือของคนอื่นไว้ */
  const [photos, setPhotos] = useState<PodPhoto[] | null>(null)
  const [name, setName] = useState(order.customer_name ?? '')
  const [sig, setSig] = useState('')
  const [note, setNote] = useState('')
  /* หมายเหตุพับไว้ก่อน — ส่วนใหญ่ไม่มีอะไรจะเขียน กล่องที่ว่างตลอดเวลา
     คือความยาวที่ทุกคนต้องเลื่อนผ่านโดยไม่ได้ใช้ */
  const [noteOpen, setNoteOpen] = useState(false)
  /* หลายมุมต่อหนึ่งใบ — ข้อโต้แย้งเรื่องการส่งของถามหลายอย่างพร้อมกัน
     ของที่ส่ง สภาพหน้าร้าน และใบเซ็นรับ รูปเดียวตอบได้ข้อเดียว */
  const [shots, setShots] = useState<{ img: CompressedImage; kind: string }[]>([])
  const [kind, setKind] = useState<string>(POD_STEPS[0].kind)
  /* ถ่ายมุมที่ขาดไม่ได้จริง ๆ (ร้านไม่มีป้าย ไม่มีใบให้เซ็น) — เปิดทางออกไว้
     แต่ต้องกดเอง ไม่ใช่ปล่อยผ่านเงียบ ๆ ทุกครั้งที่ขี้เกียจถ่าย */
  const [relaxed, setRelaxed] = useState(false)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [saving, setSaving] = useState(false)

  const taken = new Set(shots.map((s) => s.kind))
  const missing = POD_STEPS.filter((s) => !taken.has(s.kind)).map((s) => s.kind)
  const stepNo = POD_STEPS.length - missing.length + 1

  /* ประทับมุมขวาล่างของรูปทุกใบ — ร้าน วันเวลา พิกัด
     เป็นฟังก์ชันเพราะเวลาต้องเป็นวินาทีที่กดชัตเตอร์ ไม่ใช่วินาทีที่เปิดฟอร์ม */
  const stampLines = (): string[] => {
    const lines = [order.customer_name ?? order.destination, new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })]
    if (coords) lines.push(`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`)
    return lines
  }

  /* ถ่ายเสร็จแล้วเลื่อนไปมุมถัดไปที่ยังขาดเอง — คนขับถือของอยู่ ไม่ควรต้องกลับมา
     กดชิปเปลี่ยนมุมเองทุกใบ ครบสามมุมแล้วค้างไว้ที่ "อื่น ๆ" สำหรับรูปเสริม */
  const capture = (img: CompressedImage): void => {
    const next = [...shots, { img, kind }]
    setShots(next)
    const have = new Set(next.map((s) => s.kind))
    const left = POD_STEPS.filter((s) => !have.has(s.kind))
    const nextKind = left[0]?.kind ?? 'other'
    setKind(nextKind)
    toast.push(
      'success',
      left.length > 0
        ? `เก็บ${podKindLabel(kind)}แล้ว — ต่อไปถ่าย${podKindLabel(nextKind)}`
        : 'ครบทั้งสามมุมแล้ว — บันทึกได้เลย',
    )
  }

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

  /* หน้าแรก: ชื่อผู้รับ + รูป → อัปรูปขึ้นถังทันทีที่กดบันทึก แล้วไปหน้าลายเซ็น
     งานหนักทั้งหมด (อัปโหลด) จบตั้งแต่ตอนที่มือถือยังอยู่ในมือคนขับ */
  const submitPhotos = async (): Promise<void> => {
    if (!name.trim()) {
      toast.push('warning', 'ใส่ชื่อผู้รับก่อน')
      return
    }
    /* รูปเป็นของบังคับ — ลายเซ็นบอกว่ามีคนเซ็น รูปบอกว่าส่งอะไรไปและสภาพเป็นยังไง
       ฝั่งฐานปฏิเสธอยู่แล้ว ดักตรงนี้เพื่อไม่ให้คนขับเสียเวลาอัปโหลดแล้วเจอ error */
    if (shots.length === 0) {
      toast.push('warning', 'ต้องถ่ายรูปอย่างน้อยหนึ่งรูป')
      return
    }
    if (missing.length > 0 && !relaxed) {
      toast.push('warning', `ยังขาด ${missing.map((k) => podKindLabel(k)).join(' และ ')}`)
      return
    }
    setSaving(true)
    try {
      /* อัปโหลดรูปขึ้น Storage ก่อน แล้วค่อยบันทึก POD พร้อม path ในหน้าถัดไป
         ลำดับนี้สำคัญ: ถ้าบันทึก POD ก่อนแล้วอัปรูปพลาด จะได้หลักฐานที่อ้างถึงรูปที่ไม่มีอยู่
         กลับกัน ถ้าอัปรูปสำเร็จแต่บันทึกพลาด ก็แค่มีรูปกำพร้าค้างในถัง ซึ่งไม่ทำใครเดือดร้อน */
      const uploaded: PodPhoto[] = []
      for (const shot of shots) {
        uploaded.push({
          path: await uploadPodPhoto(order.id, shot.img.blob, { ext: shot.img.ext, type: shot.img.type }),
          kind: shot.kind,
        })
      }
      setPhotos(uploaded)
      setStep('sign')
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /* หน้าสอง: ลายเซ็น → บันทึก POD ลงทุกใบของร้าน รูปอัปไปแล้วตั้งแต่หน้าแรก
     เหลือแต่การเขียนฐาน ซึ่งเป็นวินาทีเดียว ไม่ใช่นาทีที่ผู้รับต้องยืนถือมือถือรอ */
  const submitSignature = async (): Promise<void> => {
    if (!sig) {
      toast.push('warning', 'ให้ผู้รับเซ็นก่อน')
      return
    }
    if (!photos) {
      toast.push('warning', 'รูปยังไม่ได้อัปโหลด — กลับไปหน้ารูปแล้วกดบันทึกใหม่')
      setStep('photo')
      return
    }
    setSaving(true)
    try {
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

  /* ทับทั้งแผ่นตอนกำลังบันทึก — ปุ่มหมุน ๆ ปุ่มเดียวเล็กเกินกว่าที่คนซึ่งกำลัง
     ยืนกลางแดดจะเห็น แล้วเขาจะกดซ้ำ ซึ่งแปลว่าอัปรูปซ้ำทั้งกอง */
  const savingVeil = saving && (
    <div className="pod-veil" role="status" aria-live="polite">
      <span className="spin" aria-hidden="true">⟳</span>
      <b>{step === 'photo' ? 'กำลังอัปโหลดรูป' : 'กำลังบันทึกหลักฐาน'}</b>
      <span>อย่าเพิ่งปิดหน้านี้</span>
    </div>
  )

  /* ---- หน้าที่ 2: ลายเซ็น ----
     ยื่นมือถือให้ผู้รับตอนนี้ จอมีของอยู่อย่างเดียวคือช่องเซ็น ไม่มีปุ่มอื่นให้กดพลาด
     และไม่มีทางถอยกลับไปแก้รูป — รูปขึ้นถังไปแล้ว การให้ถอยคือให้อัปซ้ำ */
  if (step === 'sign') {
    return (
      <Modal
        open
        onClose={onClose}
        size="sheet"
        title={`ให้ผู้รับเซ็น — ${order.customer_name ?? order.destination}`}
        footer={
          <div className="pod-actions">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              ปิดไว้ก่อน
            </Button>
            <Button onClick={() => void submitSignature()} loading={saving} disabled={!sig}>
              {orders.length > 1 ? `บันทึก ${orders.length} ใบ` : 'บันทึกหลักฐาน'}
            </Button>
          </div>
        }
      >
        {savingVeil}
        <div className="pod-steps" aria-label="ขั้นตอนที่ 2 จาก 2">
          <span className="is-done">1 · รูป</span>
          <span className="is-now">2 · ลายเซ็น</span>
        </div>

        <div className="pod-meta">
          <span>อัปรูปแล้ว {photos?.length ?? 0} รูป</span>
          {orders.length > 1 && <span>ลายเซ็นเดียวใช้กับ {orders.length} ใบของร้านนี้</span>}
          <span>{coords ? `แนบพิกัดแล้ว · ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : 'ไม่ได้พิกัด — บันทึกได้ตามปกติ'}</span>
        </div>

        <div className="pod-section">
          <div className="pod-row-head">
            <h4>ลายเซ็นผู้รับ <span className="req">*</span></h4>
            <span className="text-xs text-muted">{name}</span>
          </div>
          {/* หน้านี้มีของอยู่อย่างเดียว จึงยกช่องเซ็นให้เต็มที่เท่าที่จอมี
              150px เตี้ยเกินกว่าจะเซ็นชื่อจริงด้วยนิ้ว — ลายเซ็นที่บีบจนไม่เหมือนของตัวเอง
              คือลายเซ็นที่คนเซ็นไม่ยอมรับตอนมีข้อโต้แย้ง
              min() ทำให้พอดีทั้งจอเตี้ยและจอสูง โดยไม่ดันปุ่มบันทึกตกจอ */}
          <SignaturePad onChange={setSig} height="min(52vh, 460px)" compact />
        </div>
      </Modal>
    )
  }

  /* ---- หน้าที่ 1: ชื่อผู้รับ + รูป ---- */
  return (
    <Modal
      open
      onClose={onClose}
      size="sheet"
      title={`ถ่ายรูปหน้างาน — ${order.customer_name ?? order.destination}`}
      footer={
        <div className="pod-actions">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            ปิดไว้ก่อน
          </Button>
          <Button
            onClick={() => void submitPhotos()}
            loading={saving}
            disabled={!name.trim() || shots.length === 0 || (missing.length > 0 && !relaxed)}
          >
            {missing.length > 0 && !relaxed ? `ยังขาด ${missing.length} มุม` : 'บันทึกรูป — ไปหน้าลายเซ็น'}
          </Button>
        </div>
      }
    >
      {savingVeil}
      <div className="pod-steps" aria-label="ขั้นตอนที่ 1 จาก 2">
        <span className="is-now">1 · รูป</span>
        <span>2 · ลายเซ็น</span>
      </div>

      <div className="pod-meta">
        {orders.length > 1 && <span>ปิดพร้อมกัน {orders.length} ใบของร้านนี้</span>}
        {/* พิกัดเคยอยู่ท้ายสุดของฟอร์ม ซึ่งคือที่ที่ไม่มีใครเลื่อนไปอ่าน
            ทั้งที่เป็นของที่แนบให้อยู่แล้วโดยไม่ต้องทำอะไร */}
        <span>{coords ? `แนบพิกัดแล้ว · ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : 'ไม่ได้พิกัด — บันทึกได้ตามปกติ'}</span>
      </div>

      {/* คำสั่งเดียวบนจอ ตัวใหญ่ อ่านจบในแวบเดียว — คนขับไม่ได้มาอ่านฟอร์ม
          เขามาถ่ายรูปสามใบแล้วไปต่อ บอกไปเลยว่าตอนนี้ต้องเล็งอะไร */}
      <div className={`pod-guide${missing.length === 0 ? ' is-done' : ''}`} role="status" aria-live="polite">
        {missing.length === 0 ? (
          <>
            <b>ครบทั้งสามมุมแล้ว</b>
            <span>ถ่ายเพิ่มได้ถ้าต้องการ หรือกดบันทึกไปหน้าลายเซ็น</span>
          </>
        ) : (
          <>
            <b>ขั้นที่ {stepNo} จาก {POD_STEPS.length} · ถ่าย{podKindLabel(kind)}</b>
            <span>{podStepHint(kind) || 'รูปเสริมของร้านนี้'}</span>
          </>
        )}
      </div>

      {/* มุมของรูปที่กำลังจะถ่าย — อยู่เหนือช่องมองภาพ เพราะเป็นสิ่งที่ตอบก่อนกดชัตเตอร์
          ปกติไม่ต้องแตะเลย ระบบเลื่อนให้เองหลังถ่ายแต่ละใบ มีไว้ให้ข้ามหรือย้อน
          เมื่อหน้างานไม่เดินตามลำดับ เช่นเจ้าของร้านยื่นใบให้เซ็นตั้งแต่ยังไม่ยกของลง */}
      <div className="pod-kinds" role="group" aria-label="มุมของรูปที่กำลังจะถ่าย">
        {POD_PHOTO_KINDS.map((k) => {
          const n = shots.filter((sh) => sh.kind === k.kind).length
          return (
            <button
              key={k.kind}
              type="button"
              className="pod-kind"
              aria-pressed={kind === k.kind}
              onClick={() => setKind(k.kind)}
              disabled={saving}
            >
              {k.label}
              {n > 0 && <b aria-label={`ถ่ายแล้ว ${n} รูป`}>{n}</b>}
            </button>
          )
        })}
      </div>

      {/* ช่องมองภาพเปิดเองตั้งแต่เข้าหน้า และไม่ปิดหลังถ่าย — จอนี้คือกล้อง
          ไม่ใช่ฟอร์มที่มีปุ่มเปิดกล้องอยู่ข้างใน */}
      <CameraCapture stage onCapture={capture} disabled={saving} stamp={stampLines} />

      {/* ฟิล์มรูปที่ถ่ายแล้ว เรียงแนวนอนใต้กล้อง เห็นทันทีว่าถ่ายอะไรไปบ้าง ลบได้ทีละใบ */}
      <div className="pod-strip">
        {shots.length === 0 ? (
          <p className="pod-strip-empty">ยังไม่มีรูป — ต้องถ่ายให้ครบสามมุมถึงจะไปหน้าลายเซ็นได้</p>
        ) : (
          shots.map((shot, i) => (
            <div className="pod-shot" key={shot.img.url}>
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
              <span className="pod-shot-kind">{podKindLabel(shot.kind)}</span>
            </div>
          ))
        )}
      </div>

      {/* ร้านที่ไม่มีป้ายชื่อ หรือไม่มีใบให้เซ็นสักใบ มีจริง — บังคับแบบไม่มีทางออก
          แปลว่าคนขับจะถ่ายพื้นถนนมาให้ครบจำนวนแทน ซึ่งแย่กว่าการรู้ว่าขาดมุมไหน
          กดแล้วบันทึกได้ทันที และมุมที่ขาดยังขาดอยู่ในฐานตามจริง */}
      {missing.length > 0 && shots.length > 0 && (
        relaxed ? (
          <p className="pod-relaxed">
            จะบันทึกโดยไม่มี{missing.map((k) => podKindLabel(k)).join(' และ ')}
            {' '}
            <button type="button" onClick={() => setRelaxed(false)}>ยกเลิก</button>
          </p>
        ) : (
          <button type="button" className="pod-relax" onClick={() => setRelaxed(true)} disabled={saving}>
            ถ่าย{missing.map((k) => podKindLabel(k)).join('/')}ไม่ได้ — บันทึกเท่าที่ถ่ายได้
          </button>
        )
      )}

      {/* ของที่พิมพ์ อยู่ใต้ของที่ถ่าย — ชื่อผู้รับเติมมาจากชื่อลูกค้าให้แล้ว
          ส่วนใหญ่ไม่ต้องแตะเลย จึงไม่ควรนั่งอยู่เหนือกล้องซึ่งเป็นงานจริงของหน้านี้ */}
      <div className="pod-section">
        <Field label="ชื่อผู้รับสินค้า" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>

      <div className="pod-section">
        {noteOpen || note ? (
          <Field label="หมายเหตุ">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ของครบ สภาพเรียบร้อย" />
          </Field>
        ) : (
          <button type="button" className="pod-note-toggle" onClick={() => setNoteOpen(true)}>
            + เพิ่มหมายเหตุ
          </button>
        )}
      </div>

      {/* ทางออกของคนที่เพิ่งกดปิดส่งผิดร้าน — ล่างสุด ไม่แย่งที่กับกล้อง
          แต่ยังอยู่ในหน้านี้ เพราะฟอร์มเด้งขึ้นเองทันทีหลังกดปิดส่ง คนที่กดผิด
          รู้ตัวตอนอ่านชื่อร้านบนหัวฟอร์ม ไม่ใช่ตอนกลับไปที่รายการ */}
      {onUndo && (
        <button type="button" className="pod-undo" onClick={onUndo} disabled={saving}>
          ไม่ใช่ร้านนี้ — ยกเลิกการส่ง
        </button>
      )}
    </Modal>
  )
}
