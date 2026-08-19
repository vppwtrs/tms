import { useEffect, useState } from 'react'
import { Badge, Button, Modal } from '../ui'
import { NextStop, StopRow } from './StopCard'
import { IconTruck } from '../icons'
import { TRIP_STATUS_LABEL } from '../../utils/constants'
import type { MyJob, MyJobOrder } from '../../types'

/** จุดแรกที่ยังไม่ถูกส่งหรือยกเลิก — จุดที่คนขับกำลังจะไป */
function firstPending(job: MyJob): MyJobOrder | undefined {
  return job.orders.find((o) => o.status !== 'delivered' && o.status !== 'cancelled')
}

/**
 * งานหนึ่งเที่ยวเต็มจอ — จอเดียวจบ ไม่ต้องเลื่อนหาปุ่ม
 *
 * โครงเดิมวางทุกอย่างต่อกันลงมา (หัวเที่ยว, แถบ 4 ขั้น, จุดปัจจุบัน, รายการทุกจุด,
 * ปุ่มกระจายอยู่หลายที่) คนขับต้องเลื่อนจอกลางถนนเพื่อหาปุ่มที่ต้องกด ซึ่งใช้จริงไม่ได้
 *
 * โครงใหม่ยึดสามข้อ:
 *  1) จอบนคือ "ตอนนี้อยู่ไหน" — หัวเที่ยวย่อเหลือบรรทัดเดียว + แถบคืบหน้าเส้นเดียว
 *  2) กลางจอคือจุดที่กำลังจะไปจุดเดียว รายละเอียดที่ไม่ต้องใช้ตอนขับพับเก็บไว้
 *  3) ล่างจอคือปุ่มหลักปุ่มเดียว เปลี่ยนตามสถานะจริง ไม่มีปุ่มหลักซ้อนอยู่กลางเนื้อหา
 * รายการจุดทั้งเที่ยวย้ายเข้าแผ่นซ้อน กดดูเมื่ออยากดู ไม่ใช่กองอยู่ใต้จอตลอดเวลา
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
  const [focusId, setFocusId] = useState<number | null>(pending?.id ?? job.orders[0]?.id ?? null)
  const [listOpen, setListOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

  // สลับเที่ยวแล้วต้องกลับไปโฟกัสจุดถัดไปของเที่ยวใหม่ ไม่ใช่ค้างที่จุดของเที่ยวเก่า
  useEffect(() => {
    setFocusId(firstPending(job)?.id ?? job.orders[0]?.id ?? null)
    setListOpen(false)
    setDetailOpen(false)
  }, [job.id])

  const focused = job.orders.find((o) => o.id === focusId) ?? pending ?? job.orders[0] ?? null
  const position = focused ? job.orders.findIndex((o) => o.id === focused.id) + 1 : 0
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

  /* ปุ่มหลักปุ่มเดียวล่างจอ เลือกตามสิ่งที่ต้องทำ "ตอนนี้" เรียงตามลำดับที่งานเดินจริง
     ของเดิมมีปุ่มปิดจุดกับปุ่มเก็บ POD ซ่อนอยู่กลางการ์ด ต้องเลื่อนหา จึงยกมารวมที่นี่ */
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
    if (focused && focused.status === 'in_transit') {
      return (
        <Button size="lg" loading={deliveringId === focused.id} onClick={() => onDeliver(focused)}>
          ส่งจุดนี้เสร็จแล้ว
        </Button>
      )
    }
    if (focused && focused.status === 'delivered' && canPod && !focused.has_pod) {
      return (
        <Button size="lg" onClick={() => onPod(focused)}>
          เก็บหลักฐานการส่งมอบ
        </Button>
      )
    }
    if (pending) {
      /* จุดที่โฟกัสอยู่จบแล้วแต่ยังเหลือจุดอื่น — พาไปจุดถัดไปแทนที่จะปล่อยให้หาเอง */
      return (
        <Button size="lg" onClick={() => setFocusId(pending.id)}>
          ไปจุดถัดไป · {pending.destination}
        </Button>
      )
    }
    if (canClose) {
      return (
        <Button size="lg" variant="success" loading={busy} onClick={() => onAct(job, 'complete')}>
          ส่งครบแล้ว — ปิดงาน
        </Button>
      )
    }
    /* ผู้ช่วยส่งครบแล้วต้องรู้ว่าไม่มีอะไรให้เขากดต่อ ไม่ใช่เห็นปุ่มเทาแล้วเดาเอง */
    return (
      <Button size="lg" variant="success" disabled>
        ส่งครบแล้ว — รอคนขับหลักปิดงาน
      </Button>
    )
  })()

  return (
    <article className={`job-focus status-${job.status}`}>
      {/* บรรทัดเดียวจบ: เที่ยวไหน รถคันไหน สถานะอะไร — ของเดิมกินสามบรรทัดบนสุดของจอ */}
      <header className="job-bar">
        <span className="job-bar-no">{job.trip_no}</span>
        <span className="job-bar-meta">
          <IconTruck size={13} /> {job.vehicle_plate}
        </span>
        <Badge label={TRIP_STATUS_LABEL[job.status]} tone={job.status} dot />
      </header>

      {/* แถบคืบหน้าเส้นเดียว แทนจุด 4 ขั้นที่กินความสูงแต่บอกได้แค่ว่าอยู่ขั้นไหน
          ตัวเลข "ส่งแล้ว x/y" คือสิ่งที่คนขับถามจริง ๆ ระหว่างวัน */}
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
      {job.issue_note && <p className="job-alert is-warn">แจ้งปัญหาไว้: {job.issue_note}</p>}

      {focused ? (
        <>
          <p className="stop-focus-kicker">
            จุดที่ {position} จาก {job.orders.length}
          </p>
          <NextStop order={focused} detailOpen={detailOpen} onToggleDetail={() => setDetailOpen((v) => !v)} />
        </>
      ) : (
        <p className="job-sub">เที่ยวนี้ยังไม่มีจุดส่ง</p>
      )}

      {/* รายการทุกจุดย้ายเข้าแผ่นซ้อน — ของเดิมกองอยู่ใต้จอเสมอ ทำให้ต้องเลื่อนยาว
          ทั้งที่ระหว่างขับดูจุดเดียวก็พอ */}
      <div className="job-secondary">
        {job.orders.length > 1 && (
          <Button variant="outline" size="sm" onClick={() => setListOpen(true)}>
            ทุกจุดในเที่ยว ({job.orders.length})
          </Button>
        )}
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

      {cta && (
        /* ตรึงล่างจอ — ปุ่มหลักต้องอยู่ในระยะนิ้วโป้งเสมอ ไม่ต้องเลื่อนหา */
        <div className="job-cta-bar">{cta}</div>
      )}

      {listOpen && (
        <Modal open onClose={() => setListOpen(false)} title={canReorder ? 'ลำดับการแวะ — จัดเองได้' : 'ทุกจุดในเที่ยว'}>
          <ul className="stop-list">
            {job.orders.map((o, i) => (
              <StopRow
                key={o.id}
                order={o}
                active={o.id === focused?.id}
                onSelect={(x) => {
                  setFocusId(x.id)
                  setListOpen(false)
                }}
                onMove={canReorder ? move : undefined}
                canMoveUp={i > 0}
                canMoveDown={i < job.orders.length - 1}
              />
            ))}
          </ul>
        </Modal>
      )}
    </article>
  )
}
