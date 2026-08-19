import { useEffect, useMemo, useState } from 'react'
import { Badge, Button } from '../ui'
import { StopItem } from './StopCard'
import { IconTruck } from '../icons'
import { TRIP_STATUS_LABEL } from '../../utils/constants'
import { groupStops, jobTripNo, type StopGroup } from '../../utils/stops'
import type { MyJob, MyJobOrder } from '../../types'

/**
 * งานหนึ่งเที่ยว — รายการจุดส่งทั้งเที่ยวอยู่บนจอเสมอ
 *
 * ลำดับจริงไม่เดินตามเอกสาร คนขับแวะร้าน 2 ก่อนร้าน 1 ได้ทุกวัน โครงที่โชว์
 * "จุดปัจจุบัน" จุดเดียวแล้วซ่อนที่เหลือไว้ จึงบังคับให้กดเพิ่มทุกครั้งที่สลับจุด
 * ซึ่งเป็นเรื่องปกติ ไม่ใช่ข้อยกเว้น
 *
 * โครงนี้เป็นรายการล้วน: ทุกจุดเห็นพร้อมกัน จุดที่ทำอยู่กางอยู่กับที่ในลำดับของมัน
 * แตะจุดไหนก็กางจุดนั้นแทน ปุ่มของจุด (ปิดจุด/เก็บหลักฐาน) อยู่ในจุดนั้น
 * ล่างจอสงวนไว้ให้คำสั่งของทั้งเที่ยวเท่านั้น — รับงาน เริ่มเดินทาง ปิดงาน
 *
 * หนึ่งจุด = หนึ่งร้าน ใบเบิกหลายใบของร้านเดียวถูกยุบเข้าด้วยกัน (ดู utils/stops)
 */
export function JobFocus({
  job,
  busy,
  deliveringKey,
  canProgress,
  canPod,
  onAct,
  onReportIssue,
  onPod,
  onViewPod,
  onDeliver,
  onReorder,
}: {
  job: MyJob
  busy: boolean
  /** คีย์ของร้านที่กำลังส่งคำสั่งปิดจุดอยู่ ('' = ไม่มี) */
  deliveringKey: string
  canProgress: boolean
  canPod: boolean
  onAct: (job: MyJob, action: 'start' | 'complete' | 'accept') => void
  /** เปิดฟอร์มแจ้งปัญหา — แจ้งได้ ไม่ใช่ปฏิเสธงาน งานยังเป็นของคนขับ
   *  ไม่ส่งมา = สแตกที่ไม่มีประตูรับงาน (ฝั่ง LAN) ปุ่มรับงานจะไม่ขึ้นเลย */
  onReportIssue?: (job: MyJob) => void
  onPod: (stop: StopGroup) => void
  /* เปิดดูหลักฐานของใบที่เก็บไปแล้ว — ส่งต่อลงไปที่จุดส่งแต่ละจุด */
  onViewPod?: (order: MyJobOrder) => void
  onDeliver: (stop: StopGroup) => void
  /* จัดลำดับร้านใหม่ทั้งเที่ยว — คนขับรู้เส้นทางจริงดีกว่าลำดับที่เอกสารให้มา
     ไม่ส่งมา = สแตกที่ยังไม่มีการจัดลำดับ (ฝั่ง LAN) ปุ่มขึ้น/ลงจะไม่ขึ้น */
  onReorder?: (job: MyJob, orderIds: number[]) => void
}): React.JSX.Element {
  const stops = useMemo(() => groupStops(job.orders), [job.orders])
  const firstPending = stops.find((s) => !s.done && !s.cancelled)
  const [openKey, setOpenKey] = useState<string | null>(firstPending?.key ?? stops[0]?.key ?? null)

  // สลับเที่ยวแล้วต้องกลับไปกางจุดถัดไปของเที่ยวใหม่ ไม่ใช่ค้างที่จุดของเที่ยวเก่า
  useEffect(() => {
    const list = groupStops(job.orders)
    setOpenKey(list.find((s) => !s.done && !s.cancelled)?.key ?? list[0]?.key ?? null)
  }, [job.id])

  /* ปิดจุดที่กางอยู่แล้ว ให้เด้งไปกางจุดถัดไปเอง — จังหวะที่คนขับต้องการต่อคือจุดต่อไป
     ไม่ใช่นั่งดูจุดที่เพิ่งปิด (ยกเว้นยังไม่ได้เก็บหลักฐาน ซึ่งปุ่มยังอยู่ในจุดนั้น) */
  useEffect(() => {
    const open = stops.find((s) => s.key === openKey)
    if (open && open.done && open.needPod.length === 0 && firstPending) setOpenKey(firstPending.key)
  }, [stops, openKey])

  const delivered = stops.filter((s) => s.done).length
  const active = job.status !== 'completed' && job.status !== 'cancelled'
  /* ประตูเป็นของ "ฉัน" ไม่ใช่ของเที่ยว — คนขับหลักกดรับไปแล้วไม่ได้แปลว่าผู้ช่วยรับแล้ว
     my_accepted_at เป็น undefined บนสแตก LAN ที่ยังไม่มีคอลัมน์นี้ ถอยไปใช้ของเดิม */
  const mineAccepted = job.my_accepted_at ?? job.accepted_at
  const waiting = active && !mineAccepted && onReportIssue !== undefined
  /* ปิดเที่ยวได้เฉพาะคนขับหลัก — ผู้ช่วยยังปิดจุดส่งและเก็บ POD ได้ตามปกติ
     ฐานปฏิเสธอยู่แล้ว ตรงนี้คือไม่แสดงปุ่มที่กดแล้วขึ้น error เป็นอย่างเดียว */
  const canClose = job.is_primary !== false
  /* จัดลำดับได้เฉพาะงานที่รับแล้วและยังไม่จบ — ลำดับของงานที่จบไปแล้วคือประวัติ */
  const canReorder = onReorder !== undefined && canProgress && active && !waiting
  /* จุดส่งเปิดทำงานได้ต่อเมื่อรับงานแล้วและออกรถแล้ว — ก่อนหน้านั้นดูได้อย่างเดียว
     ไม่งั้นคนขับกดปิดจุดได้ทั้งที่ยังไม่ได้ออกจากคลัง */
  const stopsLive = canProgress && active && !waiting && job.status !== 'planned'
  const crew = job.driver_count ?? 1

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
          ส่งครบแล้ว — ปิดงาน
        </Button>
      )
    }
    /* ผู้ช่วยส่งครบแล้วต้องรู้ว่าไม่มีอะไรให้เขากดต่อ ไม่ใช่เห็นปุ่มเทาแล้วเดาเอง */
    return <p className="job-cta-hint">ส่งครบแล้ว — รอคนขับหลักปิดงาน</p>
  })()

  return (
    <article className={`job-focus status-${job.status}`}>
      {/* บรรทัดเดียวจบ: เที่ยวไหน รถคันไหน สถานะอะไร */}
      <header className="job-bar">
        <span className="job-bar-no">{jobTripNo(job)}</span>
        <span className="job-bar-meta">
          <IconTruck size={13} /> {job.vehicle_plate}
        </span>
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

      {waiting && <p className="job-alert">งานใหม่ — กดรับงานก่อนถึงจะเริ่มเดินทางได้</p>}
      {!waiting && job.status === 'planned' && (
        <p className="job-alert">กด "เริ่มเดินทาง" เมื่อออกจากคลัง แล้วจึงปิดจุดส่งได้</p>
      )}
      {job.issue_note && <p className="job-alert is-warn">แจ้งปัญหาไว้: {job.issue_note}</p>}

      {stops.length === 0 ? (
        <p className="job-sub">เที่ยวนี้ยังไม่มีจุดส่ง</p>
      ) : (
        <ol className="stop-list" aria-label="จุดส่งในเที่ยวนี้">
          {stops.map((s, i) => (
            <StopItem
              key={s.key}
              stop={s}
              index={i + 1}
              open={s.key === openKey}
              busy={deliveringKey === s.key}
              canProgress={stopsLive}
              canPod={canPod}
              onOpen={() => setOpenKey(s.key === openKey ? null : s.key)}
              onPod={onPod}
              onViewPod={onViewPod}
              onDeliver={onDeliver}
              onMove={canReorder ? move : undefined}
              canMoveUp={i > 0}
              canMoveDown={i < stops.length - 1}
            />
          ))}
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
