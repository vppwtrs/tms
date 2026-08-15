import { useEffect } from 'react'
import type { BolDocument } from '../types'
import { Button, Modal } from './ui'
import { fmtDate, fmtDateTime, fmtMoney, fmtRoute, fmtWeightHuman } from '../utils/format'
import { IconPrinter } from './icons'

/** ใบนำส่ง (BOL) — เอกสาร A4 พิมพ์ได้ กดปุ่มแล้วสั่งพิมพ์ผ่านเบราว์เซอร์ */
export function BolModal({ doc, onClose }: { doc: BolDocument; onClose: () => void }): React.JSX.Element {
  /* บอก print CSS ว่ากำลังจะพิมพ์ "ใบนำส่ง" ไม่ใช่หน้าเว็บทั่วไป
     — เฉพาะตอนที่โมดัลนี้เปิดอยู่เท่านั้นที่ซ่อนทุกอย่างนอกเอกสาร */
  useEffect(() => {
    document.body.classList.add('printing-bol')
    return () => document.body.classList.remove('printing-bol')
  }, [])

  const vehicleType: Record<string, string> = {
    pickup: 'รถกระบะ',
    truck6: 'รถหกล้อ',
    truck10: 'รถสิบล้อ',
    reefer: 'รถห้องเย็น',
    van: 'รถตู้',
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`ใบนำส่ง ${doc.order_no}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>ปิด</Button>
          <Button variant="accent" icon={<IconPrinter size={15} />} onClick={() => window.print()}>
            พิมพ์ใบนำส่ง
          </Button>
        </>
      }
    >
      <div className="bol-print-area">
        <div className="bol-doc">
          <div className="bol-head">
            <div>
              <div className="bol-org">{doc.org.org_name}</div>
              <div className="bol-title">ใบนำส่งสินค้า (BOL)</div>
            </div>
            <div className="bol-no">
              <div>เลขที่: <b>{doc.order_no}</b></div>
              <div className="bol-sub">ออกเอกสาร {fmtDateTime(doc.created_at)}</div>
            </div>
          </div>

          <div className="bol-cols">
            <div className="bol-col">
              <div className="bol-sec">ผู้รับ / ลูกค้า</div>
              <table className="bol-table">
                <tbody>
                  <tr><th>ชื่อ</th><td>{doc.customer_name ?? '—'}</td></tr>
                  <tr><th>ที่อยู่</th><td>{doc.customer_address ?? '—'}</td></tr>
                  <tr><th>ผู้ติดต่อ</th><td>{doc.customer_contact ?? '—'}</td></tr>
                  <tr><th>โทรศัพท์</th><td>{doc.customer_phone ?? '—'}</td></tr>
                  <tr><th>เลขผู้เสียภาษี</th><td>{doc.customer_tax_id ?? '—'}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="bol-col">
              <div className="bol-sec">รถบรรทุก / พนักงานขับ</div>
              <table className="bol-table">
                <tbody>
                  <tr><th>ทะเบียนรถ</th><td>{doc.vehicle_plate ?? '—'}</td></tr>
                  <tr><th>ประเภทรถ</th><td>{doc.vehicle_plate ? (vehicleType[doc.vehicle_type ?? ''] ?? doc.vehicle_type ?? '—') : '—'}</td></tr>
                  <tr><th>พนักงานขับ</th><td>{doc.driver_name ?? '—'}</td></tr>
                  <tr><th>โทรศัพท์คนขับ</th><td>{doc.driver_phone ?? '—'}</td></tr>
                  <tr><th>เลขที่เที่ยว</th><td>{doc.trip_no ?? 'ยังไม่จัดคิว'}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="bol-route">
            <div className="bol-sec">เส้นทางขนส่ง</div>
            <div className="bol-route-line">
              <b>{doc.origin}</b> <span className="bol-arrow">→</span> <b>{doc.destination}</b>
              <span className="bol-muted">{fmtRoute(doc.distance_km)}</span>
            </div>
            <div className="bol-muted">กำหนดส่ง: {fmtDate(doc.scheduled_at)}</div>
          </div>

          <table className="bol-table bol-goods">
            <thead>
              <tr><th>รายละเอียดสินค้า</th><th className="num">น้ำหนัก</th><th className="num">ค่าขนส่ง</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>{doc.goods_desc}</td>
                <td className="num">{fmtWeightHuman(doc.weight_kg)}</td>
                <td className="num">{fmtMoney(doc.fee, doc.org.currency_symbol)}</td>
              </tr>
            </tbody>
          </table>

          {doc.notes && (
            <div className="bol-notes">
              <span className="bol-sec">หมายเหตุ:</span> {doc.notes}
            </div>
          )}

          <div className="bol-sign">
            <div>
              <div className="bol-sign-line" />
              <div className="bol-sign-label">ลายเซ็นผู้ส่ง</div>
            </div>
            <div>
              <div className="bol-sign-line" />
              <div className="bol-sign-label">ลายเซ็นผู้รับ</div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
