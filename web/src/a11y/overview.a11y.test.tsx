import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '../test/axe'
import { DayProgress } from '../components/ops/DayProgress'
import { CancelReasons } from '../components/ops/CancelReasons'
import { FleetNow } from '../components/ops/FleetNow'
import { TodayStats } from '../components/ops/TodayStats'
import { FleetTable } from '../components/ops/FleetTable'
import { VolumeTrend } from '../components/ops/VolumeTrend'
import type { FleetRow, OpsToday, OpsVolume } from '../api/opsToday'

/**
 * ชิ้นส่วนของหน้าภาพรวม — เรนเดอร์จริงด้วยข้อมูลที่หน้างานเจอได้จริง
 *
 * หน้านี้ตรวจด้วยตาไม่ได้ บัญชีโหมดสาธิตเป็นคนขับซึ่งไม่มีสิทธิ์ `dashboard.view`
 * เทสต์พวกนี้จึงเป็นหลักฐานเดียวที่มีว่าเคสขอบไม่พังหน้า — โดยเฉพาะเคส
 * "ยังไม่มีอะไรเลย" ซึ่งเป็นสภาพของหน้าจอทุกเช้าก่อนเที่ยวแรกออก
 */

const FULL_CAP = {
  vehicles: 12, vehicles_running: 8, vehicles_free: 3, vehicles_off: 1,
  drivers: 11, drivers_free: 2, sample_days: 22, stops_per_vehicle_day: 18.5, max_stops_per_day: 204,
}

const ROW = (over: Partial<FleetRow> = {}): FleetRow => ({
  vehicle_id: 1, plate: '4ฒญ9845', crew: 'จิรวิรัฐ + ฉัตรชัย', crew_size: 2,
  trips: 2, stops: 9, stops_done: 7, over_free: true,
  last_stop: 'เซเว่น สาขาบางกรวย', last_at: new Date().toISOString(),
  cost_plan: 2400, cost_actual: 2900, cost_open: 0, bonus: 200,
  ...over,
})

const TODAY = (over: Partial<OpsToday> = {}): OpsToday => ({
  date: '2026-08-28',
  money: true,
  today: {
    vehicles_used: 6, vehicles_usable: 9, vehicles_free: 3,
    trips: 14, shipments: 87, stops: 96, stops_done: 68,
    cost_plan: 9000, cost_actual: 10600, trips_open_cost: 0,
    bonus_total: 1725, bonus_trips: 4,
  },
  units: [{ kind: 'vehicle', orders: 68, units: 68 }, { kind: 'box', orders: 5, units: 19 }],
  fleet: [ROW()],
  bonus_rule: { free_stops: 5, rate: 50 },
  ...over,
})

const VOLUME: OpsVolume = {
  grain: 'month',
  points: [
    { key: '2026-06-01', stops: 2486, trips: 310, partial: false },
    { key: '2026-07-01', stops: 2205, trips: 288, partial: false },
    { key: '2026-08-01', stops: 1284, trips: 170, partial: true },
  ],
}

describe('DayProgress', () => {
  it('เช้าที่ยังไม่มีจุดส่ง แถบต้องว่าง ไม่ใช่เต็ม', async () => {
    const { container } = render(<DayProgress data={{ stops_done: 0, stops_total: 0, stops_running: 0, stops_waiting: 0, stops_cancelled: 0 }} />)
    const bar = container.querySelector('.seg-done') as HTMLElement
    expect(bar.style.width).toBe('0%')
    await expectNoAxeViolations(container)
  })

  it('บอกความคืบหน้าเป็นจุด และแยกจุดที่ยกเลิกออกจาก "เหลือ"', async () => {
    const { container } = render(
      <DayProgress data={{ stops_done: 128, stops_total: 174, stops_running: 31, stops_waiting: 15, stops_cancelled: 4 }} />,
    )
    expect(screen.getByText('128')).toBeTruthy()
    expect(screen.getByText(/กำลังวิ่ง 31/)).toBeTruthy()
    expect(screen.getByText(/รอออกรถ 15/)).toBeTruthy()
    expect(screen.getByText(/ยกเลิก 4/)).toBeTruthy()
    await expectNoAxeViolations(container)
  })

  it('แบบแถบแนวนอนต้องมีเนื้อเท่ากับแบบการ์ด ต่างแค่การวาง', async () => {
    /* หน้าที่ต้องจบในจอเดียวใช้แบบแถบ ถ้าตัดข้อมูลออกไปด้วยจะกลายเป็นสองความจริง */
    const data = { stops_done: 68, stops_total: 96, stops_running: 15, stops_waiting: 11, stops_cancelled: 2 }
    const { container } = render(<DayProgress data={data} strip />)
    expect(container.querySelector('.ops-progress.is-strip')).toBeTruthy()
    expect(container.querySelectorAll('.ops-progress-legend span')).toHaveLength(4)
    await expectNoAxeViolations(container)
  })
})

describe('TodayStats', () => {
  it('แสดงตัวเลขงานวันนี้ครบ และไม่พังตอนยังไม่มีข้อมูล', async () => {
    const { container } = render(<TodayStats data={null} />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    await expectNoAxeViolations(container)
  })

  it('สิทธิ์ไม่ถึงตัวเลขเงิน = ไม่แสดงช่องเงินเลย ไม่ใช่แสดงเป็นขีด', () => {
    /* ขีดแปลว่า "ไม่มีข้อมูล" ซึ่งคนละเรื่องกับ "คุณดูไม่ได้" — คนที่เห็นขีด
       จะไปตามหาว่าใครลืมกรอก ทั้งที่ตัวเลขมีอยู่ครบ */
    const { container } = render(<TodayStats data={TODAY({ money: false })} />)
    expect(container.querySelectorAll('.ops-tstat.is-money')).toHaveLength(0)
    expect(screen.getByText('ใช้รถ')).toBeTruthy()
  })

  it('ยังปิดตัวเลขไม่ครบ ต้องบอกก่อน ไม่ใช่โชว์ว่าถูกกว่าแผน', () => {
    /* วันที่ยังไม่จบมีค่าจริงต่ำกว่าแผนเสมอ เพราะยังไม่ปิด ไม่ใช่เพราะประหยัด */
    render(<TodayStats data={TODAY({
      today: { ...TODAY().today, cost_actual: 4000, trips_open_cost: 5 },
    })} />)
    expect(screen.getByText(/ยังไม่ปิด 5 เที่ยว/)).toBeTruthy()
  })

  it('ปิดครบแล้วจึงบอกส่วนต่าง พร้อมทิศทาง', async () => {
    const { container } = render(<TodayStats data={TODAY()} />)
    expect(screen.getByText(/เกินแผน 1,600/)).toBeTruthy()
    await expectNoAxeViolations(container)
  })
})

describe('FleetTable', () => {
  it('บอกจุดล่าสุดและความคืบหน้าเป็นแถวเดียวจบ', async () => {
    const { container } = render(<FleetTable data={TODAY()} />)
    expect(screen.getByText('4ฒญ9845')).toBeTruthy()
    expect(screen.getByText(/เซเว่น สาขาบางกรวย/)).toBeTruthy()
    expect((container.querySelector('.ops-rowbar i') as HTMLElement).style.width).toBe('77.77777777777779%')
    await expectNoAxeViolations(container)
  })

  it('เที่ยวที่ขึ้นสองคน ต้องเขียนว่าคนละเท่าไร ไม่ให้คนคิดเอง', () => {
    render(<FleetTable data={TODAY()} />)
    expect(screen.getByText('คนละ 100')).toBeTruthy()
  })

  it('เที่ยวที่ยังไม่ปิดตัวเลข ต้องเขียนว่ารอปิดเที่ยว ไม่ใช่ 0', () => {
    /* ศูนย์แปลว่าไม่มีค่าใช้จ่าย ซึ่งคนละเรื่องกับยังไม่รู้ */
    render(<FleetTable data={TODAY({ fleet: [ROW({ cost_actual: null, cost_open: 2 })] })} />)
    expect(screen.getByText('รอปิดเที่ยว')).toBeTruthy()
  })

  it('รถที่ยังไม่เกินเกณฑ์ ต้องไม่มีป้ายเบี้ยและไม่มียอด', () => {
    const { container } = render(
      <FleetTable data={TODAY({ fleet: [ROW({ stops: 4, stops_done: 3, over_free: false, bonus: 0 })] })} />,
    )
    expect(container.querySelector('.ops-over')).toBeNull()
    expect(container.querySelector('.ops-money.is-zero')).toBeTruthy()
  })

  it('สิทธิ์ไม่ถึงตัวเลขเงิน = ไม่มีคอลัมน์เงินทั้งสองคอลัมน์', () => {
    const { container } = render(<FleetTable data={TODAY({ money: false })} />)
    expect(container.querySelectorAll('thead th')).toHaveLength(4)
  })

  it('ยังไม่มีรถออกงาน ต้องบอกว่าต้องไปทำอะไรต่อ', () => {
    render(<FleetTable data={TODAY({ fleet: [] })} />)
    expect(screen.getByText(/ยังไม่มีรถออกงาน/)).toBeTruthy()
  })
})

describe('VolumeTrend', () => {
  it('วาดแท่งครบทุกช่วง พร้อมตัวเลขบนแท่ง และไม่มีแกนตัวเลขซ้าย', async () => {
    const { container } = render(<VolumeTrend data={VOLUME} grain="month" onGrain={() => {}} />)
    expect(container.querySelectorAll('.ops-vbar')).toHaveLength(3)
    expect(container.querySelectorAll('.ops-vlabel')).toHaveLength(3)
    /* แกนซ้ายถูกตัดออกโดยตั้งใจ — ตัวเลขอยู่บนแท่งแล้ว */
    expect(container.querySelectorAll('.ops-chart-axis:not(.is-x)')).toHaveLength(0)
    await expectNoAxeViolations(container)
  })

  it('ช่วงที่ยังไม่จบต้องถูกทำเครื่องหมายและเขียนกำกับ', () => {
    const { container } = render(<VolumeTrend data={VOLUME} grain="month" onGrain={() => {}} />)
    expect(container.querySelectorAll('.ops-vbar.is-partial')).toHaveLength(1)
    expect(screen.getByText(/ยังไม่จบ/)).toBeTruthy()
  })

  it('ยังไม่มีข้อมูลต้องไม่พังและไม่ลากเส้น', () => {
    const { container } = render(<VolumeTrend data={null} grain="day" onGrain={() => {}} />)
    expect(container.querySelector('.ops-vline')).toBeNull()
  })
})

describe('CancelReasons', () => {
  it('ความยาวแถบเทียบกับแถวที่มากที่สุด ไม่ใช่กับผลรวม', async () => {
    /* เทียบกับผลรวมทำให้ทุกแถบสั้นจนเทียบกันไม่ออกเวลาสาเหตุกระจายหลายอัน */
    const { container } = render(
      <CancelReasons rows={[
        { reason: 'ร้านปิด ไม่มีคนรับ', orders: 20 },
        { reason: 'ของไม่ครบ/ของผิด', orders: 5 },
      ]} />,
    )
    const bars = [...container.querySelectorAll('.ops-reason-bar i')] as HTMLElement[]
    expect(bars[0]?.style.width).toBe('100%')
    expect(bars[1]?.style.width).toBe('25%')
    await expectNoAxeViolations(container)
  })

  it('ทุกแถวที่รู้จักต้องบอกว่าใครเป็นคนแก้', () => {
    render(<CancelReasons rows={[{ reason: 'ของไม่ครบ/ของผิด', orders: 5 }]} />)
    expect(screen.getByText('คลัง')).toBeTruthy()
  })

  it('เหตุผลที่ไม่รู้จักไม่ต้องเดาเจ้าของให้', () => {
    const { container } = render(<CancelReasons rows={[{ reason: 'ไม่ระบุ', orders: 3 }]} />)
    expect(container.querySelector('.ops-reason-owner')).toBeNull()
  })

  it('ไม่มีใบยกเลิกเลย ต้องไม่หารด้วยศูนย์', () => {
    render(<CancelReasons rows={[]} />)
    expect(screen.getByText('ไม่มีใบที่ถูกยกเลิกในช่วงนี้')).toBeTruthy()
  })
})

describe('FleetNow', () => {
  it('บอกรถว่างและคนขับว่าง ซึ่งเป็นคำถามที่ตามมาทันทีหลังเห็นว่างานเกินกำลัง', async () => {
    const { container } = render(<FleetNow capacity={FULL_CAP} />)
    expect(screen.getByText('วิ่งอยู่')).toBeTruthy()
    expect(screen.getByText('คนขับว่าง')).toBeTruthy()
    expect(container.querySelectorAll('.ops-fleet-row')).toHaveLength(4)
    await expectNoAxeViolations(container)
  })

  it('ประเภทงานที่ฐานไม่ส่งมา ต้องไม่ถูกวาดเป็นศูนย์', () => {
    /* วาดพาเรทเป็น 0 = บอกว่าวันนี้ไม่มีงานพาเรท ทั้งที่ระบบยังไม่มีข้อมูลประเภทนั้นเลย */
    const { container } = render(<FleetNow capacity={FULL_CAP} units={TODAY().units} />)
    expect(container.querySelectorAll('.ops-unitkeys span')).toHaveLength(2)
    expect(screen.getByText('BOX')).toBeTruthy()
  })

  it('ไม่มีรถในระบบเลยต้องไม่หารด้วยศูนย์', () => {
    const empty = { ...FULL_CAP, vehicles: 0, vehicles_running: 0, vehicles_free: 0, vehicles_off: 0, drivers: 0, drivers_free: 0 }
    const { container } = render(<FleetNow capacity={empty} />)
    const bars = [...container.querySelectorAll('.ops-meter i')] as HTMLElement[]
    expect(bars.every((b) => b.style.width === '0%')).toBe(true)
  })

  it('สิทธิ์ไม่ถึงข้อมูลรถ = บอกตรง ๆ ไม่ใช่แถบว่างที่อ่านว่ารถหมดอู่', () => {
    render(<FleetNow capacity={null} />)
    expect(screen.getByText('สิทธิ์ไม่ถึงข้อมูลรถ')).toBeTruthy()
  })
})
