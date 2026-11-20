import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Home } from '../AppCloud'

let perms = new Set<string>()
vi.mock('../context/CloudAuthContext', () => ({
  useCloudAuth: () => ({ can: (p: string) => perms.has(p), user: { role: 'planner' } }),
}))
vi.mock('../pages/CloudHome', () => ({ default: () => <div>หน้าภาพรวม</div> }))

function renderAt(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/orders" element={<div>หน้าออเดอร์</div>} />
        <Route path="/my-jobs" element={<div>หน้างานของฉัน</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('หน้าแรก', () => {
  it('มี dashboard.view เห็นภาพรวม', async () => {
    perms = new Set(['dashboard.view', 'orders.view'])
    renderAt()
    expect(await screen.findByText('หน้าภาพรวม')).toBeTruthy()
  })
  it('ไม่มี dashboard.view พาไปหน้าแรกที่เปิดได้', () => {
    perms = new Set(['orders.view'])
    renderAt()
    expect(screen.getByText('หน้าออเดอร์')).toBeTruthy()
  })
  it('ไม่มีสิทธิ์เลยเห็นข้อความไม่มีสิทธิ์', () => {
    perms = new Set()
    renderAt()
    expect(screen.getByText('บัญชีนี้ยังไม่มีสิทธิ์เปิดหน้าใดได้')).toBeTruthy()
  })
})
