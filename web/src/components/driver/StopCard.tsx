import { Badge, Button } from '../ui'
import { IconCheck, IconPhone, IconPin } from '../icons'
import { ORDER_STATUS_LABEL } from '../../utils/constants'
import { fmtDateTime, fmtWeightHuman } from '../../utils/format'
import type { MyJobOrder } from '../../types'

/** ลิงก์นำทาง — ใช้ที่อยู่ลูกค้าก่อน ถ้าไม่มีค่อยใช้ชื่อปลายทาง */
function mapsUrl(order: MyJobOrder): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.customer_address ?? order.destination)}`
}

/**
 * จุดส่งที่กำลังจะไป — ตัวเดียวในจอที่ได้พื้นที่เต็ม
 *
 * ปลายทางตัวใหญ่สุดเพราะเป็นข้อมูลเดียวที่คนขับต้องอ่านตอนขับ
 * ปุ่มโทร/นำทางแบ่งครึ่งจอเท่ากัน สูง 56px — กดได้ทั้งที่ใส่ถุงมือและรถสั่น
 */
export function NextStop({
  order,
  canPod,
  canProgress,
  busy,
  onPod,
  onDeliver,
}: {
  order: MyJobOrder
  canPod: boolean
  canProgress: boolean
  busy: boolean
  onPod: (order: MyJobOrder) => void
  onDeliver: (order: MyJobOrder) => void
}): React.JSX.Element {
  return (
    <section className="stop-focus" aria-label="จุดส่งถัดไป">
      <div className="stop-focus-dest">{order.destination}</div>
      <div className="stop-focus-customer">{order.customer_name ?? 'ไม่ระบุลูกค้า'}</div>
      <div className="stop-focus-meta">
        นัดหมาย {fmtDateTime(order.scheduled_at)} · {order.goods_desc} · {fmtWeightHuman(order.weight_kg)}
      </div>
      {/* เลขที่คลังกับร้านใช้อ้างถึงใบนี้ — คนขับต้องอ่านให้ทางโทรศัพท์ได้ทันที
          ไม่ใช่ต้องเปิด TMS อีกจอตอนยืนอยู่หน้าร้าน */}
      {(order.tms_picking_list_no ?? order.tms_trip_no) && (
        <div className="stop-focus-meta">
          {order.tms_trip_no && <>เที่ยว {order.tms_trip_no}</>}
          {order.tms_picking_list_no && <> · PL {order.tms_picking_list_no}</>}
          {order.tms_unit_count ? <> · {order.tms_unit_count} หน่วย</> : null}
        </div>
      )}
      {order.notes && <div className="stop-focus-note">หมายเหตุ: {order.notes}</div>}

      <div className="stop-focus-actions">
        {order.customer_phone ? (
          <a className="btn btn-outline btn-lg" href={`tel:${order.customer_phone}`}>
            <IconPhone size={18} /> โทรหาผู้รับ
          </a>
        ) : (
          <span className="stop-focus-nophone">ไม่มีเบอร์ผู้รับ</span>
        )}
        <a className="btn btn-outline btn-lg" href={mapsUrl(order)} target="_blank" rel="noreferrer">
          <IconPin size={18} /> นำทาง
        </a>
      </div>

      {/* ปิดร้านนี้ทีละจุด — กดแล้วเด้งเข้าฟอร์ม POD ต่อทันที ไม่ต้องกดสองที
          เพราะที่หน้าร้านคนขับทำสองอย่างนี้ติดกันเสมอ */}
      {order.status === 'in_transit' && canProgress && (
        <Button size="lg" className="stop-focus-pod" loading={busy} onClick={() => onDeliver(order)}>
          ส่งจุดนี้เสร็จแล้ว
        </Button>
      )}

      {order.status === 'delivered' &&
        canPod &&
        (order.has_pod ? (
          <p className="job-pod-done">
            <IconCheck size={16} /> เก็บหลักฐานแล้ว
          </p>
        ) : (
          <Button size="lg" className="stop-focus-pod" onClick={() => onPod(order)}>
            เก็บหลักฐานการส่งมอบ
          </Button>
        ))}
    </section>
  )
}

/** จุดอื่นในเที่ยวเดียวกัน — ย่อเหลือบรรทัดเดียว กดเพื่อสลับมาโฟกัสได้ */
export function StopRow({
  order,
  active,
  onSelect,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  order: MyJobOrder
  active: boolean
  onSelect: (order: MyJobOrder) => void
  /* ลำดับการแวะเป็นของคนขับ ปุ่มขึ้น/ลงแทนการลาก — ลากในรถที่สั่นแล้วพลาดง่าย
     และนิ้วโป้งกดปุ่มสองปุ่มได้โดยไม่ต้องมองจอนาน */
  onMove?: (order: MyJobOrder, dir: -1 | 1) => void
  canMoveUp?: boolean
  canMoveDown?: boolean
}): React.JSX.Element {
  const done = order.status === 'delivered'
  return (
    <li className="stop-row-wrap">
      <button
        type="button"
        className={`stop-row${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
        onClick={() => onSelect(order)}
        aria-current={active ? 'true' : undefined}
      >
        <span className="stop-row-mark" aria-hidden="true">
          {done ? <IconCheck size={14} /> : null}
        </span>
        <span className="stop-row-dest">{order.destination}</span>
        <Badge label={ORDER_STATUS_LABEL[order.status]} tone={order.status} />
      </button>
      {onMove && !done && (
        <span className="stop-row-move">
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
        </span>
      )}
    </li>
  )
}
