import { Button } from '../ui'
import { IconCheck, IconPhone, IconPin } from '../icons'
import { fmtTime, fmtWeightHuman } from '../../utils/format'
import type { MyJobOrder } from '../../types'

/** ลิงก์นำทาง — ใช้ที่อยู่ลูกค้าก่อน ถ้าไม่มีค่อยใช้ชื่อปลายทาง */
function mapsUrl(order: MyJobOrder): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.customer_address ?? order.destination)}`
}

/**
 * จุดส่งหนึ่งจุดในรายการทั้งเที่ยว — ย่อเป็นแถว กางเมื่อถูกเลือก
 *
 * ทุกจุดอยู่บนจอพร้อมกันเสมอ เพราะลำดับจริงไม่ได้เดินตามเอกสาร คนขับแวะร้าน 2
 * ก่อนร้าน 1 ได้ตลอด ถ้าต้องเปิดแผ่นซ้อนก่อนถึงจะสลับจุดได้ ก็คือเพิ่มการกด
 * ให้กับสิ่งที่เกิดขึ้นทุกวัน แอปส่งของที่ใช้งานจริงจึงวางเป็นรายการเสมอ
 *
 * ปุ่มของจุดอยู่ในจุดนั้น ไม่ยกไปไว้ล่างจอ — ล่างจอสงวนไว้ให้คำสั่งระดับเที่ยว
 * จะได้ไม่มีวันกดปิดจุดผิดจุด
 */
export function StopItem({
  order,
  index,
  open,
  busy,
  canProgress,
  canPod,
  onOpen,
  onPod,
  onDeliver,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  order: MyJobOrder
  /** ลำดับที่แสดง (เริ่มที่ 1) */
  index: number
  open: boolean
  busy: boolean
  canProgress: boolean
  canPod: boolean
  onOpen: () => void
  onPod: (order: MyJobOrder) => void
  onDeliver: (order: MyJobOrder) => void
  /* ลำดับการแวะเป็นของคนขับ ปุ่มขึ้น/ลงแทนการลาก — ลากในรถที่สั่นแล้วพลาดง่าย */
  onMove?: (order: MyJobOrder, dir: -1 | 1) => void
  canMoveUp?: boolean
  canMoveDown?: boolean
}): React.JSX.Element {
  const done = order.status === 'delivered'
  const cancelled = order.status === 'cancelled'
  const state = done ? 'is-done' : cancelled ? 'is-cancelled' : 'is-todo'

  return (
    <li className={`stop-item ${state}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="stop-item-head"
        onClick={onOpen}
        aria-expanded={open}
        aria-label={`จุดที่ ${index} ${order.destination}`}
      >
        <span className="stop-item-seq" aria-hidden="true">
          {done ? <IconCheck size={15} /> : index}
        </span>
        <span className="stop-item-text">
          <span className="stop-item-dest">{order.destination}</span>
          <span className="stop-item-sub">
            {order.customer_name ?? 'ไม่ระบุลูกค้า'} · {fmtTime(order.scheduled_at)}
            {done && (order.has_pod ? ' · เก็บหลักฐานแล้ว' : ' · ยังไม่เก็บหลักฐาน')}
          </span>
        </span>
      </button>

      {open && (
        <div className="stop-item-body">
          {/* สองปุ่มที่ใช้บ่อยที่สุดตอนถึงหน้าร้าน อยู่บนสุดของจุดที่กางอยู่ */}
          <div className="stop-item-actions">
            {order.customer_phone ? (
              <a className="btn btn-outline btn-lg" href={`tel:${order.customer_phone}`}>
                <IconPhone size={18} /> โทรหาผู้รับ
              </a>
            ) : (
              <span className="stop-item-nophone">ไม่มีเบอร์ผู้รับ</span>
            )}
            <a className="btn btn-outline btn-lg" href={mapsUrl(order)} target="_blank" rel="noreferrer">
              <IconPin size={18} /> นำทาง
            </a>
          </div>

          {/* ปุ่มของจุดนี้ ติดกับชื่อจุดนี้ ไม่มีทางกดผิดจุด */}
          {canProgress && order.status === 'in_transit' && (
            <Button size="lg" className="stop-item-cta" loading={busy} onClick={() => onDeliver(order)}>
              ส่งจุดนี้เสร็จแล้ว
            </Button>
          )}
          {canPod && done && !order.has_pod && (
            <Button size="lg" className="stop-item-cta" onClick={() => onPod(order)}>
              เก็บหลักฐานการส่งมอบ
            </Button>
          )}

          <dl className="stop-item-facts">
            <div>
              <dt>สินค้า</dt>
              <dd>
                {order.goods_desc} · {fmtWeightHuman(order.weight_kg)}
                {order.tms_unit_count ? ` · ${order.tms_unit_count} หน่วย` : ''}
              </dd>
            </div>
            {order.customer_address && (
              <div>
                <dt>ที่อยู่</dt>
                <dd>{order.customer_address}</dd>
              </div>
            )}
            {/* เลขที่คลังกับร้านใช้อ้างถึงใบนี้ — ต้องอ่านให้ทางโทรศัพท์ได้ทันที
                ไม่ใช่ต้องเปิด TMS อีกจอตอนยืนอยู่หน้าร้าน */}
            {(order.tms_picking_list_no ?? order.tms_trip_no) && (
              <div>
                <dt>เลขอ้างอิง</dt>
                <dd>
                  {order.tms_picking_list_no ?? order.tms_trip_no}
                </dd>
              </div>
            )}
          </dl>

          {order.notes && <p className="stop-item-note">หมายเหตุ: {order.notes}</p>}

          {onMove && !done && (
            <div className="stop-item-move">
              <span className="stop-item-move-label">ลำดับการแวะ</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`เลื่อน ${order.destination} ขึ้นก่อน`}
                disabled={!canMoveUp}
                onClick={() => onMove(order, -1)}
              >
                ขึ้น
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`เลื่อน ${order.destination} ไปทีหลัง`}
                disabled={!canMoveDown}
                onClick={() => onMove(order, 1)}
              >
                ลง
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}
