import type { MyJob } from '../types.js'
import { buildDemoJobs } from './dataset.js'

/**
 * สถานะของโหมดสาธิต — อยู่ในหน่วยความจำของแท็บเท่านั้น
 * ไม่มี localStorage เพราะการรีเฟรชแล้วได้ของเดิมคือสิ่งที่คนลองเล่นต้องการ
 */
let jobs: MyJob[] = buildDemoJobs()

export function allJobs(): MyJob[] { return jobs }
export function resetJobs(): void { jobs = buildDemoJobs() }

export function findJob(tripId: number): MyJob | undefined {
  return jobs.find((j) => j.id === tripId)
}

/** หน่วงเล็กน้อยให้เห็นสถานะกำลังโหลดเหมือนของจริง — ไม่ใช่การจำลองเน็ตช้า */
export function delay<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/** สำเนาลึกก่อนส่งออก — หน้าจอเก็บผลลัพธ์ไว้ใน state และแก้มันได้
 *  ถ้าส่งตัวเดียวกันออกไป การแก้ที่หน้าจอจะย้อนกลับมาแก้คลังข้อมูลเงียบ ๆ */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
