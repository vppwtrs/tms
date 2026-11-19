import { useState } from 'react'
import { Button } from '../ui'
import { setCount } from '../../utils/podCount'
import { IconPhone, IconPin } from '../icons'
import { fmtTime } from '../../utils/format'
import type { StopGroup } from '../../utils/stops'
import type { MyJobOrder } from '../../types'

/** ลิงก์นำทาง — ใช้พิกัดที่ปักไว้ก่อนถ้ามี (แม่นเป๊ะ ไม่ต้องเดา geocode) ไม่มีค่อยใช้
 *  ที่อยู่ลูกค้า ไม่มีอีกค่อยใช้ชื่อปลายทาง
 *
 *  พิกัดมาจาก GPS ตอนคนขับคนก่อนปิดงานร้านนี้ครั้งแรก (ดู save_pod) — ร้านที่ยังไม่มี
 *  ใครไปส่งเลยจะยังไม่มีพิกัด ใช้ที่อยู่เป็นข้อความไปก่อนตามเดิม */
function mapsUrl(stop: StopGroup): string {
  const query = stop.customer_lat != null && stop.customer_lng != null
    ? `${stop.customer_lat},${stop.customer_lng}`
    : (stop.customer_address ?? stop.destination)
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/**
 * จุดส่งหนึ่งจุด = หนึ่งร้าน (mockup "งานตอนนี้")
 *
 * open = การ์ดใหญ่: ป้ายสถานะ + เวลานัด ชื่อร้านตัวใหญ่ ที่อยู่ ของที่ส่ง ปุ่มโทร/นำทาง
 * แล้วปุ่มหลักของร้านปุ่มเดียว — "ถึงร้านแล้ว" (เข้าร้าน) → "ส่งของ" (ปิดจุด ตอนอยู่ในร้านเท่านั้น)
 * → "เก็บหลักฐาน" (ส่งแล้วแต่ยังไม่มีหลักฐาน)
 * ไม่ open = แถวบาง แตะแล้วร้านนั้นกลายเป็นการ์ดใหญ่แทน
 *
 * ใบหลายใบของร้านเดียวปิดพร้อมกันด้วยการกดครั้งเดียว — ที่หน้าร้านคนขับส่งของทั้งกองในรอบเดียว
 */
export function StopItem({
  stop,
  index,
  open,
  busy,
  canProgress,
  canPod,
  locked = false,
  switchArmed = false,
  isNext = false,
  onExitLock,
  onOpen,
  onEnter,
  onPod,
  onViewPod,
  onDeliver,
  onCancelStop,
}: {
  stop: StopGroup
  /** ลำดับจริงในเที่ยว (เริ่มที่ 1) */
  index: number
  open: boolean
  busy: boolean
  canProgress: boolean
  canPod: boolean
  /** จุดนี้คือจุดที่คนขับ "เข้าไป" อยู่ — ปุ่มปิดจุดขึ้นเฉพาะตอนนี้เท่านั้น */
  locked?: boolean
  /** กดออกครั้งแรกแล้วรออีกครั้ง */
  switchArmed?: boolean
  /** ร้านถัดไปที่ต้องไป — ป้าย "จุดต่อไป" */
  isNext?: boolean
  /** ออกจากร้านที่ล็อกอยู่ (กดสองครั้ง) — ไม่ส่งมา = ปุ่มออกไม่ขึ้น */
  onExitLock?: () => void
  onOpen: () => void
  /** เข้าร้านนี้ (ล็อกจอไว้ที่ร้านเดียว) — ไม่ส่งมา = เข้าไม่ได้ตอนนี้ */
  onEnter?: () => void
  onPod: (stop: StopGroup) => void
  onViewPod?: (order: MyJobOrder) => void
  onDeliver: (stop: StopGroup) => void
  /** ร้านยกเลิกจากต้นทาง — ไม่ส่งมา = ปุ่มไม่ขึ้น (จอที่ดูอย่างเดียว) */
  onCancelStop?: (stop: StopGroup) => void
}): React.JSX.Element {
  const state = stop.done ? 'is-done' : stop.cancelled ? 'is-cancelled' : 'is-todo'
  const bills = stop.orders.length
  const name = stop.customer_name ?? stop.destination
  /* ยอดนับจริงต่อบิล — ค่าเริ่ม = ยอดสั่ง */
  const [counts, setCounts] = useState<Record<string, number>>({})
  const countable = stop.pending.filter((o) => (o.tms_unit_count ?? 0) > 0)
  const countOf = (o: MyJobOrder): number => counts[o.id] ?? (o.tms_unit_count ?? 0)
  const setCounted = (o: MyJobOrder, n: number): void => setCounts((c) => ({ ...c, [o.id]: Math.max(0, n) }))
  const expectedSum = countable.reduce((s, o) => s + (o.tms_unit_count ?? 0), 0)
  const countedSum = countable.reduce((s, o) => s + countOf(o), 0)

  if (!open) {
    const chip = stop.done
      ? <span className="chip c-ok">{stop.needPod.length === 0 ? 'ส่งครบ' : 'รอหลักฐาน'}</span>
      : stop.cancelled ? <span className="chip c-bad">ส่งไม่ได้</span>
      : <span className="chip c-mute">{index}</span>
    return (
      <li className={`stop-item tr-mini ${state}`}>
        <button type="button" className="tr-mini-btn" onClick={onOpen} aria-label={`จุดที่ ${index} ${stop.destination}`}>
          {chip}
          <span className={`tr-mini-name${stop.done || stop.cancelled ? ' is-past' : ''}`}>{name}</span>
          <span className="tr-mini-time">{fmtTime(stop.scheduled_at)}</span>
        </button>
      </li>
    )
  }

  const tag = locked ? `จุดที่ ${index} · กำลังส่ง`
    : stop.done ? `จุดที่ ${index} · ส่งแล้ว`
    : stop.cancelled ? `จุดที่ ${index} · ส่งไม่ได้`
    : isNext ? `จุดที่ ${index} · กำลังไป` : `จุดที่ ${index}`
  const tagTone = stop.done ? 'c-ok' : stop.cancelled ? 'c-bad' : isNext || locked ? 'c-run' : 'c-mute'
  /* หมายเหตุที่คนพิมพ์เอง — หมายเหตุที่ระบบเขียนตอนนำเข้าไม่ต้องขึ้น */
  const notes = stop.orders.map((o) => o.notes).filter((n): n is string => !!n && !n.startsWith('นำเข้าจาก TMS'))

  return (
    <li className={`stop-item tr-stop ${state}${locked ? ' is-locked' : ''}`}>
      <div className="tr-stop-top">
        <span className={`chip ${tagTone}`}>{tag}</span>
        {locked && onExitLock && (
          <button type="button" className={`tr-switch${switchArmed ? ' is-armed' : ''}`} onClick={onExitLock}>
            {switchArmed ? 'แตะอีกครั้งเพื่อออก' : 'เปลี่ยนร้าน'}
          </button>
        )}
        {stop.scheduled_at && <span className="tr-appt">นัด {fmtTime(stop.scheduled_at)}</span>}
      </div>

      <div>
        <h2 className="tr-stop-name">{name}</h2>
        {stop.customer_address && <div className="tr-stop-addr">{stop.customer_address}</div>}
      </div>

      <div className="tr-stop-facts">
        {stop.unit_count > 0 && <span><b>{stop.unit_count}</b> กล่อง</span>}
        <span><b>{bills}</b> บิล</span>
        {stop.weight_kg > 0 && <span><b>{Math.round(stop.weight_kg)}</b> กก.</span>}
      </div>

      {/* เลขที่ใบต้องอ่านให้ทางโทรศัพท์ได้ทันที */}
      <ul className="tr-bills" aria-label={`ใบเบิกของ ${name}`}>
        {stop.orders.map((o) => (
          <li key={o.id} className={`stop-bill${o.status === 'delivered' ? ' is-done' : ''}`}>
            <span className="tr-bill-no">{o.tms_picking_list_no ?? o.order_no}</span>
            <span className="tr-bill-goods">{o.goods_desc || '—'}</span>
            {o.has_pod > 0 && onViewPod && (
              <button type="button" className="tr-link" onClick={() => onViewPod(o)}>ดูหลักฐาน</button>
            )}
          </li>
        ))}
      </ul>

      {notes.length > 0 && (
        <div className="tr-note"><b>หมายเหตุ:</b> {notes.join(' · ')}</div>
      )}

      {stop.cancelled && (
        <div className="tr-note is-bad" role="status">
          ส่งไม่ได้ — {stop.orders.find((o) => o.cancel_reason)?.cancel_reason ?? 'ไม่ได้บันทึกเหตุผล'}
        </div>
      )}

      {!stop.cancelled && (
        <div className="tr-pair">
          {stop.customer_phone ? (
            <a className="btn sec tr-btn-48" href={`tel:${stop.customer_phone}`}><IconPhone size={20} /> โทรร้าน</a>
          ) : (
            <span className="btn sec tr-btn-48 is-disabled" aria-disabled="true"><IconPhone size={20} /> ไม่มีเบอร์</span>
          )}
          <a className="btn sec tr-btn-48" href={mapsUrl(stop)} target="_blank" rel="noreferrer"><IconPin size={20} /> นำทาง</a>
        </div>
      )}

      {/* ปุ่มหลักของร้าน — สองจังหวะ: เข้าร้าน (กดผิดก็แค่ออก) แล้วจึงปิดจุด (ย้อนยาก) */}
      {canProgress && stop.pending.length > 0 && !locked && onEnter && (
        <Button size="lg" className="dv-cta btn pri" onClick={onEnter}>ถึงร้านแล้ว เริ่มส่งของ</Button>
      )}
      {canProgress && locked && countable.length > 0 && (
        <section className="tr-count" aria-label="ตรวจนับของที่ส่ง">
          <div className="tr-count-hint">นับของที่ส่งให้ร้านจริง ถ้าไม่ครบให้ลดจำนวน</div>
          {countable.map((o) => {
            const exp = o.tms_unit_count ?? 0
            const n = countOf(o)
            const bill = o.tms_picking_list_no ?? o.order_no
            return (
              <div key={o.id} className={`tr-count-row${n !== exp ? ' is-off' : ''}`}>
                <div className="tr-count-label">
                  {o.goods_desc || bill}
                  <small>{bill} · สั่ง {exp} กล่อง</small>
                </div>
                <div className="tr-step">
                  <button type="button" aria-label={`ลดจำนวน ${bill}`} disabled={n <= 0} onClick={() => setCounted(o, n - 1)}>−</button>
                  <span aria-live="polite" aria-label={`ส่งจริง ${n} กล่อง`}>{n}</span>
                  <button type="button" aria-label={`เพิ่มจำนวน ${bill}`} onClick={() => setCounted(o, n + 1)}>+</button>
                </div>
              </div>
            )
          })}
          <div className={`tr-count-sum${countedSum !== expectedSum ? ' is-off' : ''}`} role="status">
            ส่งจริง <b>{countedSum}</b> จาก {expectedSum} กล่อง
            {countedSum < expectedSum && ' · ส่งไม่ครบ ระบบจะบันทึกไว้ในหมายเหตุ'}
            {countedSum > expectedSum && ' · เกินยอดสั่ง ระบบจะบันทึกไว้ในหมายเหตุ'}
          </div>
        </section>
      )}
      {canProgress && stop.pending.length > 0 && locked && (
        <Button size="lg" className="dv-cta btn pri" loading={busy} onClick={() => {
          countable.forEach((o) => setCount(o.id, o.tms_picking_list_no ?? o.order_no, o.tms_unit_count ?? 0, countOf(o)))
          onDeliver(stop)
        }}>
          ส่งของ · เซ็นรับ + ถ่ายรูป{bills > 1 ? ` (${stop.pending.length} ใบ)` : ''}
        </Button>
      )}
      {canPod && stop.done && stop.needPod.length > 0 && (
        <Button size="lg" className="dv-cta btn pri" onClick={() => onPod(stop)}>เก็บหลักฐานการส่งมอบ</Button>
      )}

      {canProgress && onCancelStop && stop.pending.length > 0 && !stop.cancelled && (
        <button type="button" className="tr-danger-link" onClick={() => onCancelStop(stop)}>
          ส่งไม่ได้ / ร้านยกเลิก
        </button>
      )}
    </li>
  )
}
