import { useEffect, useMemo, useState } from 'react'
import { Badge, Button } from '../ui'
import { StopItem } from './StopCard'
import { IconBuilding, IconTruck } from '../icons'
import { TRIP_STATUS_LABEL } from '../../utils/constants'
import { groupStops, jobTripNo, type StopGroup } from '../../utils/stops'
import type { MyJob, MyJobOrder } from '../../types'

/* ร้านที่กำลังทำอยู่ต้องรอดจากการกลับมาจากกล้อง แอปถูกระบบเด้งทิ้ง หรือกดโหลดใหม่
   sessionStorage พอ — ล็อกเป็นของ "รอบการใช้งานนี้" ไม่ใช่ของถาวรที่ต้องมาไล่ล้าง
   ทุก access ห่อ try ไว้ เพราะเบราว์เซอร์บางตัวโยน error ตอนปิดที่เก็บของเว็บ */
function lockSlot(jobId: number): string {
  return `driver:stoplock:${jobId}`
}
function readLock(jobId: number): string | null {
  try {
    return sessionStorage.getItem(lockSlot(jobId))
  } catch {
    return null
  }
}
function writeLock(jobId: number, key: string | null): void {
  try {
    if (key) sessionStorage.setItem(lockSlot(jobId), key)
    else sessionStorage.removeItem(lockSlot(jobId))
  } catch {
    /* ล็อกที่จำไม่ได้ ยังล็อกได้ในหน่วยความจำ ไม่ใช่เหตุให้จอพัง */
  }
}

/**
 * งานหนึ่งเที่ยว — รายการจุดส่งทั้งเที่ยวอยู่บนจอเสมอ จนกว่าจะเข้าร้าน
 *
 * ลำดับจริงไม่เดินตามเอกสาร คนขับแวะร้าน 2 ก่อนร้าน 1 ได้ทุกวัน โครงที่โชว์
 * "จุดปัจจุบัน" จุดเดียวแล้วซ่อนที่เหลือไว้ จึงบังคับให้กดเพิ่มทุกครั้งที่สลับจุด
 * ซึ่งเป็นเรื่องปกติ ไม่ใช่ข้อยกเว้น
 *
 * โครงนี้เป็นรายการล้วน: ทุกจุดเห็นพร้อมกัน จุดที่ทำอยู่กางอยู่กับที่ในลำดับของมัน
 * แตะจุดไหนก็กางจุดนั้นแทน ปุ่มของจุด (ปิดจุด/เก็บหลักฐาน) อยู่ในจุดนั้น
 * ล่างจอสงวนไว้ให้คำสั่งของทั้งเที่ยวเท่านั้น — รับงาน เริ่มเดินทาง ปิดงาน
 *
 * จนถึงตอนที่รถจอดหน้าร้าน — ตรงนั้นรายการกลายเป็นความเสี่ยง ไม่ใช่ความสะดวก
 * คนขับถือของอยู่เต็มมือ มองจอแวบเดียวแล้วกด ร้านข้างเคียงในรายการอยู่ห่างกัน
 * ไม่กี่มิลลิเมตร กดปิดผิดร้านจึงเกิดจริงและแก้ยากเมื่อมีลายเซ็นไปแล้ว
 *
 * ทางแก้: กด "ถึงร้านนี้แล้ว" เพื่อ *เข้า* ร้าน จอเหลือร้านเดียวจนกว่าร้านนั้น
 * จะปิดจุดและเก็บหลักฐานครบ แล้วจึงปลดเองกลับไปเป็นรายการ ระหว่างนั้นปุ่มปิดจุด
 * มีอยู่ปุ่มเดียวบนจอทั้งจอ และเป็นของร้านที่คนขับยืนอยู่หน้าร้านแน่ ๆ
 * ออกก่อนกำหนดได้ (ของไม่ครบ ร้านปิด) แต่ต้องกดสองครั้ง ไม่ใช่ปัดผ่าน
 *
 * หนึ่งจุด = หนึ่งร้าน ใบเบิกหลายใบของร้านเดียวถูกยุบเข้าด้วยกัน (ดู utils/stops)
 */
export function JobFocus({
  job,
  busy,
  deliveringKey,
  canProgress,
  canPod,
  unfinishedOthers = 0,
  returningCount = 1,
  podMissing = 0,
  onAct,
  onReportIssue,
  onPod,
  onViewPod,
  onDeliver,
  onUndoDeliver,
  onReorder,
}: {
  job: MyJob
  busy: boolean
  /** คีย์ของร้านที่กำลังส่งคำสั่งปิดจุดอยู่ ('' = ไม่มี) */
  deliveringKey: string
  canProgress: boolean
  canPod: boolean
  /** จำนวนเที่ยวอื่นของคนขับคนนี้ที่ยังไม่จบ — รถกลับคลังได้ครั้งเดียวต่อวัน
   *  ปุ่มจบงานจึงขึ้นได้ก็ต่อเมื่อไม่มีเที่ยวอื่นค้างอยู่แล้ว */
  unfinishedOthers?: number
  /** เที่ยวที่รออยู่บนขากลับคันเดียวกัน รวมเที่ยวนี้ด้วย — ปุ่มปิดทั้งชุดในครั้งเดียว */
  returningCount?: number
  /** ร้านที่ปิดส่งแล้วแต่ยังไม่มีหลักฐาน นับรวมทุกเที่ยวที่กำลังจะถูกปิดพร้อมกัน */
  podMissing?: number
  onAct: (job: MyJob, action: 'start' | 'complete' | 'accept' | 'finish') => void
  /** เปิดฟอร์มแจ้งปัญหา — แจ้งได้ ไม่ใช่ปฏิเสธงาน งานยังเป็นของคนขับ
   *  ไม่ส่งมา = สแตกที่ไม่มีประตูรับงาน (ฝั่ง LAN) ปุ่มรับงานจะไม่ขึ้นเลย */
  onReportIssue?: (job: MyJob) => void
  onPod: (stop: StopGroup) => void
  /* เปิดดูหลักฐานของใบที่เก็บไปแล้ว — ส่งต่อลงไปที่จุดส่งแต่ละจุด */
  onViewPod?: (order: MyJobOrder) => void
  onDeliver: (stop: StopGroup) => void
  onUndoDeliver?: (stop: StopGroup) => void
  /* จัดลำดับร้านใหม่ทั้งเที่ยว — คนขับรู้เส้นทางจริงดีกว่าลำดับที่เอกสารให้มา
     ไม่ส่งมา = สแตกที่ยังไม่มีการจัดลำดับ (ฝั่ง LAN) ปุ่มขึ้น/ลงจะไม่ขึ้น */
  onReorder?: (job: MyJob, orderIds: number[]) => void
}): React.JSX.Element {
  const stops = useMemo(() => groupStops(job.orders), [job.orders])
  const firstPending = stops.find((s) => !s.done && !s.cancelled)
  const [openKey, setOpenKey] = useState<string | null>(firstPending?.key ?? stops[0]?.key ?? null)
  /* ร้านที่คนขับ "เข้าไปทำ" อยู่ตอนนี้ — ระหว่างล็อก จอเหลือร้านเดียว
     กลับมาจากกล้อง/แผนที่/แอปปิดเอง ต้องอยู่ที่ร้านเดิม จึงจำไว้ที่ sessionStorage */
  const [lockedKey, setLockedKey] = useState<string | null>(() => readLock(job.id))
  /* ปุ่มเปลี่ยนร้านต้องกดสองครั้ง — ครั้งเดียวก็คือปุ่มออกที่กดพลาดได้เหมือนเดิม */
  const [confirmSwitch, setConfirmSwitch] = useState(false)

  // สลับเที่ยวแล้วต้องกลับไปกางจุดถัดไปของเที่ยวใหม่ ไม่ใช่ค้างที่จุดของเที่ยวเก่า
  useEffect(() => {
    const list = groupStops(job.orders)
    setOpenKey(list.find((s) => !s.done && !s.cancelled)?.key ?? list[0]?.key ?? null)
    setLockedKey(readLock(job.id))
    setConfirmSwitch(false)
  }, [job.id])

  useEffect(() => {
    writeLock(job.id, lockedKey)
  }, [job.id, lockedKey])

  /* ปิดจุดที่กางอยู่แล้ว ให้เด้งไปกางจุดถัดไปเอง — จังหวะที่คนขับต้องการต่อคือจุดต่อไป
     ไม่ใช่นั่งดูจุดที่เพิ่งปิด (ยกเว้นยังไม่ได้เก็บหลักฐาน ซึ่งปุ่มยังอยู่ในจุดนั้น)
     ระหว่างล็อกไม่เด้ง — จอต้องนิ่งอยู่ที่ร้านเดิมจนกว่าร้านนั้นจะจบจริง */
  useEffect(() => {
    if (lockedKey) return
    const open = stops.find((s) => s.key === openKey)
    if (open && open.done && open.needPod.length === 0 && firstPending) setOpenKey(firstPending.key)
  }, [stops, openKey, lockedKey])

  /* ร้านที่ล็อกไว้จบแล้ว (ปิดจุด + เก็บหลักฐานครบ) หรือหายไปจากเที่ยว → ปลดเอง
     แล้วพาไปกางร้านถัดไป คนขับไม่ต้องกดออกจากโหมดล็อกด้วยตัวเอง */
  const lockedStop = lockedKey ? stops.find((s) => s.key === lockedKey) : undefined
  useEffect(() => {
    if (!lockedKey) return
    const done = !lockedStop || lockedStop.cancelled || (lockedStop.done && lockedStop.needPod.length === 0)
    if (!done) return
    setLockedKey(null)
    setConfirmSwitch(false)
    setOpenKey(stops.find((s) => !s.done && !s.cancelled)?.key ?? lockedKey)
  }, [stops, lockedKey, lockedStop])

  const delivered = stops.filter((s) => s.done).length
  const active = job.status !== 'completed' && job.status !== 'cancelled'
  /* ประตูเป็นของ "ฉัน" ไม่ใช่ของเที่ยว — คนขับหลักกดรับไปแล้วไม่ได้แปลว่าผู้ช่วยรับแล้ว
     my_accepted_at เป็น undefined บนสแตก LAN ที่ยังไม่มีคอลัมน์นี้ ถอยไปใช้ของเดิม */
  const mineAccepted = job.my_accepted_at ?? job.accepted_at
  const waiting = active && !mineAccepted && onReportIssue !== undefined
  /* ปิดเที่ยวได้เฉพาะคนขับหลัก — ผู้ช่วยยังปิดจุดส่งและเก็บ POD ได้ตามปกติ
     ฐานปฏิเสธอยู่แล้ว ตรงนี้คือไม่แสดงปุ่มที่กดแล้วขึ้น error เป็นอย่างเดียว */
  const canClose = job.is_primary !== false
  /* จัดลำดับได้เฉพาะงานที่รับแล้วและยังไม่จบ — ลำดับของงานที่จบไปแล้วคือประวัติ
     และเฉพาะตอนไม่ได้อยู่ในร้าน: เห็นร้านเดียวแล้วสลับลำดับไม่มีความหมาย */
  const canReorder = onReorder !== undefined && canProgress && active && !waiting && !lockedKey
  /* จุดส่งเปิดทำงานได้ต่อเมื่อรับงานแล้วและออกรถแล้ว — ก่อนหน้านั้นดูได้อย่างเดียว
     ไม่งั้นคนขับกดปิดจุดได้ทั้งที่ยังไม่ได้ออกจากคลัง */
  const stopsLive = canProgress && active && !waiting && job.status !== 'planned'
  const crew = job.driver_count ?? 1

  /* เที่ยวถูกดึงกลับไปเป็นสถานะที่กดอะไรไม่ได้ (ถูกยกเลิก ปิดไปแล้ว ถอนรับงาน)
     ล็อกที่ค้างอยู่ต้องหลุด ไม่งั้นคนขับเห็นร้านเดียวและไม่มีทางกลับไปที่รายการ */
  useEffect(() => {
    if (!stopsLive && lockedKey) {
      setLockedKey(null)
      setConfirmSwitch(false)
    }
  }, [stopsLive, lockedKey])

  /* สลับตำแหน่งทั้งร้าน ไม่ใช่ทีละใบ — ใบของร้านเดียวกันต้องติดกันเสมอ
     ไม่งั้นลำดับที่บันทึกกลับไปจะแยกร้านออกจากกันอีกรอบ */
  const move = (stop: StopGroup, dir: -1 | 1): void => {
    const at = stops.indexOf(stop)
    const to = at + dir
    if (at < 0 || to < 0 || to >= stops.length) return
    const next = [...stops]
    const a = next[at] as StopGroup
    const b = next[to] as StopGroup
    next[at] = b
    next[to] = a
    onReorder?.(job, next.flatMap((s) => s.orders.map((o) => o.id)))
  }

  /* ล่างจอเป็นคำสั่งของ "ทั้งเที่ยว" เท่านั้น ปุ่มของจุดอยู่ในจุด
     แยกกันชัดแบบนี้แล้วไม่มีทางกดปิดงานทั้งเที่ยวตอนตั้งใจจะปิดร้านเดียว */
  const cta = ((): React.JSX.Element | null => {
    if (!canProgress || !active) return null
    if (waiting) {
      return (
        /* ไม่มีปุ่มปฏิเสธ — TMS จ่ายคนมาแล้วและเราเขียนกลับไม่ได้
           มีปัญหาให้กดแจ้ง ซึ่งไปขึ้นบนกระดานของคนวางแผน ไม่ใช่คืนงานเงียบ ๆ */
        <>
          <Button size="lg" loading={busy} onClick={() => onAct(job, 'accept')}>
            รับงานนี้
          </Button>
          <Button size="lg" variant="ghost" onClick={() => onReportIssue?.(job)}>
            แจ้งปัญหา
          </Button>
        </>
      )
    }
    /* ส่งครบแล้วแต่รถยังอยู่ข้างนอก — ปุ่มสุดท้ายคือยืนยันว่ากลับถึงคลังจริง
       ระหว่างนี้ตำแหน่งยังถูกบันทึกอยู่ และรถยังไม่ถูกนับว่าว่าง */
    if (job.status === 'returning') {
      if (!canClose) return <p className="job-cta-hint">กำลังกลับคลัง — รอคนขับหลักกดจบงาน</p>
      /* รถกลับเข้าคลังครั้งเดียว ไม่ใช่ครั้งละเที่ยว คนขับที่ถือสามเที่ยวแล้วเห็นปุ่มนี้
         ตั้งแต่เที่ยวแรกจบ จะกดตอนยังวิ่งเที่ยวที่สองอยู่ แล้วรถถูกนับว่าว่างทั้งที่
         ยังอยู่บนถนน คนวางแผนก็จ่ายงานใหม่ทับ */
      if (unfinishedOthers > 0) {
        return (
          <p className="job-cta-hint">
            ส่งครบเที่ยวนี้แล้ว — ยังเหลืออีก {unfinishedOthers} เที่ยวที่ยังไม่จบ
            ปุ่มจบงานจะขึ้นเมื่อปิดครบทุกเที่ยว
          </p>
        )
      }
      /* จบงานคือประตูสุดท้ายที่หลักฐานจะถูกทวงได้ หลังจากนี้เที่ยวไปอยู่ในประวัติ
         และคนที่ต้องตามเก็บคือออฟฟิศ ซึ่งตามจากโต๊ะไม่ได้ */
      if (podMissing > 0) {
        return (
          <p className="job-cta-hint">
            ยังขาดหลักฐาน {podMissing} ร้าน — เก็บให้ครบก่อนจบงาน
          </p>
        )
      }
      return (
        <Button size="lg" variant="success" loading={busy} onClick={() => onAct(job, 'finish')}>
          {returningCount > 1
            ? `กลับถึงคลังแล้ว — จบงานทั้ง ${returningCount} เที่ยว`
            : 'กลับถึงคลังแล้ว — จบงาน'}
        </Button>
      )
    }
    if (job.status === 'planned') {
      return (
        <Button size="lg" loading={busy} onClick={() => onAct(job, 'start')}>
          เริ่มเดินทาง
        </Button>
      )
    }
    if (firstPending) {
      /* ยังส่งไม่ครบ ห้ามปิดเที่ยว — ถ้าปิดตอนนี้ จุดที่เหลือจะถูกเหมาเป็น "ส่งแล้ว"
         ทั้งที่ยังไม่ได้ไป แล้ว POD ของร้านเหล่านั้นก็ไม่มีใครเก็บ
         บอกจำนวนที่เหลือแทนปุ่มที่กดไม่ได้ เพราะคำถามคือ "อีกกี่ร้าน" */
      return <p className="job-cta-hint">เหลืออีก {stops.length - delivered} จุด — ปิดงานได้เมื่อส่งครบ</p>
    }
    if (canClose) {
      return (
        <Button size="lg" variant="success" loading={busy} onClick={() => onAct(job, 'complete')}>
          ส่งครบแล้ว — ปิดงานที่หน้าร้าน
        </Button>
      )
    }
    /* ผู้ช่วยส่งครบแล้วต้องรู้ว่าไม่มีอะไรให้เขากดต่อ ไม่ใช่เห็นปุ่มเทาแล้วเดาเอง */
    return <p className="job-cta-hint">ส่งครบแล้ว — รอคนขับหลักปิดงาน</p>
  })()

  return (
    <article className={`job-focus status-${job.status}`}>
      {/* บอร์ด Design C วางเลขเที่ยว แถบคืบหน้า และ chip ไว้ในกล่องเขียวใบเดียว
          ก่อนหน้านี้สามชิ้นนี้เป็นพี่น้องกัน กล่องเขียวจึงจบก่อนแล้วแถบคืบหน้า
          ไปนั่งบนพื้นขาว กว้างกว่ากล่องด้วย — ห่อรวมเป็นกล่องเดียวตามบอร์ด
          ตัวห่อไม่มีตรรกะ แค่ขอบเขตของภาพ */}
      <div className="job-hero">
      {/* บรรทัดเดียวจบ: เที่ยวไหน รถคันไหน สถานะอะไร */}
      <header className="job-bar">
        <span className="job-bar-no">{jobTripNo(job)}</span>
        <span className="job-bar-meta">
          <IconTruck size={13} /> {job.vehicle_plate}
        </span>
        {/* คลังที่ต้องไปโหลดของ — บริษัทมีหลายคลังในเมืองเดียวกัน ไปผิดคลัง
            คือเสียครึ่งเช้า ก่อนหน้านี้รหัสนี้อยู่แต่ในข้อความหมายเหตุของเที่ยว
            ซึ่งคนขับต้องอ่านเองแล้วเดาว่าท่อนไหนคือคลัง */}
        {job.warehouse_code && (
          <span className="job-bar-meta">
            <IconBuilding size={13} /> {job.warehouse_code}
          </span>
        )}
        <Badge label={TRIP_STATUS_LABEL[job.status]} tone={job.status} dot />
      </header>

      {/* แถบคืบหน้าเส้นเดียว — นับเป็น "ร้าน" ไม่ใช่ "ใบ" เพราะสิ่งที่คนขับทำคือแวะร้าน */}
      <div className="job-meter">
        <div className="job-meter-track">
          <div
            className="job-meter-fill"
            style={{ width: `${stops.length ? (delivered / stops.length) * 100 : 0}%` }}
          />
        </div>
        <span className="job-meter-text">
          ส่งแล้ว {delivered}/{stops.length} ร้าน
        </span>
      </div>

      {/* iOS2: chip ตำแหน่งในเที่ยว — ✓ เสร็จ / ▶ กำลังแวะ / เลข = รอคิว
          มอง hero แวบเดียวรู้ว่าเที่ยวเดินไปถึงไหน ไม่ต้องไล่นับการ์ด */}
      {stops.length > 0 && (
        <div className="job-chips" aria-label={`ลำดับจุดส่ง ${stops.length} ร้าน`}>
          {stops.map((s, i) => (
            <span key={s.key} className={`job-chip${s.key === firstPending?.key ? ' is-now' : ''}`}>
              {s.done ? '✓' : s.key === firstPending?.key ? '▶' : i + 1}
              {' '}{(s.customer_name ?? s.destination ?? '').replace(/^ร้าน/, '').slice(0, 10)}
            </span>
          ))}
        </div>
      )}
      </div>

      {waiting && <p className="job-alert">งานใหม่ — กดรับงานก่อนถึงจะเริ่มเดินทางได้</p>}
      {!waiting && job.status === 'planned' && (
        <p className="job-alert">กด "เริ่มเดินทาง" เมื่อออกจากคลัง แล้วจึงปิดจุดส่งได้</p>
      )}
      {job.issue_note && <p className="job-alert is-warn">แจ้งปัญหาไว้: {job.issue_note}</p>}

      {/* อยู่ในร้าน — บอกให้ชัดว่าทำไมร้านอื่นหายไปจากจอ ไม่ใช่ปล่อยให้คิดว่าแอปเจ๊ง
          และทางออกอยู่ตรงนี้ที่เดียว กดสองครั้ง */}
      {lockedStop && (
        <div className="stop-lock-bar">
          <span className="stop-lock-text">
            <strong>กำลังส่งที่ {lockedStop.customer_name ?? lockedStop.destination}</strong>
            <span>ร้านอื่นถูกซ่อนไว้จนกว่าร้านนี้จะเสร็จ</span>
          </span>
          <Button
            variant="outline"
            className={`stop-lock-exit${confirmSwitch ? ' is-armed' : ''}`}
            onClick={() => {
              if (!confirmSwitch) {
                setConfirmSwitch(true)
                return
              }
              setLockedKey(null)
              setConfirmSwitch(false)
            }}
          >
            {confirmSwitch ? 'แตะอีกครั้งเพื่อออก' : 'เปลี่ยนร้าน'}
          </Button>
        </div>
      )}

      {stops.length === 0 ? (
        <p className="job-sub">เที่ยวนี้ยังไม่มีจุดส่ง</p>
      ) : (
        <ol className="stop-list" aria-label={lockedStop ? 'ร้านที่กำลังส่ง' : 'จุดส่งในเที่ยวนี้'}>
          {stops.map((s, i) =>
            /* ระหว่างล็อก ร้านอื่นไม่ได้แค่ถูกย่อ แต่ไม่อยู่บนจอเลย — ปุ่มปิดจุดที่กดผิดได้
               ต้องไม่มีอยู่ให้กด การซ่อนแค่ทางสายตายังโดนนิ้วโป้งอยู่ดี */
            lockedKey && s.key !== lockedKey ? null : (
              <StopItem
                key={s.key}
                stop={s}
                index={i + 1}
                open={lockedKey ? true : s.key === openKey}
                busy={deliveringKey === s.key}
                canProgress={stopsLive}
                canPod={canPod}
                locked={lockedKey === s.key}
                onOpen={() => {
                  if (lockedKey) return
                  setOpenKey(s.key === openKey ? null : s.key)
                }}
                onEnter={
                  stopsLive && !lockedKey
                    ? () => {
                        setLockedKey(s.key)
                        setOpenKey(s.key)
                        setConfirmSwitch(false)
                      }
                    : undefined
                }
                onPod={onPod}
                onViewPod={onViewPod}
                onDeliver={onDeliver}
                /* ถอนการส่ง = ยอมรับว่าไม่ได้อยู่ที่ร้านนี้ ปล่อยล็อกทันที
                   ไม่งั้นคนขับที่เพิ่งถอยยังติดอยู่ในร้านที่เขาบอกเองว่ากดผิด */
                onUndoDeliver={
                  onUndoDeliver
                    ? (target) => {
                        setLockedKey(null)
                        setConfirmSwitch(false)
                        onUndoDeliver(target)
                      }
                    : undefined
                }
                onMove={canReorder ? move : undefined}
                canMoveUp={i > 0}
                canMoveDown={i < stops.length - 1}
              />
            ),
          )}
        </ol>
      )}

      <div className="job-secondary">
        {crew > 1 && (
          <span className="job-crew">
            ไปด้วยกัน {crew} คน · รับแล้ว {job.accepted_count}/{crew}
            {job.is_primary === false && ' · คุณเป็นผู้ช่วย'}
          </span>
        )}
        {!waiting && onReportIssue && (
          <Button variant="ghost" size="sm" onClick={() => onReportIssue(job)}>
            แจ้งปัญหา
          </Button>
        )}
      </div>

      {/* ตรึงล่างจอ — คำสั่งระดับเที่ยวต้องอยู่ในระยะนิ้วโป้งเสมอ ไม่ต้องเลื่อนหา */}
      {cta && <div className="job-cta-bar">{cta}</div>}
    </article>
  )
}
