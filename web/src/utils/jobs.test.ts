import { describe, expect, it } from 'vitest'
import type { MyJob } from '../types'
import { activeJob, autoOpenJob, doneJobs, dutyVehicle, groupHistory, liveJobs } from './jobs'
import { daysAgoIso, todayIso } from './format'

/**
 * กติกาว่าเที่ยวไหนอยู่จอไหน — เคยอยู่ใน CloudMyJobs จึงไม่มีใครเทสต์ได้
 *
 * ที่ต้องมีเทสต์: พังแล้วอาการคือคนขับเปิดแอปมาไม่เจองานของตัวเอง หรือกดถอยออกจาก
 * เที่ยวแล้วโดนลากกลับเข้าไปใหม่ทันที — สองอย่างที่ดูเหมือนแอปค้าง ไม่เหมือนบั๊ก
 */

let nextId = 1

function job(o: Partial<MyJob> = {}): MyJob {
  const id = nextId++
  return {
    id,
    trip_no: `TRP-${id}`,
    vehicle_id: 1,
    status: 'planned',
    departed_at: null,
    arrived_at: null,
    notes: null,
    vehicle_plate: '1กก-1111',
    vehicle_type: 'truck6',
    accepted_at: null,
    my_accepted_at: null,
    is_primary: true,
    driver_count: 1,
    accepted_count: 0,
    issue_note: null,
    warehouse_code: 'KM23-CW-01',
    area: null,
    orders: [],
    total_weight: 0,
    ...o,
  }
}

describe('liveJobs / doneJobs — งานที่ต้องทำ กับ ประวัติ', () => {
  it('เที่ยวที่ยกเลิกไปอยู่ประวัติ ไม่ค้างอยู่ในงานที่ต้องทำ', () => {
    const jobs = [job({ status: 'planned' }), job({ status: 'cancelled' }), job({ status: 'completed' })]
    expect(liveJobs(jobs)).toHaveLength(1)
    expect(doneJobs(jobs)).toHaveLength(2)
  })

  it('ทุกเที่ยวอยู่ฝั่งใดฝั่งหนึ่งเสมอ ไม่มีเที่ยวที่หายไปจากทั้งสองจอ', () => {
    const jobs = [
      job({ status: 'planned' }),
      job({ status: 'in_progress' }),
      job({ status: 'returning' }),
      job({ status: 'completed' }),
      job({ status: 'cancelled' }),
    ]
    expect(liveJobs(jobs).length + doneJobs(jobs).length).toBe(jobs.length)
  })
})

describe('groupHistory — ประวัติจัดกลุ่มตามวันปิดงาน', () => {
  it('เที่ยวที่ปิดวันเดียวกันอยู่กลุ่มเดียวกัน', () => {
    const groups = groupHistory([
      job({ status: 'completed', arrived_at: '2026-08-20T10:00:00Z' }),
      job({ status: 'completed', arrived_at: '2026-08-20T15:00:00Z' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.jobs).toHaveLength(2)
  })

  it('วันใหม่สุดอยู่บน — คนขับมาหาของเมื่อวาน ไม่ใช่ของเดือนที่แล้ว', () => {
    const groups = groupHistory([
      job({ status: 'completed', arrived_at: '2026-08-18T10:00:00Z' }),
      job({ status: 'completed', arrived_at: '2026-08-20T10:00:00Z' }),
      job({ status: 'completed', arrived_at: '2026-08-19T10:00:00Z' }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['2026-08-20', '2026-08-19', '2026-08-18'])
  })

  it('ในวันเดียวกัน เที่ยวที่ปิดทีหลังอยู่บน', () => {
    const groups = groupHistory([
      job({ trip_no: 'เช้า', status: 'completed', arrived_at: '2026-08-20T08:00:00Z' }),
      job({ trip_no: 'บ่าย', status: 'completed', arrived_at: '2026-08-20T16:00:00Z' }),
    ])
    expect(groups[0]?.jobs.map((j) => j.trip_no)).toEqual(['บ่าย', 'เช้า'])
  })

  /* เที่ยวที่ถูกยกเลิกกลางทางไม่มีเวลาปิดงาน ถ้าไปกองรวมกับวันอื่นจะอ่านไม่ออกว่า
     มันจบวันไหน และถ้าถูกตัดทิ้งก็หายไปจากประวัติทั้งที่เคยมีอยู่จริง */
  it('เที่ยวที่ไม่มีเวลาปิดงานได้กลุ่มของตัวเอง ไม่ถูกกลืนหาย', () => {
    const groups = groupHistory([
      job({ status: 'completed', arrived_at: '2026-08-20T10:00:00Z' }),
      job({ status: 'cancelled', arrived_at: null }),
    ])
    expect(groups).toHaveLength(2)
    const unknown = groups.find((g) => g.key === 'unknown')
    expect(unknown?.jobs).toHaveLength(1)
    expect(unknown?.label).toBe('ไม่ระบุวันปิดงาน')
  })

  it('วันนี้กับเมื่อวานมีคำนำหน้า เพราะเป็นสองวันที่คนขับหาบ่อยที่สุด', () => {
    const groups = groupHistory([
      job({ status: 'completed', arrived_at: `${todayIso()}T10:00:00Z` }),
      job({ status: 'completed', arrived_at: `${daysAgoIso(1)}T10:00:00Z` }),
    ])
    expect(groups[0]?.label).toMatch(/^วันนี้ · /)
    expect(groups[1]?.label).toMatch(/^เมื่อวาน · /)
  })

  it('ไม่มีประวัติก็ไม่มีกลุ่ม', () => {
    expect(groupHistory([])).toEqual([])
  })
})

describe('dutyVehicle — คันที่ต้องถามเลขไมล์', () => {
  it('เลือกคันของเที่ยวที่กำลังวิ่ง แม้จะรับเที่ยวอื่นไว้ก่อน', () => {
    const v = dutyVehicle([
      job({ status: 'planned', accepted_at: '2026-08-27T07:00:00Z', vehicle_id: 10, vehicle_plate: 'รอ' }),
      job({ status: 'in_progress', accepted_at: '2026-08-27T08:00:00Z', vehicle_id: 20, vehicle_plate: 'วิ่ง' }),
    ])
    expect(v).toEqual({ id: 20, plate: 'วิ่ง' })
  })

  it('ยังไม่ออกรถก็เอาคันของเที่ยวที่รับไว้', () => {
    const v = dutyVehicle([job({ accepted_at: '2026-08-27T07:00:00Z', vehicle_id: 10, vehicle_plate: 'รับแล้ว' })])
    expect(v?.plate).toBe('รับแล้ว')
  })

  /* "ฉันรับ" กับ "เที่ยวถูกรับแล้ว" คนละเรื่อง เที่ยวที่มีผู้ช่วยรับไปแล้วแต่ฉันยังไม่รับ
     ก็ยังเป็นคันที่ฉันต้องกรอกเลขไมล์ถ้าฉันเป็นคนขับของมัน */
  it('นับทั้งที่ฉันรับเองและที่เที่ยวถูกรับแล้ว', () => {
    const v = dutyVehicle([job({ my_accepted_at: '2026-08-27T07:00:00Z', vehicle_id: 30, vehicle_plate: 'ฉันรับ' })])
    expect(v?.plate).toBe('ฉันรับ')
  })

  it('ยังไม่รับสักเที่ยวก็ยังตอบได้ ไม่ปล่อยให้จอไม่มีคันให้กรอก', () => {
    expect(dutyVehicle([job({ vehicle_id: 40, vehicle_plate: 'ยังไม่รับ' })])?.plate).toBe('ยังไม่รับ')
  })

  it('ไม่มีเที่ยวเลยก็ไม่มีคัน', () => {
    expect(dutyVehicle([])).toBeNull()
  })
})

describe('activeJob / autoOpenJob — เที่ยวที่เปิดอยู่บนจอ', () => {
  it('ยังไม่เลือกก็ยังไม่เปิดเที่ยวไหน', () => {
    expect(activeJob([job()], null)).toBeNull()
  })

  it('-1 คือกดถอยออกมาเอง ต้องได้จอรายการ', () => {
    expect(activeJob([job()], -1)).toBeNull()
  })

  it('เที่ยวที่เลือกไว้หลุดจากรายการไปแล้ว (ฝ่ายจัดรถถอดออก) ต้องไม่ค้างบนจอ', () => {
    const j = job()
    expect(activeJob([], j.id)).toBeNull()
  })

  it('เปิดแอปมาแล้วรถวิ่งค้างอยู่ = เด้งเข้าเที่ยวนั้น', () => {
    const running = job({ status: 'in_progress', accepted_at: '2026-08-27T08:00:00Z' })
    expect(autoOpenJob([job(), running], null)?.id).toBe(running.id)
  })

  it('เที่ยวที่วางแผนไว้ไม่เด้ง — ยังไม่ออกรถ ยังไม่มีอะไรค้างให้กลับไปหา', () => {
    expect(autoOpenJob([job({ status: 'planned', accepted_at: '2026-08-27T08:00:00Z' })], null)).toBeNull()
  })

  it('กำลังวิ่งแต่ยังไม่มีใครรับ ก็ยังไม่เด้ง', () => {
    expect(autoOpenJob([job({ status: 'in_progress' })], null)).toBeNull()
  })

  /* กติกาข้อที่สำคัญที่สุดของฟังก์ชันนี้: คนขับที่กดถอยออกมาดูรายการ ต้องไม่ถูกลาก
     กลับเข้าเที่ยวเดิมทันที ซึ่งจากฝั่งคนใช้แล้วดูเหมือนปุ่มถอยเสีย */
  it('เลือกอะไรไว้แล้ว (รวมทั้ง -1 ที่แปลว่ากดถอย) ต้องไม่เด้งซ้ำ', () => {
    const running = job({ status: 'in_progress', accepted_at: '2026-08-27T08:00:00Z' })
    expect(autoOpenJob([running], -1)).toBeNull()
    expect(autoOpenJob([running], running.id)).toBeNull()
  })
})
