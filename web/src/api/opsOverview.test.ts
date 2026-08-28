import { describe, expect, it } from 'vitest'
import {
  coverageNote,
  isThinEstimate,
  progressRatio,
  sparkPoints,
  type ChartEstimate,
  type Coverage,
  type KpiTrendPoint,
} from './opsOverview'

/**
 * ตัวช่วยของหน้าภาพรวม — ทั้งสามตัวมีไว้กันการอ่านผิดแบบเดียวกัน คือ
 * "ตัวเลขที่ดูน่าเชื่อแต่คิดจากข้อมูลไม่ครบ" ซึ่งอันตรายกว่าไม่มีตัวเลข
 *
 * การนับจุดจริง ๆ อยู่ฝั่งฐาน (ops_overview) ไม่มีอะไรให้เทสต์ที่นี่
 * ความถูกต้องของฝั่งนั้นพิสูจน์ด้วย supabase/tests/stop_key_parity.sql
 */

describe('progressRatio', () => {
  it('เช้าที่ยังไม่มีเที่ยวออก ต้องได้ 0 ไม่ใช่ NaN', () => {
    /* ตัวหารเป็นศูนย์ ถ้าปล่อย NaN ไปถึงหน้าจอ แถบความคืบหน้าจะยาวสุดกรอบ
       ซึ่งอ่านว่า "เสร็จหมดแล้ว" ผิดคนละทางกับความจริง */
    expect(progressRatio({ stops_done: 0, stops_total: 0, stops_running: 0, stops_waiting: 0, stops_cancelled: 0 })).toBe(0)
  })

  it('ยังไม่มีข้อมูลเลย (สิทธิ์ไม่ถึง) ต้องได้ 0', () => {
    expect(progressRatio(null)).toBe(0)
  })

  it('นับตามจริง', () => {
    expect(progressRatio({ stops_done: 128, stops_total: 174, stops_running: 0, stops_waiting: 46, stops_cancelled: 4 }))
      .toBeCloseTo(0.7356, 4)
  })

  it('เกิน 100% ไม่ได้ — แถบล้นกรอบอ่านไม่ออกว่าแปลว่าอะไร', () => {
    expect(progressRatio({ stops_done: 12, stops_total: 10, stops_running: 0, stops_waiting: 0, stops_cancelled: 0 })).toBe(1)
  })
})

describe('coverageNote', () => {
  const c = (pct: number): Coverage => ({ coverage_pct: pct, trips: 10 })

  it('ครบทุกเที่ยวไม่ต้องเขียนอะไร', () => {
    /* เขียน "จาก 100%" ทุกใบทำให้คำเตือนกลายเป็นของประดับที่ไม่มีใครอ่าน
       แล้ววันที่มันเหลือ 40% จริง ๆ ก็ไม่มีใครสังเกต */
    expect(coverageNote(c(100))).toBe('')
  })

  it('ไม่ครบต้องบอกว่าคิดจากกี่ %', () => {
    expect(coverageNote(c(87))).toBe('จาก 87% ของเที่ยวที่มีตัวเลข')
  })

  it('เปลี่ยนคำท้ายได้ เพราะส่วนต่างสัญญานับคนละฐานกับค่าเหมา', () => {
    expect(coverageNote(c(62), 'ของเที่ยวที่ปิดตัวเลขแล้ว'))
      .toBe('จาก 62% ของเที่ยวที่ปิดตัวเลขแล้ว')
  })

  it('สิทธิ์ไม่ถึง = ไม่มีตัวเลข = ไม่มีคำกำกับ', () => {
    expect(coverageNote(null)).toBe('')
  })
})

describe('isThinEstimate', () => {
  const e = (samples: number): ChartEstimate =>
    ({ day: '2026-08-31', stops: 180, low: 150, high: 210, samples })

  it('ข้อมูลไม่ครบ 4 สัปดาห์ ต้องถูกทำเครื่องหมายว่าอย่าเพิ่งเชื่อ', () => {
    expect(isThinEstimate(e(2))).toBe(true)
  })

  it('ครบ 4 สัปดาห์แล้วถือว่าใช้ได้', () => {
    expect(isThinEstimate(e(4))).toBe(false)
  })
})

describe('sparkPoints', () => {
  const p = (day: string, v: number | null): KpiTrendPoint =>
    ({ day, same_day_pct: v, stops_per_trip: null, cost_per_stop: null })

  it('วันที่ไม่มีค่าถูกข้าม ไม่ใช่วาดเป็นศูนย์', () => {
    /* วันหยุดที่ไม่มีงานเลยแล้วเส้นดิ่งลงพื้น จะอ่านว่า "วันนั้นทำได้แย่มาก"
       ทั้งที่ความจริงคือวันนั้นไม่มีงาน */
    const withGap = sparkPoints(
      [p('1', 90), p('2', null), p('3', 100)], (x) => x.same_day_pct,
    )
    const without = sparkPoints([p('1', 90), p('3', 100)], (x) => x.same_day_pct)
    expect(withGap).toBe(without)
  })

  it('จุดเดียวไม่มีเส้น — เส้นแบนจากจุดเดียวสื่อว่า "นิ่ง" ทั้งที่ยังไม่รู้อะไรเลย', () => {
    expect(sparkPoints([p('1', 90)], (x) => x.same_day_pct)).toBe('')
    expect(sparkPoints([], (x) => x.same_day_pct)).toBe('')
  })

  it('ค่าสูงสุดอยู่บน ค่าต่ำสุดอยู่ล่าง และไม่ล้นกรอบ', () => {
    const pts = sparkPoints([p('1', 10), p('2', 20)], (x) => x.same_day_pct, 100, 22)
      .split(' ').map((s) => s.split(',').map(Number))
    expect(pts[0]?.[0]).toBe(0)
    expect(pts[1]?.[0]).toBe(100)
    expect(pts[0]?.[1]).toBeGreaterThan(pts[1]?.[1] ?? 0)
    expect(Math.min(...pts.map((q) => q[1] ?? 0))).toBeGreaterThanOrEqual(2)
  })

  it('ค่าเท่ากันทุกวันต้องไม่หารด้วยศูนย์', () => {
    const pts = sparkPoints([p('1', 50), p('2', 50)], (x) => x.same_day_pct)
    expect(pts).not.toContain('NaN')
  })
})
