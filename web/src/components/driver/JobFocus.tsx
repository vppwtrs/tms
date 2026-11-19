import { useEffect, useMemo, useState } from 'react'
import { Button } from '../ui'
import { StopItem } from './StopCard'
import { IconAlert, IconCheck, IconChevronLeft } from '../icons'
import { fmtTime } from '../../utils/format'
import { groupStops, jobTripNo, type StopGroup } from '../../utils/stops'
import type { MyJob, MyJobOrder } from '../../types'
import { logCheckpoint } from '../../utils/checkpoints'
import BreakFlow from './BreakFlow'
import '../../styles/driver-trip.css'

/** ระยะเกินนี้ (เมตร) ตอนกด "ถึงร้าน" ขึ้นจอถามยืนยัน (mockup 18) */
const FAR_M = 300

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const rad = (d: number): number => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** อ่านพิกัดครั้งเดียว (ไม่ติดตาม) — ไม่ได้ = null */
function hereOnce(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    )
  })
}

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
 * งานหนึ่งเที่ยว — ดีไซน์ "งานตอนนี้" (mockup Driver App Redesign จอ 2)
 *
 * จอเดียวจบ ไม่ต้องเลื่อน: หัวเที่ยวบาง ๆ + แถบคืบหน้าแบ่งช่องละร้าน
 * แล้วการ์ดใหญ่ใบเดียวของร้านที่ต้องไปตอนนี้ ร้านอื่นยุบเป็นแถวบาง (ร้านที่ยังไม่ไปอยู่บน
 * ร้านที่จบแล้วอยู่ล่าง) แตะแถวไหนก็สลับให้ร้านนั้นเป็นการ์ดใหญ่ — ลำดับจริงไม่เดินตามเอกสาร
 *
 * กติกาเดิมทั้งหมดยังอยู่:
 * - "ถึงร้านแล้ว" = เข้าร้าน (ล็อกจอไว้ที่ร้านเดียว) ปุ่มปิดจุดขึ้นเฉพาะตอนล็อกอยู่
 *   ออกจากร้านต้องกดสองครั้ง ร้านจบ (ส่ง + หลักฐานครบ / ยกเลิก) แล้วปลดเอง
 * - แถบล่าง (job-cta-bar) สงวนไว้ให้คำสั่งระดับเที่ยวเท่านั้น — รับงาน เริ่มเดินทาง ปิดงาน ถึงคลัง
 * - จัดลำดับ ถอยการส่ง ถอนยกเลิก ดูหลักฐาน อยู่ในแผ่น "รายละเอียดเที่ยว" (แตะเลขเที่ยว)
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
  onCancelStop,
  onUndoCancelStop,
  onReorder,
  onBack,
  backLabel = 'เที่ยวทั้งหมด',
  trackNote,
}: {
  job: MyJob
  /** ปุ่มย้อนกลับมุมซ้ายบนของหัวจอ */
  onBack?: () => void
  backLabel?: string
  /** สถานะบันทึกเส้นทาง — ไม่ส่งมา = ยังไม่รับงาน ไม่ต้องบอก */
  trackNote?: { on: boolean; text: string }
  busy: boolean
  /** คีย์ของร้านที่กำลังส่งคำสั่งปิดจุดอยู่ ('' = ไม่มี) */
  deliveringKey: string
  canProgress: boolean
  canPod: boolean
  /** จำนวนเที่ยวอื่นของคนขับคนนี้ที่ยังไม่จบ — รถกลับคลังได้ครั้งเดียวต่อวัน */
  unfinishedOthers?: number
  /** เที่ยวที่รออยู่บนขากลับคันเดียวกัน รวมเที่ยวนี้ด้วย — ปุ่มปิดทั้งชุดในครั้งเดียว */
  returningCount?: number
  /** ร้านที่ปิดส่งแล้วแต่ยังไม่มีหลักฐาน นับรวมทุกเที่ยวที่กำลังจะถูกปิดพร้อมกัน */
  podMissing?: number
  onAct: (job: MyJob, action: 'start' | 'complete' | 'accept' | 'finish') => void
  /** เปิดฟอร์มแจ้งปัญหา — ไม่ส่งมา = สแตกที่ไม่มีประตูรับงาน ปุ่มรับงานจะไม่ขึ้นเลย */
  onReportIssue?: (job: MyJob) => void
  onPod: (stop: StopGroup) => void
  onViewPod?: (order: MyJobOrder) => void
  onDeliver: (stop: StopGroup) => void
  onUndoDeliver?: (stop: StopGroup) => void
  onCancelStop?: (stop: StopGroup) => void
  onUndoCancelStop?: (stop: StopGroup) => void
  onReorder?: (job: MyJob, orderIds: number[]) => void
}): React.JSX.Element {
  const stops = useMemo(() => groupStops(job.orders), [job.orders])
  const firstPending = stops.find((s) => !s.done && !s.cancelled)
  const [openKey, setOpenKey] = useState<string | null>(firstPending?.key ?? stops[0]?.key ?? null)
  const [lockedKey, setLockedKey] = useState<string | null>(() => readLock(job.id))
  const [confirmSwitch, setConfirmSwitch] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [showStops, setShowStops] = useState(false)
  const [gpsSheet, setGpsSheet] = useState(false)
  const [gpsDenied, setGpsDenied] = useState(false)
  const [breakOpen, setBreakOpen] = useState(false)
  const [gpsHelpClosed, setGpsHelpClosed] = useState(false)
  const [far, setFar] = useState<{ stop: StopGroup; m: number } | null>(null)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  useEffect(() => {
    const up = (): void => setOnline(true)
    const down = (): void => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  /* สิทธิ์ตำแหน่งถูกปิด → จอ 12 บอกวิธีเปิด (ไม่บล็อกงาน) */
  useEffect(() => {
    let alive = true
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined
    if (!perms?.query) return
    perms.query({ name: 'geolocation' as PermissionName }).then((st) => {
      if (!alive) return
      setGpsDenied(st.state === 'denied')
      st.onchange = () => setGpsDenied(st.state === 'denied')
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  /* GPS แบบจุดเช็คอิน — บันทึกเฉพาะตอนกดปุ่ม ไม่ติดตามตลอด */
  const checkpoint = (kind: Parameters<typeof logCheckpoint>[1], extra?: Record<string, unknown>): void => {
    void Promise.resolve(logCheckpoint(String(job.id), kind, extra)).catch(() => {})
  }
  const act = (action: 'start' | 'complete' | 'accept' | 'finish'): void => {
    if (action === 'start') checkpoint('trip_start')
    if (action === 'finish' || action === 'complete') checkpoint('trip_end')
    onAct(job, action)
  }
  const deliver = (s: StopGroup): void => {
    checkpoint('delivered', { stop: s.key })
    onDeliver(s)
  }

  // สลับเที่ยวแล้วต้องกลับไปที่จุดถัดไปของเที่ยวใหม่ ไม่ใช่ค้างที่จุดของเที่ยวเก่า
  useEffect(() => {
    const list = groupStops(job.orders)
    setOpenKey(list.find((s) => !s.done && !s.cancelled)?.key ?? list[0]?.key ?? null)
    setLockedKey(readLock(job.id))
    setConfirmSwitch(false)
    setShowStops(false)
    setDetailOpen(false)
  }, [job.id])

  useEffect(() => {
    writeLock(job.id, lockedKey)
  }, [job.id, lockedKey])

  /* จุดที่เปิดอยู่จบแล้ว (และไม่ต้องเก็บหลักฐาน) → เด้งไปจุดถัดไปเอง ระหว่างล็อกไม่เด้ง */
  useEffect(() => {
    if (lockedKey) return
    const open = stops.find((s) => s.key === openKey)
    if (open && open.done && open.needPod.length === 0 && firstPending) setOpenKey(firstPending.key)
  }, [stops, openKey, lockedKey])

  /* ร้านที่ล็อกไว้จบแล้วหรือหายไปจากเที่ยว → ปลดเองแล้วพาไปร้านถัดไป */
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
  /* ร้านที่ยกเลิกนับว่าจบแล้ว ไม่งั้นจอขึ้น "ส่งแล้ว 1/2" พร้อมปุ่มปิดงาน ซึ่งขัดกันเอง */
  const cancelledStops = stops.filter((s) => s.cancelled).length
  const settled = delivered + cancelledStops
  const active = job.status !== 'completed' && job.status !== 'cancelled'
  /* ประตูเป็นของ "ฉัน" ไม่ใช่ของเที่ยว — คนขับหลักรับแล้วไม่ได้แปลว่าผู้ช่วยรับแล้ว */
  const mineAccepted = job.my_accepted_at ?? job.accepted_at
  const waiting = active && !mineAccepted && onReportIssue !== undefined
  /* ปิดเที่ยวได้เฉพาะคนขับหลัก — ผู้ช่วยยังปิดจุดส่งและเก็บ POD ได้ตามปกติ */
  const canClose = job.is_primary !== false
  const canReorder = onReorder !== undefined && canProgress && active && !waiting && !lockedKey
  /* จุดส่งเปิดทำงานได้ต่อเมื่อรับงานแล้วและออกรถแล้ว */
  const stopsLive = canProgress && active && !waiting && job.status !== 'planned'
  const crew = job.driver_count ?? 1

  /* เที่ยวถูกดึงกลับไปเป็นสถานะที่กดอะไรไม่ได้ ล็อกที่ค้างอยู่ต้องหลุด */
  useEffect(() => {
    if (!stopsLive && lockedKey) {
      setLockedKey(null)
      setConfirmSwitch(false)
    }
  }, [stopsLive, lockedKey])

  /* สลับตำแหน่งทั้งร้าน ไม่ใช่ทีละใบ — ใบของร้านเดียวกันต้องติดกันเสมอ */
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

  /* แถบล่าง = คำสั่งของ "ทั้งเที่ยว" เท่านั้น ปุ่มของจุดอยู่ในการ์ดร้าน */
  const cta = ((): React.JSX.Element | null => {
    if (!canProgress || !active) return null
    if (waiting) {
      /* ไม่มีปุ่มปฏิเสธ — TMS จ่ายคนมาแล้ว มีปัญหาให้กดแจ้ง */
      return (
        <>
          <Button size="lg" loading={busy} onClick={() => setGpsSheet(true)}>
            รับงานนี้
          </Button>
          <Button size="lg" variant="ghost" onClick={() => onReportIssue?.(job)}>
            แจ้งปัญหา
          </Button>
        </>
      )
    }
    if (job.status === 'returning') {
      if (!canClose) return <p className="job-cta-hint">กำลังกลับคลัง — รอคนขับหลักกดจบงาน</p>
      /* รถกลับเข้าคลังครั้งเดียว ไม่ใช่ครั้งละเที่ยว */
      if (unfinishedOthers > 0) {
        return (
          <p className="job-cta-hint">
            ส่งครบเที่ยวนี้แล้ว — ยังเหลืออีก {unfinishedOthers} เที่ยวที่ยังไม่จบ
            ปุ่มจบงานจะขึ้นเมื่อปิดครบทุกเที่ยว
          </p>
        )
      }
      /* หลักฐานขาด ปุ่มยังกดได้ — หน้าแม่ขึ้นแผ่น "ยังปิดงานไม่ได้" บอกร้านพร้อมปุ่มไปเติม */
      return (
        <Button size="lg" loading={busy} onClick={() => act('finish')}>
          {podMissing > 0 ? `ถึงคลังแล้ว · ขาดหลักฐาน ${podMissing} ร้าน` : 'ถึงคลังแล้ว'}
        </Button>
      )
    }
    if (job.status === 'planned') {
      return (
        <Button size="lg" loading={busy} onClick={() => act('start')}>
          เริ่มเดินทาง
        </Button>
      )
    }
    if (firstPending) {
      /* ยังส่งไม่ครบ ห้ามปิดเที่ยว — บอกจำนวนที่เหลือแทนปุ่มที่กดไม่ได้ */
      return <p className="job-cta-hint">เหลืออีก {stops.length - settled} จุด — ปิดงานได้เมื่อส่งครบ</p>
    }
    if (canClose) {
      return (
        <Button size="lg" loading={busy} onClick={() => act('complete')}>
          ส่งครบแล้ว — ปิดงานที่หน้าร้าน
        </Button>
      )
    }
    return <p className="job-cta-hint">ส่งครบแล้ว — รอคนขับหลักปิดงาน</p>
  })()

  /* ร้านที่เป็นการ์ดใหญ่ — ระหว่างล็อกคือร้านที่ล็อก ไม่งั้นคือร้านที่แตะเลือก / ร้านถัดไป */
  const focusKey = lockedKey ?? openKey
  const focus = stops.find((s) => s.key === focusKey) ?? firstPending ?? stops[0]
  const rest = lockedKey ? [] : [
    ...stops.filter((s) => s !== focus && !s.done && !s.cancelled),
    ...stops.filter((s) => s !== focus && (s.done || s.cancelled)),
  ]

  /* ถึงร้าน = เช็คอินหนึ่งครั้ง ห่างร้านเกินไปถามก่อน (จอ 18) */
  const enter = (s: StopGroup, extra?: Record<string, unknown>): void => {
    checkpoint('arrive', { stop: s.key, ...extra })
    setLockedKey(s.key)
    setOpenKey(s.key)
    setConfirmSwitch(false)
  }
  const arrive = async (s: StopGroup): Promise<void> => {
    if (s.customer_lat != null && s.customer_lng != null) {
      const here = await hereOnce()
      if (here) {
        const m = distanceM(here, { lat: s.customer_lat, lng: s.customer_lng })
        if (m > FAR_M) { setFar({ stop: s, m: Math.round(m) }); return }
      }
    }
    enter(s)
  }

  const stopItem = (s: StopGroup, open: boolean): React.JSX.Element => {
    const i = stops.indexOf(s)
    return (
      <StopItem
        key={s.key}
        stop={s}
        index={i + 1}
        open={open}
        isNext={s.key === firstPending?.key}
        busy={deliveringKey === s.key}
        canProgress={stopsLive}
        canPod={canPod}
        locked={lockedKey === s.key}
        switchArmed={confirmSwitch}
        onExitLock={
          lockedKey === s.key
            ? () => {
                if (!confirmSwitch) {
                  setConfirmSwitch(true)
                  return
                }
                setLockedKey(null)
                setConfirmSwitch(false)
              }
            : undefined
        }
        onOpen={() => {
          if (lockedKey) return
          setOpenKey(s.key)
        }}
        onEnter={
          stopsLive && !lockedKey
            ? () => {
                void arrive(s)
              }
            : undefined
        }
        onPod={onPod}
        onViewPod={onViewPod}
        onDeliver={deliver}
        onCancelStop={
          onCancelStop
            ? (target) => {
                setLockedKey(null)
                setConfirmSwitch(false)
                onCancelStop(target)
              }
            : undefined
        }
      />
    )
  }

  const helper = job.is_primary === false
  const nowSeg = lockedKey ?? firstPending?.key
  const placeName = (s: StopGroup): string => s.customer_name ?? s.destination

  return (
    <article className={`job-focus dv-trip tr-screen status-${job.status}`}>
      {/* หัวจอ (จอ 04) — เลขเที่ยว › เปิดรายละเอียด · ชิปซิงก์ · พัก (เหลือง) · แจ้งปัญหา (แดง) */}
      <header className="tr-head">
        <div className="tr-head-row">
          {onBack && (
            <button type="button" className="tr-back" aria-label={backLabel} onClick={onBack}>
              <IconChevronLeft size={22} />
            </button>
          )}
          <button type="button" className="tr-title" aria-label={`รายละเอียดเที่ยว ${jobTripNo(job)}`}
            onClick={() => setDetailOpen(true)}>
            <span className="tr-h1">{jobTripNo(job)} ›</span>
            <span className="tr-sub job-meter-text">
              {waiting || job.status === 'planned'
                ? `${stops.length} จุด · ${job.vehicle_plate}`
                : <>ส่งแล้ว <b>{delivered}</b> จาก {stops.length} จุด{cancelledStops > 0 ? ` · ส่งไม่ได้ ${cancelledStops}` : ''}</>}
              {helper ? ' · คนขับร่วม' : ''}
            </span>
          </button>
          {waiting ? (
            <span className="chip c-wait">รอรับงาน</span>
          ) : online ? null : (
            <span className="chip c-wait" role="status">
              <svg className="tr-ic tr-ic-14" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5" /><path d="M18 3v4h-4M6 21v-4h4" /></svg>
              รอส่ง
            </span>
          )}
          {stopsLive && (
            <button type="button" className="tr-hbtn is-break" aria-label="พักระหว่างทาง" onClick={() => setBreakOpen(true)}>
              <svg className="tr-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13v5a5 5 0 01-5 5H9a5 5 0 01-5-5z" /><path d="M17 10h1.5a2.5 2.5 0 010 5H17M8 3v3M12 3v3" /></svg>
            </button>
          )}
          {!waiting && onReportIssue && active && (
            <button type="button" className="tr-hbtn is-issue" aria-label="แจ้งปัญหา" onClick={() => onReportIssue(job)}>
              <svg className="tr-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v4M12 17.5v.5" /></svg>
            </button>
          )}
        </div>
        {stops.length > 0 && !waiting && (
          <div className="tr-segs" role="img" aria-label={`ส่งแล้ว ${delivered} จาก ${stops.length} จุด`}>
            {stops.map((s) => (
              <span key={s.key} className={`tr-seg${s.done ? ' is-done' : s.cancelled ? ' is-bad' : s.key === nowSeg ? ' is-now' : ''}`} />
            ))}
          </div>
        )}
      </header>

      {!online && (
        <div className="tr-strip" role="status">สัญญาณอ่อน — เก็บข้อมูลไว้ในเครื่อง ส่งให้อัตโนมัติ</div>
      )}
      {trackNote && !trackNote.on && <div className="tr-strip">{trackNote.text}</div>}

      <main className="tr-main">
        {!waiting && job.status === 'planned' && (
          <div className="tr-note">กด "เริ่มเดินทาง" เมื่อออกจากคลัง แล้วจึงเริ่มส่งร้านได้</div>
        )}
        {job.issue_note && <div className="tr-note is-warn">แจ้งปัญหาไว้: {job.issue_note}</div>}

        {waiting ? (
          /* จอ 03 — รายการร้านจาง ๆ ใต้แผ่นรับงาน */
          <ol className="tr-plan" aria-label="จุดส่งในเที่ยวนี้">
            {stops.map((s, i) => (
              <li key={s.key} className="tr-plan-row">
                <span className="tr-num">{i + 1}</span>
                <span className="tr-grow">
                  <b>{placeName(s)}</b>
                  <small>{s.unit_count > 0 ? `${s.unit_count} กล่อง · ` : ''}{s.orders.length} บิล</small>
                </span>
                <span className="tr-time">{fmtTime(s.scheduled_at)}</span>
              </li>
            ))}
          </ol>
        ) : job.status === 'returning' && !showStops ? (
          /* ขากลับ — คนขับร่วมได้หน้าตาจอ 19 คนขับหลักได้สรุปเดียวกันพร้อมปุ่มถึงคลังข้างล่าง */
          <>
            <section className="tr-done-card">
              <span className="tr-done-icon" aria-hidden><IconCheck size={30} /></span>
              <h2>{returningCount > 1 ? `ส่งครบ ${returningCount} เที่ยว` : 'ส่งครบแล้ว'}</h2>
              <p>
                {helper ? <>กำลังกลับคลัง รอคนขับหลักกดปิดงาน<br />คุณไม่ต้องกรอกเลขไมล์</> : 'ถึงคลังแล้วค่อยกดปิดทีเดียว'}
              </p>
              {podMissing > 0 && <div className="tr-note is-warn">ยังขาดหลักฐาน {podMissing} ร้าน</div>}
            </section>
            <section className="tr-tl-card">
              <div className="tr-label">สถานะเที่ยว</div>
              <div className="tr-tl"><span className="tr-dot is-ok" /><span className="tr-grow">ออกจากคลัง</span><span className="tr-time">{job.departed_at ? fmtTime(job.departed_at) : '—'}</span></div>
              <div className="tr-tl"><span className="tr-dot is-ok" /><span className="tr-grow">ส่งครบ {delivered} จุด</span></div>
              <div className="tr-tl"><span className="tr-dot is-now" /><span className="tr-grow"><b>กลับคลัง</b></span><span className="chip c-run">ตอนนี้</span></div>
              <div className="tr-tl"><span className="tr-dot" /><span className="tr-grow tr-muted">ปิดงาน{helper ? ' (คนขับหลัก)' : ''}</span></div>
            </section>
            <button type="button" className="btn sec" onClick={() => setShowStops(true)}>ดูร้านในเที่ยวนี้</button>
          </>
        ) : stops.length === 0 ? (
          <p className="tr-empty">เที่ยวนี้ยังไม่มีจุดส่ง</p>
        ) : (
          <>
            <ol className="stop-list tr-stops" aria-label={lockedStop ? 'ร้านที่กำลังส่ง' : 'จุดส่งในเที่ยวนี้'}>
              {focus && stopItem(focus, true)}
            </ol>
            {rest.length > 0 && (
              <>
                <div className="tr-label">จุดต่อไป</div>
                <ol className="tr-stops" aria-label="จุดอื่นในเที่ยวนี้">
                  {rest.map((s) => stopItem(s, false))}
                </ol>
              </>
            )}
          </>
        )}

        {crew > 1 && job.status !== 'returning' && (
          <p className="tr-crew">
            ไปด้วยกัน {crew} คน · รับแล้ว {job.accepted_count}/{crew}
            {helper && ' · คุณเป็นผู้ช่วย'}
          </p>
        )}
      </main>

      {cta && !waiting && <div className="job-cta-bar tr-cta">{cta}</div>}

      {/* จอ 03 — รับงาน + อธิบายตำแหน่ง (แผ่นล่าง ค้างอยู่ตลอดตอนรอรับงาน) */}
      {waiting && canProgress && (
        <Sheet label="รับงานและเปิดตำแหน่ง" dim={gpsSheet} onClose={gpsSheet ? () => setGpsSheet(false) : undefined}>
          {gpsSheet ? (
            <>
              <span className="tr-sheet-icon is-info" aria-hidden>
                <svg className="tr-ic tr-ic-28" viewBox="0 0 24 24"><path d="M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>
              </span>
              <h2>รับงานและเปิดตำแหน่ง</h2>
              <p>ระบบบันทึกตำแหน่งเฉพาะตอนกดปุ่ม เช่น ออกรถ ถึงร้าน ส่งเสร็จ พัก เติมน้ำมัน เพื่อยืนยันการส่ง ไม่ติดตามตลอดเวลา</p>
              <ul className="tr-ticks">
                <li><IconCheck size={18} /> ไม่บันทึกหลังปิดงาน หรือตอนไม่มีเที่ยว</li>
                <li><IconCheck size={18} /> ไม่มีสัญญาณ เก็บไว้ในเครื่องแล้วส่งทีหลัง</li>
                <li><IconCheck size={18} /> เห็นได้เฉพาะฝ่ายวางแผนขนส่ง</li>
              </ul>
              <Button size="lg" className="btn pri" loading={busy} onClick={() => {
                setGpsSheet(false)
                void hereOnce()
                onAct(job, 'accept')
              }}>รับงาน · อนุญาตตำแหน่ง</Button>
              <button type="button" className="btn ghost tr-btn-44" onClick={() => setGpsSheet(false)}>ยังไม่รับตอนนี้</button>
            </>
          ) : (
            <>
              <Button size="lg" className="btn pri" onClick={() => setGpsSheet(true)}>รับงานนี้</Button>
              {onReportIssue && (
                <button type="button" className="btn ghost tr-btn-44" onClick={() => onReportIssue(job)}>มีปัญหา แจ้งฝ่ายวางแผน</button>
              )}
            </>
          )}
        </Sheet>
      )}

      {/* จอ 12 — ปิดสิทธิ์ตำแหน่ง: บอกวิธีเปิด แต่ไม่ขวางงาน */}
      {gpsDenied && active && !waiting && !gpsHelpClosed && (
        <Sheet label="ตำแหน่ง GPS ถูกปิด" dim onClose={() => setGpsHelpClosed(true)}>
          <span className="tr-sheet-icon is-bad" aria-hidden><IconAlert size={26} /></span>
          <h2>ตำแหน่ง GPS ถูกปิด</h2>
          <p>ต้องเปิดตำแหน่งก่อนเริ่มเดินทาง ระบบใช้ยืนยันว่าส่งถึงร้านจริง</p>
          <div className="tr-steps">
            <div className="tr-step"><b className="tr-k">1</b><span>แตะไอคอนแม่กุญแจ ข้างช่องที่อยู่เว็บ</span></div>
            <div className="tr-step"><b className="tr-k">2</b><span>เลือก ตำแหน่ง แล้วกด อนุญาต</span></div>
            <div className="tr-step"><b className="tr-k">3</b><span>กลับมากด "ลองอีกครั้ง"</span></div>
          </div>
          <button type="button" className="btn pri" onClick={() => { void hereOnce().then((p) => { if (p) setGpsDenied(false) }) }}>ลองอีกครั้ง</button>
          <button type="button" className="btn ghost tr-btn-44" onClick={() => setGpsHelpClosed(true)}>ทำงานต่อโดยไม่มีพิกัด</button>
        </Sheet>
      )}

      {/* จอ 18 — กดถึงร้านตอนยังห่างเกิน */}
      {far && (
        <div className="tr-scrim is-center">
          <section role="alertdialog" aria-modal="true" aria-label="ยังไม่ถึงร้าน" className="tr-dialog">
            <div className="tr-map" aria-hidden="true">
              <div className="tr-map-ring" /><div className="tr-map-store" /><div className="tr-map-me" />
              <div className="tr-map-tag">คุณอยู่ที่นี่</div>
            </div>
            <h2>ดูเหมือนยังไม่ถึงร้าน</h2>
            <p>
              ตำแหน่งตอนนี้ห่างจาก {placeName(far.stop)} <b>{far.m >= 1000 ? `${(far.m / 1000).toFixed(1)} กม.` : `${far.m} ม.`}</b> (เกณฑ์ {FAR_M} ม.)
              ถ้าถึงแล้วจริง เช่น หมุดร้านผิด ให้กดยืนยัน ระบบจะแจ้งฝ่ายวางแผน
            </p>
            <button type="button" className="btn pri" autoFocus onClick={() => setFar(null)}>ยังไม่ถึง กลับไปนำทาง</button>
            <button type="button" className="btn sec" onClick={() => {
              const f = far
              setFar(null)
              enter(f.stop, { far_m: f.m, pin_wrong: true })
            }}>ถึงแล้ว หมุดร้านผิด</button>
          </section>
        </div>
      )}

      <BreakFlow tripId={String(job.id)} open={breakOpen} onClose={() => setBreakOpen(false)} />

      {/* จอ 09 — รายละเอียดเที่ยว: ลำดับการแวะ จัดลำดับ ถอยการส่ง ถอนยกเลิก ดูหลักฐาน */}
      {detailOpen && (
        <Sheet label="รายละเอียดเที่ยว" dim tall onClose={() => setDetailOpen(false)}>
          <div className="tr-sheet-head">
            <div className="tr-grow">
              <h2>{jobTripNo(job)}</h2>
              <div className="tr-sub">
                {job.vehicle_plate} · ออกรถ {job.departed_at ? fmtTime(job.departed_at) : '—'} · ส่งแล้ว {delivered}/{stops.length}
                {crew > 1 ? ` · ไปด้วยกัน ${crew} คน (รับแล้ว ${job.accepted_count})` : ''}
              </div>
            </div>
            <button type="button" className="tr-back" aria-label="ปิด" onClick={() => setDetailOpen(false)}>✕</button>
          </div>
          <div className="tr-row-between">
            <div className="tr-label">ลำดับการแวะ</div>
            {canReorder && <span className="tr-hint">กด ขึ้น/ลง เพื่อสลับจุดที่ยังไม่ส่ง</span>}
          </div>
          <ol className="tr-st-list">
            {stops.map((s, i) => {
              const now = s.key === nowSeg
              return (
                <li key={s.key} className="tr-st">
                  <span className={`tr-n${s.done ? ' is-ok' : s.cancelled ? ' is-bad' : now ? ' is-now' : ''}`}>
                    {s.done ? '✓' : s.cancelled ? '!' : i + 1}
                  </span>
                  <span className={`tr-grow${s.done || s.cancelled ? ' tr-muted' : ''}${now ? ' tr-strong' : ''}`}>
                    {placeName(s)}
                    <small>
                      {s.cancelled
                        ? (s.orders.find((o) => o.cancel_reason)?.cancel_reason ?? 'ส่งไม่ได้')
                        : `${fmtTime(s.scheduled_at)}${s.done ? (s.needPod.length ? ' · ยังไม่เก็บหลักฐาน' : ' · เก็บหลักฐานแล้ว') : ''}`}
                    </small>
                  </span>
                  {s.cancelled && <span className="chip c-bad">ส่งไม่ได้</span>}
                  {now && !s.done && !s.cancelled && <span className="chip c-run">กำลังไป</span>}
                  <span className="tr-st-acts">
                    {canReorder && !s.done && !s.cancelled && (
                      <>
                        <button type="button" className="tr-mini-act" disabled={i === 0} onClick={() => move(s, -1)}
                          aria-label={`เลื่อน ${s.destination} ขึ้นก่อน`}>ขึ้น</button>
                        <button type="button" className="tr-mini-act" disabled={i === stops.length - 1} onClick={() => move(s, 1)}
                          aria-label={`เลื่อน ${s.destination} ไปทีหลัง`}>ลง</button>
                      </>
                    )}
                    {/* ถอยการส่งได้เฉพาะร้านที่ยังไม่มีหลักฐาน — เซ็นแล้วต้องให้ออฟฟิศแก้ */}
                    {stopsLive && onUndoDeliver && s.done && s.needPod.length === s.orders.length && (
                      <button type="button" className="tr-mini-act" onClick={() => {
                        setLockedKey(null)
                        setConfirmSwitch(false)
                        setDetailOpen(false)
                        onUndoDeliver(s)
                      }}>ถอยการส่ง</button>
                    )}
                    {stopsLive && onUndoCancelStop && s.cancelled && (
                      <button type="button" className="tr-mini-act" onClick={() => { setDetailOpen(false); onUndoCancelStop(s) }}>
                        ถอนยกเลิก
                      </button>
                    )}
                    {canPod && s.done && s.needPod.length > 0 && (
                      <button type="button" className="tr-mini-act is-pri" onClick={() => { setDetailOpen(false); onPod(s) }}>
                        เก็บหลักฐาน
                      </button>
                    )}
                    {onViewPod && s.orders.some((o) => o.has_pod > 0) && (
                      <button type="button" className="tr-link" onClick={() => {
                        const o = s.orders.find((x) => x.has_pod > 0)
                        if (o) { setDetailOpen(false); onViewPod(o) }
                      }}>ดูหลักฐาน</button>
                    )}
                  </span>
                </li>
              )
            })}
          </ol>
          {stopsLive && (
            <>
              <div className="tr-label">จัดการเที่ยว</div>
              <div className="tr-acts">
                <button type="button" className="tr-act" onClick={() => { setDetailOpen(false); setBreakOpen(true) }}>พัก / เติมน้ำมัน</button>
                {onReportIssue && (
                  <button type="button" className="tr-act is-bad" onClick={() => { setDetailOpen(false); onReportIssue(job) }}>แจ้งปัญหา</button>
                )}
              </div>
            </>
          )}
        </Sheet>
      )}
    </article>
  )
}

/** แผ่นล่างแบบ mockup (มือจับ + มุมโค้ง 22px) — dim = มีม่านทึบด้านหลัง */
function Sheet({ label, dim = false, tall = false, onClose, children }: {
  label: string
  dim?: boolean
  tall?: boolean
  onClose?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  useEffect(() => {
    if (!onClose) return
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <>
      {dim && <div className="tr-scrim" aria-hidden="true" onClick={onClose} />}
      <section role="dialog" aria-modal={dim} aria-label={label} className={`tr-sheet${tall ? ' is-tall' : ''}`}>
        <div className="tr-grab" aria-hidden="true" />
        {children}
      </section>
    </>
  )
}
