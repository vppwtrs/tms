import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '../test/axe'
import { DayProgress } from '../components/ops/DayProgress'
import { KpiTiles } from '../components/ops/KpiTiles'
import { VolumeChart } from '../components/ops/VolumeChart'
import { CancelReasons } from '../components/ops/CancelReasons'
import { FleetNow } from '../components/ops/FleetNow'
import type { KpiTrendPoint, OverviewChart, OverviewKpis } from '../api/opsOverview'

/**
 * ชิ้นส่วนของหน้าภาพรวม — เรนเดอร์จริงด้วยข้อมูลที่หน้างานเจอได้จริง
 *
 * หน้านี้ตรวจด้วยตาไม่ได้ บัญชีโหมดสาธิตเป็นคนขับซึ่งไม่มีสิทธิ์ `dashboard.view`
 * เทสต์พวกนี้จึงเป็นหลักฐานเดียวที่มีว่าเคสขอบไม่พังหน้า — โดยเฉพาะเคส
 * "ยังไม่มีอะไรเลย" ซึ่งเป็นสภาพของหน้าจอทุกเช้าก่อนเที่ยวแรกออก
 */

const EMPTY_KPIS: OverviewKpis = {
  same_day: null, stops_per_trip: null, cost_per_stop: null, cost_variance: null,
}

const FULL_KPIS: OverviewKpis = {
  same_day: { pct: 96.8, base: 170 },
  stops_per_trip: { value: 7.4, trips: 23 },
  cost_per_stop: { value: 312, coverage_pct: 87, trips: 20 },
  cost_variance: { total: 4180, per_trip: 209, coverage_pct: 62, trips: 14 },
}

const CHART: OverviewChart = {
  actual: [{ day: '2026-08-26', stops: 168 }, { day: '2026-08-27', stops: 174 }],
  planned: [{ day: '2026-08-29', stops: 152 }],
  estimate: [
    { day: '2026-08-29', stops: 150, low: 120, high: 190, samples: 4 },
    { day: '2026-08-31', stops: 228, low: 190, high: 250, samples: 2 },
  ],
}

const TREND: KpiTrendPoint[] = [
  { day: '2026-08-24', same_day_pct: 94.1, stops_per_trip: 6.9, cost_per_stop: 340 },
  /* วันหยุดที่ไม่มีงาน — ค่าเป็น null ไม่ใช่ 0 เส้นต้องข้าม ไม่ใช่ดิ่งลงพื้น */
  { day: '2026-08-25', same_day_pct: null, stops_per_trip: null, cost_per_stop: null },
  { day: '2026-08-26', same_day_pct: 95.5, stops_per_trip: 7.1, cost_per_stop: 325 },
  { day: '2026-08-27', same_day_pct: 96.8, stops_per_trip: 7.4, cost_per_stop: 312 },
]

const FULL_CAP = {
  vehicles: 12, vehicles_running: 8, vehicles_free: 3, vehicles_off: 1,
  drivers: 11, drivers_free: 2, sample_days: 22, stops_per_vehicle_day: 18.5, max_stops_per_day: 204,
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
})

describe('KpiTiles', () => {
  it('สิทธิ์ไม่ถึงหรือไม่มีข้อมูล ต้องขึ้นขีด ไม่ใช่เลขศูนย์', async () => {
    /* ศูนย์บาทกับ "ยังไม่มีตัวเลข" เป็นคนละเรื่อง แสดงเป็น 0 แล้วผู้บริหาร
       จะอ่านว่าไม่มีส่วนต่าง ทั้งที่ความจริงคือยังไม่มีใครปิดตัวเลข */
    const { container } = render(<KpiTiles kpis={EMPTY_KPIS} prev={null} trend={[]} />)
    expect(container.querySelectorAll('.ops-kpi')).toHaveLength(4)
    expect(screen.getAllByText('—').length).toBe(4)
    await expectNoAxeViolations(container)
  })

  it('ไม่มีช่วงก่อนให้เทียบ ต้องบอกตรง ๆ ไม่ใช่แสดงลูกศรมั่ว', () => {
    render(<KpiTiles kpis={FULL_KPIS} prev={null} trend={TREND} />)
    expect(screen.getAllByText('ยังไม่มีช่วงก่อนให้เทียบ')).toHaveLength(4)
  })

  it('ค่าเหมาต่อจุดที่ถูกลง = ข่าวดี ต้องเป็นสีดี ไม่ใช่สีตามทิศลูกศร', () => {
    const prev: OverviewKpis = {
      ...FULL_KPIS,
      /* ค่าเหมาแพงกว่าเดิม (ลดลงมา = ดี) และเคยจบครบมากกว่าเดิม (ลดลงมา = แย่)
         ใบเดียวกันสองทิศ พิสูจน์ว่าสีตามความหมาย ไม่ใช่ตามทิศลูกศร */
      cost_per_stop: { value: 330, coverage_pct: 90, trips: 21 },
      same_day: { pct: 98.2, base: 165 },
    }
    const { container } = render(<KpiTiles kpis={FULL_KPIS} prev={prev} trend={TREND} />)
    const cheaper = screen.getByText(/คุ้มขึ้น 18/)
    expect(cheaper.className).toContain('is-good')
    expect(container.querySelector('.ops-kpi-delta.is-bad')).toBeTruthy()
  })

  it('เขียนกำกับว่าคิดจากกี่ % ของเที่ยว', () => {
    render(<KpiTiles kpis={FULL_KPIS} prev={null} trend={TREND} />)
    expect(screen.getByText('จาก 87% ของเที่ยว')).toBeTruthy()
    expect(screen.getByText('จาก 62% ที่ปิดตัวเลข')).toBeTruthy()
  })
})

describe('VolumeChart', () => {
  it('วันที่ TMS ยืนยันแล้ว ต้องไม่ถูกวาดซ้ำด้วยแท่งประมาณการ', async () => {
    const { container } = render(
      <VolumeChart chart={CHART} capacity={FULL_CAP} />,
    )
    /* 29 ส.ค. มีทั้งใน planned และ estimate — ของจริงต้องชนะ */
    expect(container.querySelectorAll('.ops-bar')).toHaveLength(4)
    expect(container.querySelectorAll('.ops-bar.is-planned')).toHaveLength(1)
    await expectNoAxeViolations(container)
  })

  it('วันที่คาดว่าเกินกำลังรับงานต้องถูกเตือน', () => {
    render(
      <VolumeChart chart={CHART} capacity={FULL_CAP} />,
    )
    expect(screen.getByText(/2026-08-31.*เกินกำลังรับงาน/)).toBeTruthy()
  })

  it('ประมาณการที่ข้อมูลไม่ถึง 4 สัปดาห์ ถูกทำเครื่องหมายไว้', () => {
    const { container } = render(<VolumeChart chart={CHART} capacity={null} />)
    expect(container.querySelectorAll('.ops-bar.is-estimate.is-thin')).toHaveLength(1)
  })

  it('ไม่มีข้อมูลเลยต้องไม่พัง', () => {
    render(<VolumeChart chart={{ actual: [], planned: [], estimate: [] }} capacity={null} />)
    expect(screen.getByText('ยังไม่มีข้อมูลปริมาณงานในช่วงนี้')).toBeTruthy()
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

describe('เส้นกำลังรับงาน', () => {
  /* ยิงกับฐานจริงครั้งแรกเจอเคสนี้: 5 เที่ยวใน 30 วัน เส้นแดงตกที่ 3 จุด/วัน
     ซึ่งต่ำกว่าแท่งประมาณการเกือบทุกวัน หน้าจอจะเตือนทุกวันทั้งที่รถว่างทั้งอู่ */
  const THIN = { vehicles: 6, vehicles_running: 4, vehicles_free: 2, vehicles_off: 0,
                 drivers: 6, drivers_free: 2, sample_days: 5, stops_per_vehicle_day: 0.47, max_stops_per_day: 3 }

  it('ฐานบางเกิน = ไม่วาดเส้น และไม่เตือนว่าเกินกำลัง', () => {
    const { container } = render(<VolumeChart chart={CHART} capacity={THIN} />)
    expect(container.querySelector('.ops-cap-line')).toBeNull()
    expect(container.querySelector('.ops-chart-warn')).toBeNull()
    expect(screen.getByText(/ยังไม่แสดงเส้นกำลังรับงาน/)).toBeTruthy()
  })

  it('ฐานพอแล้วจึงวาดเส้น พร้อมบอกว่าเฉลี่ยจากกี่วัน', () => {
    const { container } = render(
      <VolumeChart chart={CHART} capacity={{ ...THIN, sample_days: 22, max_stops_per_day: 204 }} />,
    )
    expect(container.querySelector('.ops-cap-line')).toBeTruthy()
    expect(screen.getByText(/จาก 22 วันที่มีงาน/)).toBeTruthy()
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
