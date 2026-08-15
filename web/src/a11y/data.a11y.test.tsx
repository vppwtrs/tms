import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../test/axe'
import App from '../App'
import { AuthProvider } from '../context/AuthContext'
import { ToastProvider } from '../context/ToastContext'
import { TOKEN_KEY } from '../api/client'
import type { CsvStatus } from '../types'

const STATUS: CsvStatus = {
  csvDir: 'server/data/csv',
  autoSyncMs: 3000,
  tables: [
    { table: 'customers', file: '01_customers.csv', title: 'ลูกค้า', description: 'ข้อมูลลูกค้า + กลุ่ม + เครดิต', rows: 10, fileSize: 3532, lastExport: '2026-08-11T15:18:25.000Z', error: null },
    { table: 'orders', file: '05_orders.csv', title: 'ออเดอร์', description: 'งานขนส่งทั้งหมด', rows: 74, fileSize: 18009, lastExport: '2026-08-11T15:18:31.000Z', error: null },
    { table: 'vehicles', file: '02_vehicles.csv', title: 'รถยนต์', description: 'ทะเบียนรถและสถานะ', rows: 8, fileSize: 639, lastExport: null, error: null },
  ],
}

const json = (body: unknown, status = 200): Response =>
  ({ ok: status < 400, status, json: async () => body }) as Response

describe('a11y · หน้า ข้อมูล CSV', () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, 'test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/auth/me')) {
          return json({ data: { id: 1, username: 'admin', name: 'ผู้ดูแลระบบ', role: 'admin' } })
        }
        if (url.includes('/api/csv/status')) {
          return json({ data: STATUS })
        }
        return json({ error: { message: 'not found' } }, 404)
      }),
    )
  })

  it('ตารางสถานะไฟล์ export + ปุ่มดาวน์โหลด ไม่มี axe violation', async () => {
    render(
      <MemoryRouter initialEntries={['/data']}>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'ข้อมูล CSV' })).toBeTruthy()
    expect(await screen.findByText('01_customers.csv')).toBeTruthy()
    expect(await screen.findByText('05_orders.csv')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'ดาวน์โหลด 05_orders.csv' })).toBeTruthy() // ปุ่มดาวน์โหลด per ไฟล์
    expect(await screen.findByText('เขียนไฟล์ใหม่จากข้อมูลล่าสุด')).toBeTruthy()
    expect(screen.queryByText('โหลด CSV เข้าระบบ')).toBeNull() // ระบบไม่รับข้อมูลจากไฟล์กลับเข้า

    await expectNoAxeViolations()
  })
})
