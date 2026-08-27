import type { MyJob } from '../types'
import { daysAgoIso, fmtDate, todayIso } from './format'

/**
 * กติกาว่าเที่ยวไหนอยู่จอไหนของคนขับ
 *
 * แยกออกมาจาก CloudMyJobs เพราะทั้งหมดนี้ตอบได้จากรายการเที่ยวอย่างเดียว ไม่ต้องรู้จัก
 * React เลย — อยู่ในคอมโพเนนต์ 1,100 บรรทัดแปลว่าไม่มีใครเขียนเทสต์ให้มันได้
 * และนี่คือส่วนที่พังแล้วคนขับเปิดแอปมาไม่เจองานของตัวเอง
 */

/** งานที่ยังไม่จบ — งานที่ปิดแล้วเป็นประวัติ ไม่ใช่สิ่งที่ต้องทำ */
export const liveJobs = (jobs: MyJob[]): MyJob[] =>
  jobs.filter((j) => j.status !== 'completed' && j.status !== 'cancelled')

/** งานที่ปิดแล้ว ทั้งที่จบปกติและที่ถูกยกเลิก */
export const doneJobs = (jobs: MyJob[]): MyJob[] =>
  jobs.filter((j) => j.status === 'completed' || j.status === 'cancelled')

export interface HistoryGroup {
  key: string
  label: string
  jobs: MyJob[]
}

/**
 * ประวัติจัดกลุ่มตามวันที่ปิดงาน ใหม่สุดอยู่บน
 *
 * คนขับมาหา "เมื่อวานวิ่งอะไรบ้าง" ไม่ได้มาหาเลขเที่ยว วันจึงเป็นหัวข้อ ไม่ใช่ตัวกรอง
 * เที่ยวที่ไม่มีเวลาปิดงาน (ยกเลิกกลางทาง) ตกลงกลุ่มท้ายสุดของตัวเอง ไม่ถูกกลืนหาย
 */
export function groupHistory(done: MyJob[]): HistoryGroup[] {
  const byDay = new Map<string, MyJob[]>()
  const sorted = [...done].sort((a, b) => (b.arrived_at ?? '').localeCompare(a.arrived_at ?? ''))
  for (const j of sorted) {
    const key = j.arrived_at ? j.arrived_at.slice(0, 10) : 'unknown'
    const bucket = byDay.get(key)
    if (bucket) bucket.push(j)
    else byDay.set(key, [j])
  }

  const today = todayIso()
  const yesterday = daysAgoIso(1)
  return [...byDay.entries()].map(([key, list]) => {
    const day = fmtDate(list[0]?.arrived_at)
    return {
      key,
      label:
        key === 'unknown' ? 'ไม่ระบุวันปิดงาน'
        : key === today ? `วันนี้ · ${day}`
        : key === yesterday ? `เมื่อวาน · ${day}`
        : day,
      jobs: list,
    }
  })
}

/**
 * รถที่ต้องถามเลขไมล์ — เที่ยวที่กำลังวิ่งมาก่อน แล้วค่อยเที่ยวที่รับไว้
 *
 * คนขับคนเดียวอาจถือหลายเที่ยวคนละคัน แต่คันที่กำลังขับอยู่มีคันเดียว
 */
export function dutyVehicle(live: MyJob[]): { id: number; plate: string } | null {
  const accepted = live.filter((j) => j.my_accepted_at ?? j.accepted_at)
  const j = accepted.find((x) => x.status === 'in_progress') ?? accepted[0] ?? live[0]
  return j ? { id: j.vehicle_id, plate: j.vehicle_plate } : null
}

/**
 * เที่ยวที่เปิดอยู่บนจอ
 *
 * null คือยังไม่ได้เลือก, -1 คือกดถอยออกมาเอง สองค่านี้ให้ผลเหมือนกันคือจอรายการ
 * แยกไว้เพราะ -1 มาจากการกดของคนขับ ซึ่งต้องไม่ถูกลากกลับเข้าเที่ยวโดยอัตโนมัติ
 */
export const activeJob = (live: MyJob[], activeId: number | null): MyJob | null =>
  activeId === null || activeId === -1 ? null : live.find((j) => j.id === activeId) ?? null

/**
 * เที่ยวที่ควรเด้งเข้าไปเองตอนเปิดแอป — คืน null เมื่อไม่ควรเด้ง
 *
 * คนขับที่หลุดล็อกอินกลางทางต้องกลับมาที่จอเดิม ไม่ใช่มาไล่กดหาเที่ยวของตัวเองใหม่
 * ทั้งที่ของยังอยู่บนรถ เด้งเฉพาะ in_progress ที่รับแล้วเท่านั้น — planned แปลว่า
 * ยังไม่ออกรถ ยังไม่มีอะไรค้างให้กลับไปหา
 */
export function autoOpenJob(live: MyJob[], activeId: number | null): MyJob | null {
  if (activeId !== null) return null
  return live.find((j) => j.status === 'in_progress' && (j.my_accepted_at ?? j.accepted_at)) ?? null
}
