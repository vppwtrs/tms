import { Button } from '../ui'
import { IconCheck, IconPhone, IconPin } from '../icons'
import { fmtTime } from '../../utils/format'
import type { StopGroup } from '../../utils/stops'
import type { MyJobOrder } from '../../types'

/** ลิงก์นำทาง — ใช้ที่อยู่ลูกค้าก่อน ถ้าไม่มีค่อยใช้ชื่อปลายทาง */
function mapsUrl(stop: StopGroup): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.customer_address ?? stop.destination)}`
}

/**
 * จุดส่งหนึ่งจุด = หนึ่งร้าน — ย่อเป็นแถว กางเมื่อถูกเลือก
 *
 * ทุกจุดอยู่บนจอพร้อมกันเสมอ เพราะลำดับจริงไม่ได้เดินตามเอกสาร คนขับแวะร้าน 2
 * ก่อนร้าน 1 ได้ตลอด ถ้าต้องเปิดแผ่นซ้อนก่อนถึงจะสลับจุดได้ ก็คือเพิ่มการกด
 * ให้กับสิ่งที่เกิดขึ้นทุกวัน แอปส่งของที่ใช้งานจริงจึงวางเป็นรายการเสมอ
 *
 * ใบเบิกหลายใบของร้านเดียวถูกยุบมาอยู่ในจุดเดียว และปิดพร้อมกันด้วยการกดครั้งเดียว
 * ที่หน้าร้านคนขับส่งของทั้งกองในรอบเดียว การให้กดปิดทีละใบคือให้เขานับเอกสาร
 * แทนที่จะบอกว่า "ร้านนี้เสร็จแล้ว"
 *
 * ปุ่มของจุดอยู่ในจุดนั้น ไม่ยกไปไว้ล่างจอ — ล่างจอสงวนไว้ให้คำสั่งระดับเที่ยว
 * จะได้ไม่มีวันกดปิดจุดผิดจุด
 */
export function StopItem({
  stop,
  index,
  open,
  busy,
  canProgress,
  canPod,
  locked = false,
  onOpen,
  onEnter,
  onPod,
  onViewPod,
  onDeliver,
  onUndoDeliver,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  stop: StopGroup
  /** ลำดับที่แสดง (เริ่มที่ 1) */
  index: number
  open: boolean
  busy: boolean
  canProgress: boolean
  canPod: boolean
  /** จุดนี้คือจุดที่คนขับ "เข้าไป" อยู่ — ปุ่มปิดจุดขึ้นเฉพาะตอนนี้เท่านั้น */
  locked?: boolean
  onOpen: () => void
  /* เข้าร้านนี้ (ล็อกจอไว้ที่ร้านเดียว) — ไม่ส่งมา = เข้าไม่ได้ตอนนี้
     (ยังไม่ออกจากคลัง อยู่ในร้านอื่นอยู่ หรือเป็นจอที่ดูอย่างเดียว) */
  onEnter?: () => void
  onPod: (stop: StopGroup) => void
  /* เปิดดูหลักฐานที่เก็บไปแล้ว — คนขับต้องตรวจได้ว่าที่ส่งไปคือของจริง
     ไม่ส่งมา = หน้าจอที่ยังไม่มีตัวอ่าน (ฝั่ง LAN) ปุ่มจะไม่ขึ้น */
  onViewPod?: (order: MyJobOrder) => void
  onDeliver: (stop: StopGroup) => void
  /* ถอนการปิดส่งที่กดผิด — ไม่ส่งมา = ปุ่มไม่ขึ้น (จอฝั่ง LAN ที่ยังไม่มีตัวเรียก) */
  onUndoDeliver?: (stop: StopGroup) => void
  /* ลำดับการแวะเป็นของคนขับ ปุ่มขึ้น/ลงแทนการลาก — ลากในรถที่สั่นแล้วพลาดง่าย */
  onMove?: (stop: StopGroup, dir: -1 | 1) => void
  canMoveUp?: boolean
  canMoveDown?: boolean
}): React.JSX.Element {
  const state = stop.done ? 'is-done' : stop.cancelled ? 'is-cancelled' : 'is-todo'
  const bills = stop.orders.length

  return (
    <li className={`stop-item ${state}${open ? ' is-open' : ''}${locked ? ' is-locked' : ''}`}>
      <button
        type="button"
        className="stop-item-head"
        onClick={onOpen}
        /* อยู่ในร้านนี้แล้ว หัวการ์ดยุบไม่ได้ — ยุบได้คือเปิดทางให้จอว่างเปล่า
           ทั้งที่คนขับยืนอยู่หน้าร้าน */
        disabled={locked}
        aria-expanded={open}
        aria-label={`จุดที่ ${index} ${stop.destination}`}
      >
        <span className="stop-item-seq" aria-hidden="true">
          {stop.done ? <IconCheck size={15} /> : index}
        </span>
        <span className="stop-item-text">
          <span className="stop-item-dest">{stop.customer_name ?? stop.destination}</span>
          <span className="stop-item-sub">
            {fmtTime(stop.scheduled_at)}
            {/* บอกจำนวนใบตั้งแต่ตอนย่อ — คนขับต้องรู้ว่าร้านนี้ต้องยกของกี่กอง */}
            {bills > 1 ? ` · ${bills} ใบ` : ''}
            {stop.unit_count ? ` · ${stop.unit_count} หน่วย` : ''}
            {stop.done && (stop.needPod.length === 0 ? ' · เก็บหลักฐานแล้ว' : ' · ยังไม่เก็บหลักฐาน')}
          </span>
        </span>
      </button>

      {open && (
        <div className="stop-item-body">
          {/* สองปุ่มที่ใช้บ่อยที่สุดตอนถึงหน้าร้าน อยู่บนสุดของจุดที่กางอยู่ */}
          <div className="stop-item-actions">
            {stop.customer_phone ? (
              <a className="btn btn-outline btn-lg" href={`tel:${stop.customer_phone}`}>
                <IconPhone size={18} /> โทรหาผู้รับ
              </a>
            ) : (
              <span className="stop-item-nophone">ไม่มีเบอร์ผู้รับ</span>
            )}
            <a className="btn btn-outline btn-lg" href={mapsUrl(stop)} target="_blank" rel="noreferrer">
              <IconPin size={18} /> นำทาง
            </a>
          </div>

          {/* สองจังหวะ ไม่ใช่จังหวะเดียว — "ถึงร้านนี้แล้ว" กดตอนรถจอด (กดผิดก็แค่กลับออกมา)
              ส่วน "ส่งร้านนี้เสร็จแล้ว" ซึ่งเป็นการกดที่ย้อนยาก ขึ้นได้เฉพาะตอนอยู่ในร้านนั้น
              ตอนนั้นบนจอไม่มีร้านอื่นให้กดผิดอยู่แล้ว */}
          {canProgress && stop.pending.length > 0 && !locked && onEnter && (
            <Button size="lg" className="stop-item-cta" onClick={onEnter}>
              รับงานร้านนี้
            </Button>
          )}
          {canProgress && stop.pending.length > 0 && locked && (
            <Button size="lg" className="stop-item-cta" loading={busy} onClick={() => onDeliver(stop)}>
              ส่งร้านนี้เสร็จแล้ว{bills > 1 ? ` (${stop.pending.length} ใบ)` : ''}
            </Button>
          )}
          {canPod && stop.done && stop.needPod.length > 0 && (
            <Button size="lg" className="stop-item-cta" onClick={() => onPod(stop)}>
              เก็บหลักฐานการส่งมอบ
            </Button>
          )}

          {/* กางการ์ดผิดร้านแล้วกดปิดส่งเป็นเรื่องที่เกิดขึ้นจริง เคยมีใบที่ขึ้นว่า
              ส่งแล้วทั้งที่รถยังไม่ไปถึงร้านนั้นด้วยซ้ำ
              ปุ่มเล็กและจาง ไม่วางคู่กับปุ่มปิดส่ง — ปุ่มถอยที่เด่นเท่าปุ่มเดินหน้า
              คือปุ่มที่จะถูกกดผิดเป็นอันดับต่อไป
              ขึ้นเฉพาะจุดที่ยังไม่มีหลักฐาน จุดที่เซ็นแล้วต้องให้ออฟฟิศแก้ */}
          {canProgress && onUndoDeliver && stop.done && stop.needPod.length === stop.orders.length && (
            <Button
              variant="ghost"
              size="sm"
              className="stop-item-undo"
              onClick={() => onUndoDeliver(stop)}
            >
              กดผิดร้าน — ยกเลิกการส่ง
            </Button>
          )}

          <dl className="stop-item-facts">
            {stop.customer_address && (
              <div>
                <dt>ที่อยู่</dt>
                <dd>{stop.customer_address}</dd>
              </div>
            )}
          </dl>

          {/* ใบของร้านนี้ทั้งหมด — เลขที่คลังกับร้านใช้อ้างถึงใบนี้ ต้องอ่านให้ทางโทรศัพท์
              ได้ทันที ไม่ใช่ต้องเปิด TMS อีกจอตอนยืนอยู่หน้าร้าน */}
          <ul className="stop-bills" aria-label={`ใบเบิกของ ${stop.customer_name ?? stop.destination}`}>
            {stop.orders.map((o) => (
              <li key={o.id} className={`stop-bill${o.status === 'delivered' ? ' is-done' : ''}`}>
                <span className="stop-bill-no">{o.tms_picking_list_no ?? o.order_no}</span>
                <span className="stop-bill-goods">{o.goods_desc}</span>
                <span className="stop-bill-qty">{o.tms_unit_count ? `${o.tms_unit_count} หน่วย` : '—'}</span>
                {/* หลักฐานที่เก็บแล้วต้องเปิดดูย้อนได้ ไม่งั้นคนขับที่ถูกถามว่า
                    "ร้านนี้ใครเซ็น" ตอบไม่ได้ทั้งที่เป็นคนถือมือถือถ่ายเอง */}
                {o.has_pod > 0 && onViewPod && (
                  <button type="button" className="stop-bill-pod" onClick={() => onViewPod(o)}>
                    ดูหลักฐาน
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* หมายเหตุที่ระบบเขียนเองตอนนำเข้า ("นำเข้าจาก TMS · PL … · เที่ยว …") ไม่ต้องขึ้น
              เลข PL เลขเที่ยว และจำนวนหน่วย อยู่บนจอนี้อยู่แล้วทั้งหมด
              เหลือแต่หมายเหตุที่คนพิมพ์เอง ซึ่งเป็นสิ่งเดียวที่คนขับต้องอ่านจริง */}
          {stop.orders.map((o) => (o.notes && !o.notes.startsWith('นำเข้าจาก TMS') ? (
            <p className="stop-item-note" key={o.id}>หมายเหตุ: {o.notes}</p>
          ) : null))}

          {onMove && !stop.done && (
            <div className="stop-item-move">
              <span className="stop-item-move-label">ลำดับการแวะ</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`เลื่อน ${stop.destination} ขึ้นก่อน`}
                disabled={!canMoveUp}
                onClick={() => onMove(stop, -1)}
              >
                ขึ้น
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`เลื่อน ${stop.destination} ไปทีหลัง`}
                disabled={!canMoveDown}
                onClick={() => onMove(stop, 1)}
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
