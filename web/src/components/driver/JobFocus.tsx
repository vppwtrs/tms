import { useEffect, useState } from 'react'
import { Badge, Button } from '../ui'
import { IconTruck } from '../icons'
import { JobProgress } from './JobProgress'
import { NextStop, StopRow } from './StopCard'
import { TRIP_STATUS_LABEL } from '../../utils/constants'
import { fmtWeightHuman } from '../../utils/format'
import type { MyJob, MyJobOrder } from '../../types'

/** จุดที่ยังไม่ได้ส่ง = จุดถัดไป ถ้าไม่เหลือแปลว่าส่งครบแล้ว รอปิดงาน */
function firstPending(job: MyJob): MyJobOrder | null {
  return job.orders.find((o) => o.status !== 'delivered' && o.status !== 'cancelled') ?? null
}

/**
 * งานที่กำลังทำ — หนึ่งเที่ยวเต็มจอ
 *
 * ต่างจากของเดิมที่เรียงทุกเที่ยวลงมาเท่ากันหมด แล้วคนขับต้องเลื่อนหาเองว่าต้องทำอะไรต่อ
 * ที่นี่จุดถัดไปได้พื้นที่มากที่สุด จุดอื่นย่อเหลือบรรทัดเดียว และปุ่มหลักตรึงล่างจอ
 * ไม่เลื่อนหนีไปไหน — รูปแบบเดียวกับที่แอปส่งของเชิงพาณิชย์ใช้กันหมด
 */
export function JobFocus({
  job,
  busy,
  deliveringId,
  canProgress,
  canPod,
  onAct,
  onPod,
  onDeliver,
  onReportIssue,
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
}): React.JSX.Element {
  const pending = firstPending(job)
  const [focusId, setFocusId] = useState<number | null>(pending?.id ?? job.orders[0]?.id ?? null)

  // สลับเที่ยวแล้วต้องกลับไปโฟกัสจุดถัดไปของเที่ยวใหม่ ไม่ใช่ค้างที่จุดของเที่ยวเก่า
  useEffect(() => {
    setFocusId(firstPending(job)?.id ?? job.orders[0]?.id ?? null)
  }, [job.id])

  const focused = job.orders.find((o) => o.id === focusId) ?? pending ?? job.orders[0] ?? null
  const others = job.orders.filter((o) => o.id !== focused?.id)
  const position = focused ? job.orders.findIndex((o) => o.id === focused.id) + 1 : 0
  const active = job.status !== 'completed' && job.status !== 'cancelled'
  /* ยังไม่กดรับ = งานยังไม่ถึงมือจริง ๆ ทุกปุ่มที่เดินงานต่อต้องรอตรงนี้ก่อน
     ไม่งั้นก็กลับไปเป็นแบบเดิมที่งานวิ่งเองโดยคนขับไม่เคยยืนยันว่าเห็น */
  const waiting = active && !job.accepted_at && onReportIssue !== undefined

  return (
    <article className={`job-focus status-${job.status}`}>
      <header className="job-focus-head">
        <div>
          <h2 className="job-no">{job.trip_no}</h2>
          <p className="job-sub">
            <IconTruck size={14} /> {job.vehicle_plate} · {job.orders.length} จุดส่ง · {fmtWeightHuman(job.total_weight)}
          </p>
        </div>
        <Badge label={TRIP_STATUS_LABEL[job.status]} tone={job.status} dot />
      </header>

      {waiting && (
        <p className="job-sub" style={{ marginTop: 8 }}>
          งานใหม่จาก TMS — กดรับงานก่อนถึงจะเริ่มเดินทางได้
        </p>
      )}

      {job.issue_note && (
        <p className="job-sub" style={{ marginTop: 8 }}>
          แจ้งปัญหาไว้แล้ว: {job.issue_note}
        </p>
      )}

      <JobProgress job={job} />

      {focused ? (
        <>
          <p className="stop-focus-kicker">
            จุดที่ {position} จาก {job.orders.length}
          </p>
          <NextStop
            order={focused}
            canPod={canPod}
            canProgress={canProgress}
            busy={deliveringId === focused.id}
            onPod={onPod}
            onDeliver={onDeliver}
          />
        </>
      ) : (
        <p className="job-sub">เที่ยวนี้ยังไม่มีจุดส่ง</p>
      )}

      {others.length > 0 && (
        <section className="stop-others">
          <h3 className="stop-others-title">จุดอื่นในเที่ยวนี้</h3>
          <ul className="stop-list">
            {others.map((o) => (
              <StopRow key={o.id} order={o} active={false} onSelect={(x) => setFocusId(x.id)} />
            ))}
          </ul>
        </section>
      )}

      {canProgress && active && (
        /* ตรึงล่างจอ — ปุ่มหลักต้องอยู่ในระยะนิ้วโป้งเสมอ ไม่ต้องเลื่อนหา */
        <div className="job-cta-bar">
          {waiting ? (
            /* ปุ่มเดียวเต็มความกว้าง ไม่มีปุ่มปฏิเสธ — TMS จ่ายคนมาแล้วและเราเขียนกลับไม่ได้
               มีปัญหาให้กดแจ้ง ซึ่งไปขึ้นบนกระดานของคนวางแผน ไม่ใช่คืนงานเงียบ ๆ */
            <>
              <Button size="lg" loading={busy} onClick={() => onAct(job, 'accept')}>
                รับงานนี้
              </Button>
              <Button size="lg" variant="ghost" onClick={() => onReportIssue?.(job)}>
                แจ้งปัญหา
              </Button>
            </>
          ) : job.status === 'planned' ? (
            <Button size="lg" loading={busy} onClick={() => onAct(job, 'start')}>
              เริ่มเดินทาง
            </Button>
          ) : pending ? (
            /* ยังส่งไม่ครบ ห้ามปิดเที่ยว — ถ้าปิดตอนนี้ จุดที่เหลือจะถูกเหมาเป็น "ส่งแล้ว"
               ทั้งที่ยังไม่ได้ไป แล้ว POD ของร้านเหล่านั้นก็ไม่มีใครเก็บ */
            <Button size="lg" variant="success" disabled>
              เหลืออีก {job.orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled').length} จุด
            </Button>
          ) : (
            <Button size="lg" variant="success" loading={busy} onClick={() => onAct(job, 'complete')}>
              ส่งครบแล้ว — ปิดงาน
            </Button>
          )}
        </div>
      )}
    </article>
  )
}
