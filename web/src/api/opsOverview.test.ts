import { describe, expect, it } from 'vitest'
import { progressRatio } from './opsOverview'

/**
 * ตัวช่วยของหน้าภาพรวม
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

