import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { expectNoAxeViolations } from '../test/axe'
import { MoreMenu, TabPanel, Tabs } from '../components/ui'
import { waitedFor } from '../pages/CloudDispatch'

/* เมนูของงานที่ทำแล้วย้อนยากบนการ์ดเที่ยว — ยกเลิกเที่ยว ลบถาวร
   ของที่ซ่อนอยู่หลังการกดต้องยังเข้าถึงได้ด้วยคีย์บอร์ดและ screen reader
   ไม่งั้นการเก็บปุ่มอันตรายให้พ้นนิ้วก็กลายเป็นการซ่อนมันจากคนที่ใช้คีย์บอร์ดอย่างเดียว */
describe('MoreMenu', () => {
  const items = [
    { label: 'ยกเลิกเที่ยว', onClick: vi.fn(), danger: true },
    { label: 'ลบถาวร', onClick: vi.fn(), danger: true },
  ]

  it('ปิดอยู่ตอนแรก และประกาศสถานะให้ screen reader', () => {
    render(<MoreMenu items={items} />)
    const trigger = screen.getByRole('button', { name: /อื่น ๆ/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('กดแล้วกาง เห็นตัวเลือกครบ และเรียก onClick ของตัวที่เลือก', () => {
    const onCancel = vi.fn()
    render(<MoreMenu items={[{ label: 'ยกเลิกเที่ยว', onClick: onCancel, danger: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: /อื่น ๆ/ }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'ยกเลิกเที่ยว' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    /* กดเลือกแล้วเมนูต้องหุบเอง ไม่ใช่ค้างคาไว้บนการ์ดที่กำลังจะหายไป */
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('กด Escape แล้วหุบ', () => {
    render(<MoreMenu items={items} />)
    fireEvent.click(screen.getByRole('button', { name: /อื่น ๆ/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  /* การ์ดในช่อง "จบวันนี้" ของคนที่ไม่ใช่ผู้ดูแลระบบไม่มีงานอันตรายให้ทำเลย
     ปุ่มเมนูเปล่าที่กดแล้วไม่มีอะไรออกมาแย่กว่าไม่มีปุ่ม */
  it('ไม่มีตัวเลือกเลย ก็ไม่ต้องมีปุ่ม', () => {
    const { container } = render(<MoreMenu items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  /* สแกนตอนกางอย่างเดียว — ตอนกางมีทุกอย่างที่ตอนหุบมี บวกตัวเมนูเอง
     สแกนสองรอบไม่ได้ครอบคลุมเพิ่ม มีแต่ทำให้ไฟล์อื่นที่รันขนานกันหมดเวลา */
  it('ผ่าน axe ตอนกาง', async () => {
    render(<MoreMenu items={items} />)
    fireEvent.click(screen.getByRole('button', { name: /อื่น ๆ/ }))
    await expectNoAxeViolations()
  })
})

/* แท็บของหน้าผู้ใช้และสิทธิ์ — บัญชี · สิทธิ์เริ่มต้นของกลุ่ม · ประวัติการเปลี่ยนแปลง
   แท็บที่ไม่ได้เลือกต้องไม่อยู่ใน DOM เลย ไม่ใช่แค่ซ่อนด้วย CSS
   ไม่งั้น screen reader จะอ่านเนื้อหาของสามแท็บต่อกันรวด */
describe('Tabs', () => {
  const items = [
    { key: 'accounts', label: 'บัญชี', badge: '2' },
    { key: 'groups', label: 'สิทธิ์เริ่มต้นของกลุ่ม' },
  ]

  function Kit({ value }: { value: string }): React.JSX.Element {
    return (
      <>
        <Tabs idPrefix="t" value={value} onChange={() => undefined} items={items} />
        <TabPanel tabKey="accounts" value={value} idPrefix="t">เนื้อหาบัญชี</TabPanel>
        <TabPanel tabKey="groups" value={value} idPrefix="t">เนื้อหากลุ่ม</TabPanel>
      </>
    )
  }

  it('ผูก tab กับ tabpanel ถูกคู่ และแท็บที่ไม่ได้เลือกไม่อยู่ใน DOM', () => {
    render(<Kit value="accounts" />)
    const tab = screen.getByRole('tab', { name: /บัญชี/ })
    expect(tab.getAttribute('aria-selected')).toBe('true')
    expect(tab.getAttribute('aria-controls')).toBe('t-panel-accounts')
    expect(screen.getByRole('tabpanel').getAttribute('id')).toBe('t-panel-accounts')
    expect(screen.queryByText('เนื้อหากลุ่ม')).toBeNull()
  })

  it('ตัวเลขบนแท็บขึ้นเฉพาะตอนมีของค้าง', () => {
    render(<Kit value="accounts" />)
    expect(screen.getByRole('tab', { name: /บัญชี/ }).textContent).toContain('2')
    expect(screen.getByRole('tab', { name: /สิทธิ์เริ่มต้น/ }).textContent).toBe('สิทธิ์เริ่มต้นของกลุ่ม')
  })

  it('ผ่าน axe', async () => {
    render(<Kit value="groups" />)
    await expectNoAxeViolations()
  })
})

/* เวลาที่รอคนขับกดรับ — ตัวเลขเดียวบนกระดานที่ตัดสินว่าต้องโทรตามหรือยัง
   ถ้าเกณฑ์นี้เพี้ยน คนจะโทรตามงานที่เพิ่งจ่ายไป หรือปล่อยงานที่ค้างมาครึ่งวัน */
describe('waitedFor', () => {
  const ago = (mins: number): string => new Date(Date.now() - mins * 60_000).toISOString()

  it('ต่ำกว่าหนึ่งชั่วโมงบอกเป็นนาที', () => {
    expect(waitedFor(ago(18)).text).toBe('รอ 18 นาที')
  })

  it('เกินหนึ่งชั่วโมงบอกเป็นชั่วโมงกับนาที', () => {
    expect(waitedFor(ago(75)).text).toBe('รอ 1 ชม. 15 นาที')
  })

  it('ยังไม่ถึงสองชั่วโมงยังไม่นับว่าค้าง', () => {
    expect(waitedFor(ago(119)).late).toBe(false)
  })

  it('ครบสองชั่วโมงนับว่าค้าง', () => {
    expect(waitedFor(ago(120)).late).toBe(true)
  })

  /* นาฬิกาเครื่องที่เดินช้ากว่าฐานข้อมูลทำให้ได้เวลาติดลบ ซึ่งเคยขึ้นเป็น "รอ -3 นาที" */
  it('เวลาในอนาคตไม่ทำให้ได้ตัวเลขติดลบ', () => {
    expect(waitedFor(ago(-5)).text).toBe('รอ 0 นาที')
  })
})
