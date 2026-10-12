import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Modal } from '../ui'
import { StopItem } from './StopCard'
import { IconAlert, IconBuilding, IconCheck, IconChevronRight, IconTruck } from '../icons'
import { TRIP_STATUS_LABEL } from '../../utils/constants'
import { fmtTime } from '../../utils/format'
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
}: {
  job: MyJob
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
          <Button size="lg" loading={busy} onClick={() => onAct(job, 'accept')}>
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
        <Button size="lg" loading={busy} onClick={() => onAct(job, 'finish')}>
          {podMissing > 0 ? `ถึงคลังแล้ว · ขาดหลักฐาน ${podMissing} ร้าน` : 'ถึงคลังแล้ว'}
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
      /* ยังส่งไม่ครบ ห้ามปิดเที่ยว — บอกจำนวนที่เหลือแทนปุ่มที่กดไม่ได้ */
      return <p className="job-cta-hint">เหลืออีก {stops.length - settled} จุด — ปิดงานได้เมื่อส่งครบ</p>
    }
    if (canClose) {
      return (
        <Button size="lg" loading={busy} onClick={() => onAct(job, 'complete')}>
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
                setLockedKey(s.key)
                setOpenKey(s.key)
                setConfirmSwitch(false)
              }
            : undefined
        }
        onPod={onPod}
        onViewPod={onViewPod}
        onDeliver={onDeliver}
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

  const segState = (s: StopGroup): string =>
    s.done ? ' is-done' : s.cancelled ? ' is-cancelled' : s.key === (lockedKey ?? firstPending?.key) ? ' is-now' : ''

  return (
    <article className={`job-focus dv-trip status-${job.status}`}>
      <header className="dv-trip-head">
        <div className="dv-trip-row">
          <button type="button" className="dv-trip-no" onClick={() => setDetailOpen(true)}
            aria-label={`รายละเอียดเที่ยว ${jobTripNo(job)}`}>
            {jobTripNo(job)} <IconChevronRight size={16} aria-hidden />
          </button>
          <Badge label={TRIP_STATUS_LABEL[job.status]} tone={job.status} dot />
          {!waiting && onReportIssue && active && (
            <button type="button" className="dv-icon-btn is-warn" aria-label="แจ้งปัญหา" onClick={() => onReportIssue(job)}>
              <IconAlert size={20} />
            </button>
          )}
        </div>
        <div className="dv-trip-sub">
          <span><IconTruck size={14} /> {job.vehicle_plate}</span>
          {job.warehouse_code && <span><IconBuilding size={14} /> {job.warehouse_code}</span>}
          <span className="job-meter-text">
            <b>{delivered}</b>/{stops.length} ร้าน{cancelledStops > 0 ? ` · ยกเลิก ${cancelledStops}` : ''}
          </span>
        </div>
        {stops.length > 0 && (
          <div className="dv-segs" role="img" aria-label={`ส่งแล้ว ${delivered} จาก ${stops.length} ร้าน`}>
            {stops.map((s) => <span key={s.key} className={`dv-seg${segState(s)}`} />)}
          </div>
        )}
      </header>

      {waiting && <p className="dv-note is-warn">งานใหม่ — กดรับงานก่อนถึงจะเริ่มเดินทางได้</p>}
      {!waiting && job.status === 'planned' && (
        <p className="dv-note is-info">กด "เริ่มเดินทาง" เมื่อออกจากคลัง แล้วจึงเริ่มส่งร้านได้</p>
      )}
      {job.issue_note && <p className="dv-note is-warn">แจ้งปัญหาไว้: {job.issue_note}</p>}

      {job.status === 'returning' && !showStops ? (
        /* ขากลับ (mockup จอ 4) — ไม่มีร้านให้ทำแล้ว เหลือการ์ดสรุปใบเดียว */
        <section className="dv-card dv-return">
          <div className="dv-return-head">
            <span className="dv-round is-ok" aria-hidden><IconCheck size={22} /></span>
            <span>
              <b>{returningCount > 1 ? `ส่งครบ ${returningCount} เที่ยว` : 'ส่งครบแล้ว'}</b>
              <small>ถึงคลังแล้วค่อยกดปิดทีเดียว</small>
            </span>
          </div>
          <div className="dv-return-row">
            <span>{jobTripNo(job)}</span>
            <b>{delivered}/{stops.length} ร้าน</b>
          </div>
          {podMissing > 0 && <p className="dv-note is-warn">ยังขาดหลักฐาน {podMissing} ร้าน</p>}
          <button type="button" className="dv-link" onClick={() => setShowStops(true)}>ดูร้านในเที่ยวนี้</button>
        </section>
      ) : stops.length === 0 ? (
        <p className="dv-empty">เที่ยวนี้ยังไม่มีจุดส่ง</p>
      ) : (
        <ol className="stop-list dv-stops" aria-label={lockedStop ? 'ร้านที่กำลังส่ง' : 'จุดส่งในเที่ยวนี้'}>
          {focus && stopItem(focus, true)}
          {rest.map((s) => stopItem(s, false))}
        </ol>
      )}

      {crew > 1 && (
        <p className="dv-crew">
          ไปด้วยกัน {crew} คน · รับแล้ว {job.accepted_count}/{crew}
          {job.is_primary === false && ' · คุณเป็นผู้ช่วย'}
        </p>
      )}

      {cta && <div className="job-cta-bar">{cta}</div>}

      {/* รายละเอียดเที่ยว (mockup จอ 7) — ลำดับการแวะ จัดลำดับ ถอยการส่ง ถอนยกเลิก ดูหลักฐาน */}
      {detailOpen && (
        <Modal open onClose={() => setDetailOpen(false)} size="sheet" title={`รายละเอียด ${jobTripNo(job)}`}
          footer={<Button variant="ghost" onClick={() => setDetailOpen(false)}>ปิด</Button>}>
          <div className="dv-detail">
            <div className="dv-detail-stats">
              <div><small>รถ</small><b>{job.vehicle_plate}</b></div>
              <div><small>ออกรถ</small><b>{job.departed_at ? fmtTime(job.departed_at) : '—'}</b></div>
              <div><small>ส่งแล้ว</small><b>{delivered}/{stops.length}</b></div>
            </div>
            <span className="dv-label">ลำดับการแวะ</span>
            <ol className="dv-detail-list">
              {stops.map((s, i) => (
                <li key={s.key} className={s.done ? 'is-done' : s.cancelled ? 'is-cancelled' : ''}>
                  <span className="dv-seq">{s.done ? '✓' : s.cancelled ? '×' : i + 1}</span>
                  <span className="dv-detail-name">
                    <b>{s.customer_name ?? s.destination}</b>
                    <small>
                      {s.cancelled
                        ? (s.orders.find((o) => o.cancel_reason)?.cancel_reason ?? 'ยกเลิก')
                        : `${fmtTime(s.scheduled_at)}${s.done ? (s.needPod.length ? ' · ยังไม่เก็บหลักฐาน' : ' · เก็บหลักฐานแล้ว') : ''}`}
                    </small>
                  </span>
                  <span className="dv-detail-acts">
                    {canReorder && !s.done && !s.cancelled && (
                      <>
                        <button type="button" className="dv-mini" disabled={i === 0} onClick={() => move(s, -1)}
                          aria-label={`เลื่อน ${s.destination} ขึ้นก่อน`}>ขึ้น</button>
                        <button type="button" className="dv-mini" disabled={i === stops.length - 1} onClick={() => move(s, 1)}
                          aria-label={`เลื่อน ${s.destination} ไปทีหลัง`}>ลง</button>
                      </>
                    )}
                    {/* ถอยการส่งได้เฉพาะร้านที่ยังไม่มีหลักฐาน — เซ็นแล้วต้องให้ออฟฟิศแก้ */}
                    {stopsLive && onUndoDeliver && s.done && s.needPod.length === s.orders.length && (
                      <button type="button" className="dv-mini" onClick={() => {
                        setLockedKey(null)
                        setConfirmSwitch(false)
                        setDetailOpen(false)
                        onUndoDeliver(s)
                      }}>ถอยการส่ง</button>
                    )}
                    {stopsLive && onUndoCancelStop && s.cancelled && (
                      <button type="button" className="dv-mini" onClick={() => { setDetailOpen(false); onUndoCancelStop(s) }}>
                        ถอนยกเลิก
                      </button>
                    )}
                    {canPod && s.done && s.needPod.length > 0 && (
                      <button type="button" className="dv-mini is-primary" onClick={() => { setDetailOpen(false); onPod(s) }}>
                        เก็บหลักฐาน
                      </button>
                    )}
                    {onViewPod && s.orders.some((o) => o.has_pod > 0) && (
                      <button type="button" className="dv-mini" onClick={() => {
                        const o = s.orders.find((x) => x.has_pod > 0)
                        if (o) { setDetailOpen(false); onViewPod(o) }
                      }}>ดูหลักฐาน</button>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {crew > 1 && (
              <p className="dv-crew">ไปด้วยกัน {crew} คน · รับแล้ว {job.accepted_count}/{crew}</p>
            )}
          </div>
        </Modal>
      )}
    </article>
  )
}
