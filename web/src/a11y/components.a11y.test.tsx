import { useState } from 'react'
import { render } from '@testing-library/react'
import { describe, it } from 'vitest'
import { expectNoAxeViolations } from '../test/axe'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatCard,
  Textarea,
} from '../components/ui'
import { BolModal } from '../components/BolModal'
import { IconPencil, IconTruck, IconX } from '../components/icons'

const SAMPLE_BOL = {
  org: { org_name: 'บริษัท ขนส่ง จำกัด', currency_code: 'THB', currency_symbol: '฿' },
  id: 1,
  order_no: 'ORD-2026-0001',
  customer_name: 'บริษัท ตัวอย่าง จำกัด',
  customer_address: 'ถนนสุขุมวิท กรุงเทพฯ',
  customer_contact: 'คุณสมชาย',
  customer_phone: '081-234-5678',
  customer_tax_id: '1234567890123',
  origin: 'กรุงเทพฯ',
  destination: 'ชลบุรี',
  distance_km: 130,
  goods_desc: 'เครื่องใช้ไฟฟ้า',
  weight_kg: 1200,
  fee: 2500,
  status: 'assigned' as const,
  priority: 'normal' as const,
  scheduled_at: '2026-09-01T09:00:00.000Z',
  delivered_at: null,
  notes: 'โทรก่อนถึงปลายทาง',
  trip_no: 'TRP-2026-0001',
  vehicle_id: 9,
  vehicle_plate: 'กข 1234',
  vehicle_type: 'truck6',
  driver_name: 'นายใจดี',
  driver_phone: '089-999-9999',
  created_at: '2026-08-12T09:00:00.000Z',
}

/** รวมทุกคอมโพเนนต์หลักของ design system ไว้หน้าเดียว — ตรวจ WCAG โครงสร้าง/ARIA/ชื่อป้าย */
function KitchenSink(): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <PageHeader
        title="ทดสอบคอมโพเนนต์"
        subtitle="kitchen sink สำหรับตรวจ accessibility"
        actions={
          <>
            <Button variant="accent" icon={<IconTruck size={15} />}>สร้างใหม่</Button>
            <Button variant="outline">ส่งออก</Button>
          </>
        }
      />

      <div>
        <Button>หลัก</Button>
        <Button variant="accent">เน้น</Button>
        <Button variant="outline">รอง</Button>
        <Button variant="ghost">เงียบ</Button>
        <Button variant="danger">ลบ</Button>
        <Button variant="success">สำเร็จ</Button>
        <Button disabled>ปิดใช้</Button>
        <Button loading>กำลังโหลด</Button>
        <Button aria-label="แก้ไข"><IconPencil size={15} /></Button>
        <Button variant="ghost" size="sm" aria-label="ปิด"><IconX size={15} /></Button>
      </div>

      <div>
        <Badge label="รอจัดคิว" />
        <Badge label="จัดคิวแล้ว" tone="assigned" dot />
        <Badge label="กำลังขนส่ง" tone="in_transit" dot />
        <Badge label="ส่งสำเร็จ" tone="delivered" dot />
        <Badge label="ยกเลิก" tone="cancelled" />
        <Badge label="ด่วน" tone="urgent" dot />
      </div>

      <div className="form-grid">
        <Field label="ชื่อลูกค้า" required hint="เช่น บริษัท ตัวอย่าง จำกัด">
          <Input placeholder="พิมพ์ชื่อ..." />
        </Field>
        <Field label="เบอร์โทร">
          <Input type="tel" placeholder="08x-xxx-xxxx" />
        </Field>
        <Field label="ประเภท" required error="กรุณาเลือกประเภท">
          <Select>
            <option value="">เลือก...</option>
            <option value="a">แบบ ก</option>
            <option value="b">แบบ ข</option>
          </Select>
        </Field>
        <Field label="รายละเอียด">
          <Textarea placeholder="หมายเหตุ..." />
        </Field>
        <Field label="ค้นหา">
          <SearchInput value="" onChange={() => undefined} placeholder="ค้นหาออเดอร์..." />
        </Field>
      </div>

      <StatCard
        label="รายได้เดือนนี้"
        value={11600}
        symbol="฿"
        icon={<IconTruck size={18} />}
        tone="success"
        trend={{ dir: 'up', text: '59% เพิ่ม เทียบ 7 วันก่อน' }}
      />

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>เลขที่</th>
              <th className="num">น้ำหนัก</th>
              <th className="num">ค่าขนส่ง</th>
              <th>สถานะ</th>
              <th className="actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-strong">ORD-2026-0001</td>
              <td className="num">1,200 กก.</td>
              <td className="num">3,500 ฿</td>
              <td><Badge label="กำลังขนส่ง" tone="in_transit" dot /></td>
              <td className="actions">
                <Button variant="ghost" size="sm" aria-label="แก้ไขออเดอร์"><IconPencil size={14} /></Button>
                <Button variant="ghost" size="sm" aria-label="ลบออเดอร์"><IconX size={14} /></Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <Pagination page={2} totalPages={5} total={48} onChange={() => undefined} />
      <EmptyState icon="📦" title="ยังไม่มีออเดอร์" desc="สร้างออเดอร์แรกเพื่อเริ่มใช้งาน" />

      <Modal open={open} onClose={() => setOpen(false)} title="สร้างออเดอร์" footer={<Button>บันทึก</Button>}>
        <Field label="ปลายทาง" required>
          <Input placeholder="จังหวัด..." />
        </Field>
      </Modal>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="ยืนยันการลบ"
        message="ต้องการลบออเดอร์นี้หรือไม่?"
        danger
        onConfirm={() => undefined}
      />

      <BolModal doc={SAMPLE_BOL} onClose={() => undefined} />
    </div>
  )
}

describe('a11y · design system components', () => {
  it('ปุ่ม/ป้าย/ฟอร์ม/ตาราง/โมดัล ไม่มี axe violation', async () => {
    render(<KitchenSink />)
    await expectNoAxeViolations()
  })
})
