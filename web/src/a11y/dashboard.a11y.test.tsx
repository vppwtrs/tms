import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../test/axe'
import App from '../App'
import { AuthProvider } from '../context/AuthContext'
import { ToastProvider } from '../context/ToastContext'
import { TOKEN_KEY } from '../api/client'
import type { DashboardSummary } from '../types'

const SUMMARY: DashboardSummary = {
  kpis: {
    orders_today: 3,
    in_transit: 2,
    delivered_month: 15,
    revenue_month: 116000,
    pending: 4,
    urgent_unassigned: 1,
    overdue: 2,
  },
  trend: Array.from({ length: 14 }, (_, i) => ({
    d: `2026-08-${String(i + 1).padStart(2, '0')}`,
    count: 1 + (i % 3),
    revenue: 8000 + i * 500,
  })),
  orders_by_status: [
    { status: 'pending', count: 4 },
    { status: 'in_transit', count: 2 },
    { status: 'delivered', count: 15 },
  ],
  vehicles_by_status: [
    { status: 'available', count: 3 },
    { status: 'in_transit', count: 2 },
    { status: 'maintenance', count: 1 },
  ],
  drivers_by_status: [
    { status: 'available', count: 2 },
    { status: 'in_transit', count: 2 },
    { status: 'off_duty', count: 1 },
  ],
  alerts: {
    urgent_unassigned: [
      { id: 1, order_no: 'ORD-2026-0065', destination: 'ชลบุรี', scheduled_at: '2026-08-10T09:00:00+07:00' },
    ],
    overdue: [
      { id: 2, order_no: 'ORD-2026-0063', destination: 'พิษณุโลก', scheduled_at: '2026-08-12T21:00:00+07:00' },
    ],
  },
  recent_orders: [
    { id: 1, order_no: 'ORD-2026-0074', destination: 'เชียงใหม่', status: 'in_transit', created_at: '2026-08-11T08:30:00+07:00' },
    { id: 2, order_no: 'ORD-2026-0073', destination: 'สงขลา', status: 'delivered', created_at: '2026-08-11T07:15:00+07:00' },
  ],
}

/** สิทธิ์ของ admin เท่าที่หน้านี้ต้องใช้ — เมนูและหน้าแรกอ่านจากตรงนี้ */
const ADMIN_PERMS = [
  'dashboard.view', 'orders.view', 'dispatch.view', 'quotes.view', 'customers.view',
  'vehicles.view', 'drivers.view', 'reports.view', 'csv.view', 'users.manage', 'settings.manage',
]

const json = (body: unknown, status = 200): Response =>
  ({ ok: status < 400, status, json: async () => body }) as Response

/** แอปทั้งระบบ (Layout + Dashboard) ผ่าน API จำลอง — ตรวจโครงสร้างจริงของหน้าที่ render ครบ */
describe('a11y · full app (dashboard)', () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, 'test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/auth/me')) {
          /* ต้องมี permissions ด้วย — หน้าแรกเลือกจากสิทธิ์ ไม่ใช่จากบทบาท
             ถ้าไม่ส่งมา แอปจะพาไปหน้าอื่นแล้วเทสหา element ของ dashboard ไม่เจอ */
          return json({
            data: {
              id: 1,
              username: 'admin',
              name: 'ผู้ดูแลระบบ',
              role: 'admin',
              permissions: ADMIN_PERMS,
            },
          })
        }
        if (url.includes('/api/dashboard/summary')) {
          return json({ data: SUMMARY })
        }
        if (url.includes('/api/insights/daily')) {
          return json({
            data: {
              headline: 'วันนี้โฟกัสออเดอร์ด่วน 1 ใบก่อน — จัดคิวให้เสร็จภายในช่วงเช้า',
              items: [
                { tone: 'danger', title: 'ออเดอร์เลยกำหนด', detail: 'มีออเดอร์เลยกำหนดส่ง 2 ใบที่ยังไม่จัดคิว', action: { label: 'ไปจัดการ', to: '/dispatch' } },
                { tone: 'warn', title: 'ใบเสนอราคาใกล้หมดอายุ', detail: '1 ใบจะหมดอายุภายใน 3 วัน', action: { label: 'ติดตาม', to: '/quotes' } },
                { tone: 'success', title: 'ส่งสำเร็จวันนี้', detail: 'ส่งของครบ 3 เที่ยว · รายได้ 45,000 บาท' },
              ],
              generated_at: new Date().toISOString(),
            },
          })
        }
        return json({ error: { message: 'not found' } }, 404)
      }),
    )
  })

  it('dashboard + sidebar + bento ไม่มี axe violation', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>,
    )

    // รอให้ข้อมูลโหลดจริง (hero + ตารางออเดอร์ล่าสุด + การ์ด AI สรุปประจำวัน)
    expect(await screen.findByText('รายได้เดือนนี้')).toBeTruthy()
    expect(await screen.findByText('ORD-2026-0074')).toBeTruthy()
    expect(await screen.findByText('AI สรุปประจำวัน')).toBeTruthy()
    expect(await screen.findByText('ออเดอร์เลยกำหนด')).toBeTruthy()

    await expectNoAxeViolations()
  })
})
