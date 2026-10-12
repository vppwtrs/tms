import { Button } from '../ui'
import { IconCheck, IconPhone, IconPin } from '../icons'
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

  if (!open) {
    return (
      <li className={`stop-item dv-row ${state}`}>
        <button type="button" className="dv-row-btn" onClick={onOpen} aria-label={`จุดที่ ${index} ${stop.destination}`}>
          <span className="dv-seq" aria-hidden="true">{stop.done ? <IconCheck size={15} /> : stop.cancelled ? '×' : index}</span>
          <span className="dv-row-name">{name}</span>
          <span className="dv-row-meta">
            {stop.done ? (stop.needPod.length === 0 ? 'ส่งแล้ว' : 'ยังไม่เก็บหลักฐาน')
              : stop.cancelled ? 'ยกเลิก' : fmtTime(stop.scheduled_at)}
          </span>
        </button>
      </li>
    )
  }

  const tag = locked ? 'อยู่ที่ร้านนี้'
    : stop.done ? 'ส่งแล้ว'
    : stop.cancelled ? 'ยกเลิก'
    : isNext ? `จุดต่อไป · ร้านที่ ${index}` : `ร้านที่ ${index}`

  return (
    <li className={`stop-item dv-card dv-stop ${state}${locked ? ' is-locked' : ''}`}>
      <div className="dv-stop-top">
        <span className={`dv-chip ${locked ? 'is-here' : stop.done ? 'is-ok' : stop.cancelled ? 'is-bad' : 'is-info'}`}>{tag}</span>
        {stop.scheduled_at && <span className="dv-chip is-time">{fmtTime(stop.scheduled_at)}</span>}
        {locked && onExitLock && (
          <button type="button" className={`dv-mini${switchArmed ? ' is-armed' : ''}`} onClick={onExitLock}>
            {switchArmed ? 'แตะอีกครั้งเพื่อออก' : 'เปลี่ยนร้าน'}
          </button>
        )}
      </div>

      <h2 className="dv-stop-name">{name}</h2>
      {stop.customer_address && <p className="dv-stop-addr">{stop.customer_address}</p>}

      {/* ใบของร้านนี้ — เลขที่ใบต้องอ่านให้ทางโทรศัพท์ได้ทันที */}
      <ul className="dv-bills" aria-label={`ใบเบิกของ ${name}`}>
        {stop.orders.map((o) => (
          <li key={o.id} className={`stop-bill${o.status === 'delivered' ? ' is-done' : ''}`}>
            <span className="dv-bill-goods">{o.goods_desc || '—'}</span>
            <span className="dv-bill-no">{o.tms_picking_list_no ?? o.order_no}</span>
            {o.has_pod > 0 && onViewPod && (
              <button type="button" className="dv-link" onClick={() => onViewPod(o)}>ดูหลักฐาน</button>
            )}
          </li>
        ))}
      </ul>

      {/* หมายเหตุที่คนพิมพ์เอง — หมายเหตุที่ระบบเขียนตอนนำเข้าไม่ต้องขึ้น */}
      {stop.orders.map((o) => (o.notes && !o.notes.startsWith('นำเข้าจาก TMS') ? (
        <p className="dv-note is-info" key={o.id}>หมายเหตุ: {o.notes}</p>
      ) : null))}

      {stop.cancelled && (
        <p className="dv-note is-bad" role="status">
          ยกเลิกแล้ว — {stop.orders.find((o) => o.cancel_reason)?.cancel_reason ?? 'ไม่ได้บันทึกเหตุผล'}
        </p>
      )}

      {!stop.cancelled && (
        <div className="dv-stop-acts">
          {stop.customer_phone ? (
            <a className="dv-btn-out" href={`tel:${stop.customer_phone}`}><IconPhone size={20} /> โทร</a>
          ) : (
            <span className="dv-btn-out is-disabled" aria-disabled="true"><IconPhone size={20} /> ไม่มีเบอร์</span>
          )}
          <a className="dv-btn-out" href={mapsUrl(stop)} target="_blank" rel="noreferrer"><IconPin size={20} /> นำทาง</a>
        </div>
      )}

      {/* ปุ่มหลักของร้าน — สองจังหวะ: เข้าร้าน (กดผิดก็แค่ออก) แล้วจึงปิดจุด (ย้อนยาก) */}
      {canProgress && stop.pending.length > 0 && !locked && onEnter && (
        <Button size="lg" className="dv-cta" onClick={onEnter}>ถึงร้านแล้ว เริ่มส่งของ</Button>
      )}
      {canProgress && stop.pending.length > 0 && locked && (
        <Button size="lg" className="dv-cta" loading={busy} onClick={() => onDeliver(stop)}>
          ส่งของ · เซ็นรับ + ถ่ายรูป{bills > 1 ? ` (${stop.pending.length} ใบ)` : ''}
        </Button>
      )}
      {canPod && stop.done && stop.needPod.length > 0 && (
        <Button size="lg" className="dv-cta" onClick={() => onPod(stop)}>เก็บหลักฐานการส่งมอบ</Button>
      )}

      {canProgress && onCancelStop && stop.pending.length > 0 && !stop.cancelled && (
        <button type="button" className="dv-danger-link" onClick={() => onCancelStop(stop)}>
          ส่งไม่ได้ / ร้านยกเลิก
        </button>
      )}
    </li>
  )
}
