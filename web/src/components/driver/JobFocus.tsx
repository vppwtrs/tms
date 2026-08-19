import { useEffect, useState } from 'react'
import { Badge, Button } from '../ui'
import { StopItem } from './StopCard'
import { IconTruck } from '../icons'
import { TRIP_STATUS_LABEL } from '../../utils/constants'
import type { MyJob, MyJobOrder } from '../../types'

/** จุดแรกที่ยังไม่ถูกส่งหรือยกเลิก — จุดที่คนขับกำลังจะไป */
function firstPending(job: MyJob): MyJobOrder | undefined {
  return job.orders.find((o) => o.status !== 'delivered' && o.status !== 'cancelled')
}

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
 */
export function JobFocus({
  job,
  busy,
  deliveringId,
  canProgress,
  canPod,
  onAct,
  onReportIssue,
  onPod,
  onDeliver,
  onReorder,
}: {
  job: MyJob
  busy: boolean
  /** เลขออเดอร์ที่กำลังส่งคำสั่งปิดจุดอยู่ (0 = ไม่มี) */
  deliveringId: number
  canProgress: boolean
  canPod: boolean
  onAct: (job: MyJob, action: 'start' | 'complete' | 'accept') => void
  /** เปิดฟอร์มแจ้งปัญหา — แจ้งได้ ไม่ใช่ปฏิเสธงาน งานยังเป็นของคนขับ
   *  ไม่ส่งมา = สแตกที่ไม่มีประตูรับงาน (ฝั่ง LAN) ปุ่มรับงานจะไม่ขึ้นเลย */
  onReportIssue?: (job: MyJob) => void
  onPod: (order: MyJobOrder) => void
  onDeliver: (order: MyJobOrder) => void
  /* จัดลำดับร้านใหม่ทั้งเที่ยว — คนขับรู้เส้นทางจริงดีกว่าลำดับที่เอกสารให้มา
     ไม่ส่งมา = สแตกที่ยังไม่มีการจัดลำดับ (ฝั่ง LAN) ปุ่มขึ้น/ลงจะไม่ขึ้น */
  onReorder?: (job: MyJob, orderIds: number[]) => void
}): React.JSX.Element {
  const pending = firstPending(job)
  const [openId, setOpenId] = useState<number | null>(pending?.id ?? job.orders[0]?.id ?? null)

  // สลับเที่ยวแล้วต้องกลับไปกางจุดถัดไปของเที่ยวใหม่ ไม่ใช่ค้างที่จุดของเที่ยวเก่า
  useEffect(() => {
    setOpenId(firstPending(job)?.id ?? job.orders[0]?.id ?? null)
  }, [job.id])

  /* ปิดจุดที่กางอยู่แล้ว ให้เด้งไปกางจุดถัดไปเอง — จังหวะที่คนขับต้องการต่อคือจุดต่อไป
     ไม่ใช่นั่งดูจุดที่เพิ่งปิด (ยกเว้นยังไม่ได้เก็บหลักฐาน ซึ่งปุ่มยังอยู่ในจุดนั้น) */
  useEffect(() => {
    const open = job.orders.find((o) => o.id === openId)
    if (open && open.status === 'delivered' && open.has_pod) {
      const next = firstPending(job)
      if (next) setOpenId(next.id)
    }
  }, [job.orders, openId])

  const delivered = job.orders.filter((o) => o.status === 'delivered').length
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

  const move = (order: MyJobOrder, dir: -1 | 1): void => {
    const ids = job.orders.map((o) => o.id)
    const at = ids.indexOf(order.id)
    const to = at + dir
    if (at < 0 || to < 0 || to >= ids.length) return
    const moved = ids[at]
    const swapped = ids[to]
    if (moved === undefined || swapped === undefined) return
    ids[at] = swapped
    ids[to] = moved
    onReorder?.(job, ids)
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
    if (pending) {
      /* ยังส่งไม่ครบ ห้ามปิดเที่ยว — ถ้าปิดตอนนี้ จุดที่เหลือจะถูกเหมาเป็น "ส่งแล้ว"
         ทั้งที่ยังไม่ได้ไป แล้ว POD ของร้านเหล่านั้นก็ไม่มีใครเก็บ
         บอกจำนวนที่เหลือแทนปุ่มที่กดไม่ได้ เพราะคำถามคือ "อีกกี่ร้าน" */
      return <p className="job-cta-hint">เหลืออีก {job.orders.length - delivered} จุด — ปิดงานได้เมื่อส่งครบ</p>
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
        <span className="job-bar-no">{job.trip_no}</span>
        <span className="job-bar-meta">
          <IconTruck size={13} /> {job.vehicle_plate}
        </span>
        <Badge label={TRIP_STATUS_LABEL[job.status]} tone={job.status} dot />
      </header>

      {/* แถบคืบหน้าเส้นเดียว — ตัวเลข "ส่งแล้ว x/y" คือสิ่งที่คนขับถามจริงระหว่างวัน */}
      <div className="job-meter">
        <div className="job-meter-track">
          <div
            className="job-meter-fill"
            style={{ width: `${job.orders.length ? (delivered / job.orders.length) * 100 : 0}%` }}
          />
        </div>
        <span className="job-meter-text">
          ส่งแล้ว {delivered}/{job.orders.length}
        </span>
      </div>

      {waiting && <p className="job-alert">งานใหม่ — กดรับงานก่อนถึงจะเริ่มเดินทางได้</p>}
      {!waiting && job.status === 'planned' && (
        <p className="job-alert">กด "เริ่มเดินทาง" เมื่อออกจากคลัง แล้วจึงปิดจุดส่งได้</p>
      )}
      {job.issue_note && <p className="job-alert is-warn">แจ้งปัญหาไว้: {job.issue_note}</p>}

      {job.orders.length === 0 ? (
        <p className="job-sub">เที่ยวนี้ยังไม่มีจุดส่ง</p>
      ) : (
        <ol className="stop-list" aria-label="จุดส่งในเที่ยวนี้">
          {job.orders.map((o, i) => (
            <StopItem
              key={o.id}
              order={o}
              index={i + 1}
              open={o.id === openId}
              busy={deliveringId === o.id}
              canProgress={stopsLive}
              canPod={canPod}
              onOpen={() => setOpenId(o.id === openId ? null : o.id)}
              onPod={onPod}
              onDeliver={onDeliver}
              onMove={canReorder ? move : undefined}
              canMoveUp={i > 0}
              canMoveDown={i < job.orders.length - 1}
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
