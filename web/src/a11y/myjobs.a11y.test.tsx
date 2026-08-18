import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { expectNoAxeViolations } from '../test/axe'
import { JobFocus } from '../components/driver/JobFocus'
import { JobProgress } from '../components/driver/JobProgress'
import type { MyJob, MyJobOrder } from '../types'

function makeOrder(over: Partial<MyJobOrder> = {}): MyJobOrder {
  return {
    id: 1,
    order_no: 'ORD-2026-0001',
    trip_id: 1,
    status: 'in_transit',
    priority: 'normal',
    origin: 'กรุงเทพฯ',
    destination: 'นครราชสีมา',
    distance_km: 260,
    goods_desc: 'เครื่องใช้ไฟฟ้า',
    weight_kg: 3400,
    scheduled_at: '2026-08-13T08:03:00.000Z',
    tms_trip_no: null,
    tms_picking_list_no: null,
    tms_unit_count: null,
    seq: null,
    delivered_at: null,
    notes: null,
    customer_name: 'บริษัท ไทยฟู้ดส์ จำกัด',
    customer_phone: '081-234-5678',
    customer_address: 'ถนนมิตรภาพ นครราชสีมา',
    has_pod: 0,
    ...over,
  }
}

const JOB: MyJob = {
  id: 1,
  trip_no: 'TRP-2026-0059',
  status: 'in_progress',
  departed_at: '2026-08-13T05:00:00.000Z',
  arrived_at: null,
  notes: null,
  vehicle_plate: '9กก-0123',
  vehicle_type: 'truck6',
  accepted_at: '2026-08-13T04:55:00.000Z',
  issue_note: null,
  orders: [
    makeOrder({ id: 1, status: 'delivered', has_pod: 1 }),
    makeOrder({ id: 2, order_no: 'ORD-2026-0002', destination: 'ขอนแก่น' }),
  ],
  total_weight: 6800,
}

const noop = (): void => {}

describe('หน้าคนขับ — a11y', () => {
  it('งานที่กำลังทำ (JobFocus) ไม่มี violation', async () => {
    const { container } = render(
      <JobFocus job={JOB} busy={false} deliveringId={0} canProgress canPod onAct={noop} onPod={noop} onDeliver={noop} />,
    )
    await expectNoAxeViolations(container)
  })

  it('แถบขั้นตอนบอกขั้นปัจจุบันด้วย aria-current', async () => {
    const { container } = render(<JobProgress job={JOB} />)
    // คนขับที่ใช้ screen reader ต้องรู้ว่าอยู่ขั้นไหน ไม่ใช่รู้แค่ว่ามี 4 ขั้น
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
    await expectNoAxeViolations(container)
  })

  it('ยังส่งไม่ครบทุกจุด ปิดเที่ยวไม่ได้', () => {
    /* ถ้าปล่อยให้ปิดตอนนี้ จุดที่เหลือจะถูกเหมาเป็น "ส่งแล้ว" ทั้งที่ยังไม่ได้ไป
       แล้ว POD ของร้านเหล่านั้นก็ไม่มีใครเก็บ */
    const { container } = render(
      <JobFocus job={JOB} busy={false} deliveringId={0} canProgress canPod onAct={noop} onPod={noop} onDeliver={noop} />,
    )
    const cta = container.querySelector('.job-cta-bar button') as HTMLButtonElement
    expect(cta.disabled).toBe(true)
    expect(cta.textContent).toContain('เหลืออีก 1 จุด')
  })

  it('เที่ยวที่ปิดงานแล้วไม่แสดงปุ่มดำเนินการ', () => {
    const { container } = render(
      <JobFocus job={{ ...JOB, status: 'completed' }} busy={false} deliveringId={0} canProgress canPod onAct={noop} onPod={noop} onDeliver={noop} />,
    )
    expect(container.querySelector('.job-cta-bar')).toBeNull()
  })
})
