import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '../test/axe'
import { Badge, Button, Toggle } from '../components/ui'

/** จำลองโครงของหน้า "ผู้ใช้และสิทธิ์" ทั้งสองรูปแบบ
 *  ตารางฝั่งจอคอมกับการ์ดฝั่งมือถือ render พร้อมกันใน DOM (สลับด้วย CSS)
 *  เทสนี้จึงต้องไม่มี id/label ซ้ำกันระหว่างสองรูปแบบ */
function PermissionPanel(): React.JSX.Element {
  const [perms, setPerms] = useState<Record<string, boolean>>({
    'orders.view': true,
    'orders.write': true,
    'orders.cancel': false,
  })
  return (
    <div className="perm-groups">
      <section className="perm-group open">
        <header className="perm-group-head">
          <button type="button" className="perm-group-toggle" aria-expanded>
            <span className="perm-group-label">ออเดอร์</span>
            <span className="perm-group-count">2/3</span>
          </button>
          <div className="perm-group-bulk">
            <button type="button">ทั้งหมด</button>
            <span aria-hidden>·</span>
            <button type="button">ไม่เลย</button>
          </div>
        </header>
        <div className="perm-list">
          <Toggle checked={perms['orders.view'] ?? false} onChange={(v) => setPerms((p) => ({ ...p, 'orders.view': v }))} label="ดูออเดอร์" />
          <Toggle checked={perms['orders.write'] ?? false} onChange={(v) => setPerms((p) => ({ ...p, 'orders.write': v }))} label="สร้าง/แก้ไขออเดอร์" />
          <Toggle
            checked={perms['orders.cancel'] ?? false}
            onChange={(v) => setPerms((p) => ({ ...p, 'orders.cancel': v }))}
            label="ยกเลิกออเดอร์"
            hint="ยกเลิกแล้วย้อนกลับไม่ได้"
            tone="warn"
          />
        </div>
      </section>
    </div>
  )
}

function UserList(): React.JSX.Element {
  return (
    <>
      <div className="table-wrap only-desktop">
        <table className="table">
          <thead>
            <tr>
              <th>ผู้ใช้</th>
              <th>บทบาท</th>
              <th>สิทธิ์ที่ใช้จริง</th>
              <th>สถานะ</th>
              <th className="actions">การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>ภรณี วางแผน</td>
              <td>
                <Badge label="ผู้วางแผนงาน" tone="warning" />
              </td>
              <td>
                21 จาก 26 สิทธิ์<span className="tag-custom">ปรับเอง 1</span>
              </td>
              <td>
                <Badge label="เปิดใช้งาน" tone="success" dot />
              </td>
              <td>
                <div className="actions">
                  <Button variant="ghost" size="sm" aria-label="ตั้งสิทธิ์ dispatcher">
                    ⚙
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="user-cards only-mobile">
        <li className="user-card">
          <div className="user-card-top">
            <div className="user-card-id">
              <div className="user-card-name">ภรณี วางแผน</div>
              <div className="text-xs text-muted">dispatcher</div>
            </div>
            <Badge label="ผู้วางแผนงาน" tone="warning" />
          </div>
          <div className="user-card-actions">
            <Button variant="outline" size="sm">
              ตั้งสิทธิ์
            </Button>
          </div>
        </li>
      </ul>
    </>
  )
}

describe('หน้าผู้ใช้และสิทธิ์ — accessibility', () => {
  it('ตารางสิทธิ์ไม่มี axe violation', async () => {
    const { container } = render(<PermissionPanel />)
    await expectNoAxeViolations(container)
  })

  it('สวิตช์สิทธิ์เป็น role=switch และบอกสถานะเปิด/ปิดให้ screen reader', () => {
    render(<PermissionPanel />)
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(3)
    /* อ่าน attribute ตรง ๆ — โปรเจกต์นี้ไม่ได้ติดตั้ง jest-dom matchers */
    expect(switches[0]?.getAttribute('aria-checked')).toBe('true')
    expect(switches[2]?.getAttribute('aria-checked')).toBe('false')
  })

  it('รายชื่อผู้ใช้ทั้งแบบตารางและแบบการ์ดไม่มี axe violation', async () => {
    const { container } = render(<UserList />)
    await expectNoAxeViolations(container)
  })
})
