import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RequirePermission } from '../AppCloud'

vi.mock('../context/CloudAuthContext', () => ({
  useCloudAuth: () => ({ can: (permission: string) => permission === 'allowed' }),
}))

describe('cloud route permissions', () => {
  it('แสดงเนื้อหาเมื่อมีสิทธิ์', () => {
    render(<RequirePermission permission="allowed"><div>ข้อมูลภายใน</div></RequirePermission>)
    expect(screen.getByText('ข้อมูลภายใน')).toBeTruthy()
  })

  it('ไม่แสดงเนื้อหาเมื่อไม่มีสิทธิ์', () => {
    render(<RequirePermission permission="blocked"><div>ข้อมูลภายใน</div></RequirePermission>)
    expect(screen.queryByText('ข้อมูลภายใน')).toBeNull()
    expect(screen.getByText('ไม่มีสิทธิ์เปิดหน้านี้')).toBeTruthy()
  })
})
