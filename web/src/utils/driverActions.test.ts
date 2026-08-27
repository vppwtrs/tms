import { describe, expect, it } from 'vitest'
import type { MyJob, MyJobOrder, OdometerStatus } from '../types'
import {
  closingJobs,
  finishGate,
  needsOdometer,
  odometerCacheUsable,
  parseKm,
  podGapsOf,
  tollFor,
} from './driverActions'

/**
 * ด่านของปุ่มบนจอคนขับ
 *
 * ทั้งหมดนี้เคยอยู่ใน act() ปนกับการยิง api และการ setState จึงเทสต์ไม่ได้ ทั้งที่
 * เป็นส่วนที่พลาดแล้วเสียหายจริงกับของจริง: จบงานทั้งที่หลักฐานไม่ครบแล้วกลับไป
 * เก็บไม่ได้อีก, เจอด่านเลขไมล์ของรถผิดคัน, ค่าทางด่วนถูกหารใส่เที่ยวที่ไม่ได้วิ่ง
 */

let nextId = 1

function order(o: Partial<MyJobOrder> = {}): MyJobOrder {
  const id = nextId++
  return {
    id,
    order_no: `ORD-${id}`,
    trip_id: 1,
    status: 'assigned',
    priority: 'normal',
    origin: 'KM23-CW-01',
    destination: 'ร้านทดสอบ · 1/1 จ.ชลบุรี',
    distance_km: 0,
    goods_desc: 'ของ',
    weight_kg: 0,
    scheduled_at: '2026-08-27T09:00:00Z',
    delivered_at: null,
    notes: null,
    customer_name: null,
    customer_phone: null,
    customer_address: null,
    has_pod: 0,
    tms_trip_no: null,
    tms_picking_list_no: null,
    tms_unit_count: null,
    seq: null,
    cancel_reason: null,
    cancelled_at: null,
    ...o,
  }
}

function job(o: Partial<MyJob> = {}): MyJob {
  const id = nextId++
  return {
    id,
    trip_no: `TRP-${id}`,
    vehicle_id: 1,
    status: 'returning',
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

const odo = (o: Partial<OdometerStatus> = {}): OdometerStatus => ({
  logged_today: false,
  start_km: null,
  end_km: null,
  reading_km: null,
  last_km: null,
  ...o,
})

describe('podGapsOf — ใบที่ส่งแล้วแต่ยังไม่มีหลักฐาน', () => {
  it('คืนชื่อร้าน เพราะนั่นคือสิ่งที่คนขับต้องกลับไปหา ไม่ใช่เลขใบ', () => {
    const gaps = podGapsOf([
      job({ orders: [order({ status: 'delivered', has_pod: 0, customer_name: 'ร้าน ก' })] }),
    ])
    expect(gaps).toEqual(['ร้าน ก'])
  })

  it('ไม่รู้ชื่อร้านก็ใช้ปลายทาง ดีกว่าโชว์ค่าว่างให้คนขับเดา', () => {
    const gaps = podGapsOf([
      job({ orders: [order({ status: 'delivered', has_pod: 0, customer_name: null, destination: 'ร้าน ข · จ.ระยอง' })] }),
    ])
    expect(gaps).toEqual(['ร้าน ข · จ.ระยอง'])
  })

  it('ใบที่มีหลักฐานแล้ว และใบที่ยังไม่ได้ส่ง ไม่ใช่ช่องว่าง', () => {
    const gaps = podGapsOf([
      job({
        orders: [
          order({ status: 'delivered', has_pod: 1 }),
          order({ status: 'assigned', has_pod: 0 }),
          order({ status: 'cancelled', has_pod: 0 }),
        ],
      }),
    ])
    expect(gaps).toEqual([])
  })

  it('มองทุกเที่ยวที่กำลังจะถูกปิดพร้อมกัน ไม่ใช่แค่เที่ยวที่กดค้างอยู่', () => {
    const gaps = podGapsOf([
      job({ orders: [order({ status: 'delivered', has_pod: 0, customer_name: 'ร้าน ก' })] }),
      job({ orders: [order({ status: 'delivered', has_pod: 0, customer_name: 'ร้าน ข' })] }),
    ])
    expect(gaps).toEqual(['ร้าน ก', 'ร้าน ข'])
  })
})

describe('finishGate — ด่านก่อนจบงาน', () => {
  it('หลักฐานไม่ครบ = ขวางไว้ พร้อมบอกว่าร้านไหน', () => {
    const g = finishGate(1, ['ร้าน ก'], 1)
    expect(g.kind).toBe('missing-pod')
    expect(g.kind === 'missing-pod' && g.shops).toEqual(['ร้าน ก'])
  })

  /* ถ้าปล่อยผ่านเพราะกล่องเปิดอยู่แล้ว คนขับที่กดจบรอบสองจะจบไปทั้งที่ยังขาดหลักฐาน */
  it('หลักฐานไม่ครบ ขวางทุกครั้ง ไม่ใช่แค่ครั้งแรก', () => {
    expect(finishGate(1, ['ร้าน ก'], null).kind).toBe('missing-pod')
    expect(finishGate(1, ['ร้าน ก'], 1).kind).toBe('missing-pod')
  })

  it('ครั้งแรกให้เปิดกล่องถามค่าทางด่วนกับเลขไมล์ก่อน ไม่ปิดทันที', () => {
    expect(finishGate(1, [], null).kind).toBe('ask-details')
  })

  it('ตอบกล่องของเที่ยวนี้แล้วถึงจะปิดจริง', () => {
    expect(finishGate(1, [], 1).kind).toBe('go')
  })

  /* คนขับเปิดกล่องของเที่ยวหนึ่ง ปิดทิ้ง แล้วไปกดจบอีกเที่ยว — ต้องถามใหม่
     ไม่ใช่เอาคำตอบของเที่ยวก่อนหน้ามาใช้ */
  it('กล่องที่เปิดค้างไว้ของเที่ยวอื่น ใช้แทนกันไม่ได้', () => {
    expect(finishGate(2, [], 1).kind).toBe('ask-details')
  })
})

describe('needsOdometer — ด่านเลขไมล์ต้นวัน', () => {
  it('ขวางตอนรับงานและตอนเริ่มเดินทาง เพราะสองปุ่มนี้กดตอนอยู่หน้ารถแล้ว', () => {
    expect(needsOdometer('accept', odo())).toBe(true)
    expect(needsOdometer('start', odo())).toBe(true)
  })

  /* ขวางปิดงานหรือจบงานคือขวางตอนที่รถวิ่งไปแล้ว ซึ่งสายเกินกว่าจะไปอ่านหน้าปัดต้นวัน */
  it('ไม่ขวางตอนปิดงานหรือจบงาน', () => {
    expect(needsOdometer('complete', odo())).toBe(false)
    expect(needsOdometer('finish', odo())).toBe(false)
  })

  it('กรอกไปแล้ววันนี้ก็ไม่ต้องถามซ้ำ', () => {
    expect(needsOdometer('accept', odo({ logged_today: true }))).toBe(false)
  })

  /* ค่าใน closure ของกล่องยังเป็นของก่อนบันทึกเสมอ ถ้าไม่มีธงนี้ การกรอกเสร็จแล้ว
     เดินงานต่อจะวนกลับเข้ากล่องเดิมทันที */
  it('เพิ่งกรอกเสร็จต้องข้ามด่าน ไม่งั้นวนกลับเข้ากล่องเดิม', () => {
    expect(needsOdometer('accept', odo({ logged_today: false }), true)).toBe(false)
  })

  it('ถามสถานะไม่ได้ก็ปล่อยผ่าน — เน็ตล่มต้องไม่แปลว่าทำงานไม่ได้', () => {
    expect(needsOdometer('accept', null)).toBe(false)
  })
})

describe('odometerCacheUsable — ค่าที่ถืออยู่ใช้กับคันนี้ได้ไหม', () => {
  const today = '2026-08-27'

  it('คันเดียวกันและเป็นของวันนี้ = ใช้ได้ ไม่ต้องยิงถามซ้ำ', () => {
    expect(odometerCacheUsable({ id: 5 }, today, 5, today)).toBe(true)
  })

  /* คนขับถือหลายเที่ยวคนละคันได้ กดรับงานคันที่สองแล้วเจอด่านของคันแรก
     คือด่านที่ผิดคัน — เขาจะกรอกเลขของรถที่ไม่ได้กำลังจะขับ */
  it('คนละคันใช้แทนกันไม่ได้', () => {
    expect(odometerCacheUsable({ id: 5 }, today, 9, today)).toBe(false)
  })

  it('ค่าของเมื่อวานใช้ไม่ได้ — แอปบนมือถืออยู่ในหน่วยความจำข้ามวันได้สบาย', () => {
    expect(odometerCacheUsable({ id: 5 }, '2026-08-26', 5, today)).toBe(false)
  })

  it('ยังไม่เคยถือค่าอะไรไว้ก็ต้องไปถาม', () => {
    expect(odometerCacheUsable(null, null, 5, today)).toBe(false)
  })
})

describe('parseKm — เลขไมล์ที่คนกรอก', () => {
  it('ตัดจุลภาคกับช่องว่างที่คนพิมพ์ติดมาทิ้ง', () => {
    expect(parseKm('128,400')).toBe(128400)
    expect(parseKm(' 128400 ')).toBe(128400)
  })

  it('ค่าว่างหรือศูนย์ใช้ไม่ได้ ต้องไม่ถูกส่งไปบันทึก', () => {
    expect(parseKm('')).toBeNull()
    expect(parseKm('0')).toBeNull()
    expect(parseKm('abc')).toBeNull()
  })
})

describe('closingJobs — เที่ยวที่การกดหนึ่งครั้งไปแตะ', () => {
  it('จบงานปิดทุกเที่ยวบนขากลับ เพราะรถกลับเข้าคลังครั้งเดียว', () => {
    const a = job()
    const b = job()
    expect(closingJobs('finish', a, [a, b])).toHaveLength(2)
  })

  it('การกดอย่างอื่นแตะเที่ยวเดียวเสมอ', () => {
    const a = job()
    const b = job()
    expect(closingJobs('start', a, [a, b])).toEqual([a])
    expect(closingJobs('accept', a, [a, b])).toEqual([a])
  })
})

describe('tollFor — ค่าทางด่วนไปลงที่เที่ยวไหน', () => {
  it('ลงเฉพาะเที่ยวที่คนขับกดจบ', () => {
    expect(tollFor(1, 1, true, '120')).toBe(120)
  })

  /* ทางด่วนที่วิ่งคือขากลับเส้นเดียว การหารใส่ทุกเที่ยวคือการแต่งตัวเลข */
  it('เที่ยวอื่นได้ null = ไม่แตะค่าที่ออฟฟิศอาจกรอกไว้แล้ว', () => {
    expect(tollFor(2, 1, true, '120')).toBeNull()
  })

  it('ตอบว่าไม่มีทางด่วน = 0 ซึ่งเป็นข้อมูลจริง ไม่ใช่การไม่ตอบ', () => {
    expect(tollFor(1, 1, false, '')).toBe(0)
  })

  it('ยังไม่ตอบ = ไม่แตะของเดิม', () => {
    expect(tollFor(1, 1, null, '')).toBeNull()
  })

  it('พิมพ์ตัวเลขปนอักษรก็ยังอ่านออก และพิมพ์ไม่เป็นเลขเลยถือเป็นศูนย์', () => {
    expect(tollFor(1, 1, true, '120 บาท')).toBe(120)
    expect(tollFor(1, 1, true, 'บาท')).toBe(0)
  })
})
