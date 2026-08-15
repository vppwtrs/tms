import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it } from 'vitest'
import { expectNoAxeViolations } from '../test/axe'
import Login from '../pages/Login'
import { AuthProvider } from '../context/AuthContext'
import { ToastProvider } from '../context/ToastContext'

/** หน้าเข้าสู่ระบบจริง (ไม่มี token → ไม่มีการเรียก API ตอน mount) */
describe('a11y · login page', () => {
  it('ฟอร์มล็อกอิน ไม่มี axe violation', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>,
    )
    await expectNoAxeViolations()
  })
})
