import { describe, expect, it } from 'vitest'
import type { MyJobOrder } from '../types'
import { groupStops, jobTripNo, province, shipToName, storeKey } from './stops'

/**
 * กติกาการยุบใบเบิกให้เป็น "จุดจอด" — เทสต์ตรรกะชุดแรกของโปรเจกต์
 *
 * ทำไมเลือกไฟล์นี้ก่อน: มันตัดสินว่าคนขับเห็นกี่จุดบนจอ กดกี่ครั้ง และขอลายเซ็นกี่รอบ
 * พังแล้วไม่มีอะไรฟ้อง — จอยังขึ้นครบ ยังกดได้ แค่ร้านเดียวกลายเป็นสามบรรทัด
 * หรือแย่กว่านั้นคือสองร้านคนละจังหวัดถูกยุบเป็นจุดเดียวแล้วคนขับข้ามไปหนึ่งร้าน
 *
 * แต่ละเทสต์ผูกกับเหตุผลที่เขียนไว้ในคอมเมนต์ของ stops.ts ไม่ใช่ผูกกับวิธีเขียนโค้ด
 * แก้วิธีจัดกลุ่มใหม่ได้ตราบใดที่ข้อสรุปพวกนี้ยังจริง
 */

let nextId = 1

/** ใบเบิกหนึ่งใบแบบย่อ — ระบุเฉพาะช่องที่เทสต์นั้นสนใจ ที่เหลือเป็นค่ากลาง ๆ */
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

describe('jobTripNo', () => {
  it('ใช้เลขเที่ยวของ TMS เพราะเป็นเลขที่คลังกับร้านรู้จัก', () => {
    const job = {
      trip_no: 'TRP-0001',
      orders: [order(), order({ tms_trip_no: 'T25-889' })],
    }
    expect(jobTripNo(job)).toBe('T25-889')
  })

  it('ถอยไปใช้เลขของเราเมื่อไม่มีใบไหนมีเลขของ TMS — เที่ยวที่สร้างเองในระบบ', () => {
    expect(jobTripNo({ trip_no: 'TRP-0002', orders: [order()] })).toBe('TRP-0002')
  })
})

describe('groupStops — หนึ่งจุด = หนึ่งร้าน ไม่ใช่หนึ่งใบ', () => {
  it('ร้านเดียวสั่งสามใบ ขึ้นเป็นจุดเดียว ไม่ใช่สามบรรทัดให้กดซ้ำที่หน้าร้านเดิม', () => {
    const stops = groupStops([
      order({ customer_name: 'ร้าน ก', customer_address: '1/1 ถนนสุขุมวิท' }),
      order({ customer_name: 'ร้าน ก', customer_address: '1/1 ถนนสุขุมวิท' }),
      order({ customer_name: 'ร้าน ก', customer_address: '1/1 ถนนสุขุมวิท' }),
    ])
    expect(stops).toHaveLength(1)
    expect(stops[0]?.orders).toHaveLength(3)
  })

  it('ร้านเดิมที่โผล่คนละช่วงของรายการก็ถูกดึงมารวม — ไปร้านเดิมสองรอบไม่ใช่สิ่งที่ตั้งใจ', () => {
    const stops = groupStops([
      order({ customer_name: 'ร้าน ก', customer_address: 'ที่อยู่ ก' }),
      order({ customer_name: 'ร้าน ข', customer_address: 'ที่อยู่ ข' }),
      order({ customer_name: 'ร้าน ก', customer_address: 'ที่อยู่ ก' }),
    ])
    expect(stops).toHaveLength(2)
    expect(stops[0]?.orders).toHaveLength(2)
  })

  it('คงลำดับการแวะไว้ตามใบแรกของแต่ละร้าน', () => {
    const stops = groupStops([
      order({ customer_name: 'ร้าน ข', customer_address: 'ที่อยู่ ข' }),
      order({ customer_name: 'ร้าน ก', customer_address: 'ที่อยู่ ก' }),
    ])
    expect(stops.map((s) => s.customer_name)).toEqual(['ร้าน ข', 'ร้าน ก'])
  })

  /* นี่คือเคสที่ทำให้ต้องมีฟังก์ชันนี้ตั้งแต่แรก: TMS ยัดชื่อกับเบอร์ของ "คนรับ"
     ลงในช่องที่อยู่ ร้านเดียวที่ระบุคนรับคนละคนจึงได้ destination คนละแบบ */
  it('ร้านเดียวที่ระบุคนรับคนละคน ยังเป็นจุดเดียว เพราะเทียบแค่ชื่อร้านกับจังหวัด', () => {
    const stops = groupStops([
      order({ destination: 'ร้าน ก · คุณสมชาย 081-000-0000 จ.ชลบุรี' }),
      order({ destination: 'ร้าน ก · คุณสมหญิง 082-000-0000 จ.ชลบุรี' }),
    ])
    expect(stops).toHaveLength(1)
  })

  it('ร้านชื่อซ้ำกันคนละจังหวัดต้องไม่ถูกยุบรวม — คนละที่จอดกันคนละร้อยกิโล', () => {
    const stops = groupStops([
      order({ destination: 'ร้าน ก · 1/1 จ.ชลบุรี' }),
      order({ destination: 'ร้าน ก · 2/2 จ.ระยอง' }),
    ])
    expect(stops).toHaveLength(2)
  })

  it('เว้นวรรคกับตัวพิมพ์ที่ไม่เท่ากันไม่ทำให้ร้านเดียวแตกเป็นสองจุด', () => {
    const stops = groupStops([
      order({ customer_name: 'Shop  A', customer_address: '1/1 Sukhumvit' }),
      order({ customer_name: 'shop a', customer_address: '1/1  sukhumvit' }),
    ])
    expect(stops).toHaveLength(1)
  })
})

describe('groupStops — ข้อมูลติดต่อและเวลานัดของจุด', () => {
  it('หยิบเบอร์กับที่อยู่จากใบที่มี ไม่ใช่จากใบแรกเสมอ', () => {
    const stops = groupStops([
      order({ customer_name: 'ร้าน ก', customer_phone: null, customer_address: null }),
      order({ customer_name: 'ร้าน ก', customer_phone: '081-111-1111', customer_address: null }),
    ])
    expect(stops[0]?.customer_phone).toBe('081-111-1111')
  })

  it('ใช้เวลานัดที่เร็วที่สุดของร้าน — จุดต้องถูกจัดคิวตามใบที่ด่วนที่สุดในนั้น', () => {
    const stops = groupStops([
      order({ customer_name: 'ร้าน ก', scheduled_at: '2026-08-27T15:00:00Z' }),
      order({ customer_name: 'ร้าน ก', scheduled_at: '2026-08-27T08:00:00Z' }),
    ])
    expect(stops[0]?.scheduled_at).toBe('2026-08-27T08:00:00Z')
  })

  it('รวมน้ำหนักและจำนวนหน่วยของทุกใบ โดยนับใบที่ไม่มีจำนวนเป็นศูนย์', () => {
    const stops = groupStops([
      order({ customer_name: 'ร้าน ก', weight_kg: 100, tms_unit_count: 2 }),
      order({ customer_name: 'ร้าน ก', weight_kg: 50, tms_unit_count: null }),
    ])
    expect(stops[0]?.weight_kg).toBe(150)
    expect(stops[0]?.unit_count).toBe(2)
  })
})

describe('groupStops — สถานะของจุด', () => {
  it('ยังไม่เสร็จตราบใดที่ยังมีใบค้าง', () => {
    const stops = groupStops([
      order({ customer_name: 'ร้าน ก', status: 'delivered' }),
      order({ customer_name: 'ร้าน ก', status: 'assigned' }),
    ])
    expect(stops[0]?.done).toBe(false)
    expect(stops[0]?.pending).toHaveLength(1)
  })

  it('เสร็จเมื่อส่งครบทุกใบ', () => {
    const stops = groupStops([
      order({ customer_name: 'ร้าน ก', status: 'delivered' }),
      order({ customer_name: 'ร้าน ก', status: 'delivered' }),
    ])
    expect(stops[0]?.done).toBe(true)
    expect(stops[0]?.cancelled).toBe(false)
  })

  /* ใบที่ยกเลิกไม่ใช่ใบค้าง ไม่งั้นจุดที่ยกเลิกไปแล้วหนึ่งใบจะค้างเป็นสีแดงตลอดวัน
     ทั้งที่คนขับทำครบแล้ว */
  it('ใบที่ถูกยกเลิกไม่นับว่าค้าง จุดที่เหลือส่งครบจึงถือว่าเสร็จ', () => {
    const stops = groupStops([
      order({ customer_name: 'ร้าน ก', status: 'delivered' }),
      order({ customer_name: 'ร้าน ก', status: 'cancelled', cancel_reason: 'ร้านปิด' }),
    ])
    expect(stops[0]?.done).toBe(true)
    expect(stops[0]?.pending).toHaveLength(0)
  })

  it('ยกเลิกทั้งร้าน = ไม่ต้องไป และต้องไม่ถูกนับว่าส่งเสร็จ', () => {
    const stops = groupStops([
      order({ customer_name: 'ร้าน ก', status: 'cancelled', cancel_reason: 'ร้านปิด' }),
      order({ customer_name: 'ร้าน ก', status: 'cancelled', cancel_reason: 'ร้านปิด' }),
    ])
    expect(stops[0]?.cancelled).toBe(true)
    expect(stops[0]?.done).toBe(false)
  })

  it('ใบที่ส่งแล้วแต่ยังไม่มีหลักฐาน ต้องถูกยกมาให้เห็น', () => {
    const stops = groupStops([
      order({ customer_name: 'ร้าน ก', status: 'delivered', has_pod: 1 }),
      order({ customer_name: 'ร้าน ก', status: 'delivered', has_pod: 0 }),
    ])
    expect(stops[0]?.needPod).toHaveLength(1)
  })

  it('ใบที่ยังไม่ส่งไม่ถือว่าขาดหลักฐาน — ยังไม่ถึงตาของมัน', () => {
    const stops = groupStops([order({ customer_name: 'ร้าน ก', status: 'assigned', has_pod: 0 })])
    expect(stops[0]?.needPod).toHaveLength(0)
  })

  it('ไม่มีใบเลยก็ไม่มีจุด', () => {
    expect(groupStops([])).toEqual([])
  })
})

describe('shipToName / province — ตัวแยกส่วนของ destination', () => {
  it('ชื่อจุดส่งคือส่วนหน้าสุด ก่อนตัวคั่น', () => {
    expect(shipToName('ร้าน ก · 1/1 จ.ชลบุรี')).toBe('ร้าน ก')
  })

  it('ไม่มีตัวคั่นก็คืนทั้งเส้น', () => {
    expect(shipToName('ร้าน ก')).toBe('ร้าน ก')
  })

  it('อ่านจังหวัดจากท้ายเส้น', () => {
    expect(province('ร้าน ก · 1/1 จ.ชลบุรี')).toBe('ชลบุรี')
  })

  it('ไม่มีจังหวัดก็คืนค่าว่าง ไม่ใช่เดา', () => {
    expect(province('ร้าน ก · 1/1')).toBe('')
  })
})

describe('storeKey — ตัวระบุร้านฝั่งออฟฟิศ', () => {
  it('ลูกค้าที่จับคู่ไว้แล้วเชื่อได้ตรง ๆ ไม่ต้องเดาจากชื่อ', () => {
    expect(storeKey({ customer_id: 7, destination: 'ชื่อไหนก็ได้' }))
      .toBe(storeKey({ customer_id: 7, destination: 'ชื่ออื่นไปเลย' }))
  })

  it('ยังไม่จับคู่ก็เทียบชื่อจุดส่งบวกจังหวัด', () => {
    expect(storeKey({ customer_id: null, destination: 'ร้าน ก · คุณสมชาย จ.ชลบุรี' }))
      .toBe(storeKey({ customer_id: null, destination: 'ร้าน ก · คุณสมหญิง จ.ชลบุรี' }))
  })

  it('ร้านชื่อเดียวกันคนละจังหวัดต้องได้คนละคีย์', () => {
    expect(storeKey({ customer_id: null, destination: 'ร้าน ก · จ.ชลบุรี' }))
      .not.toBe(storeKey({ customer_id: null, destination: 'ร้าน ก · จ.ระยอง' }))
  })

  /* เคยมีสามหน้าจัดกลุ่มกันคนละแบบ หน้าจัดคิวนับ destination ทั้งเส้น ร้านเดียวจึงขึ้น
     เป็นสามร้านบนกระดาน ขณะที่หน้าออเดอร์ข้าง ๆ กันบอกว่าร้านเดียว */
  it('ให้คำตอบเดียวกับ groupStops ว่าสองใบนี้ไปจอดที่เดียวกัน', () => {
    const a = 'ร้าน ก · คุณสมชาย จ.ชลบุรี'
    const b = 'ร้าน ก · คุณสมหญิง จ.ชลบุรี'
    const sameByStoreKey =
      storeKey({ customer_id: null, destination: a }) === storeKey({ customer_id: null, destination: b })
    const sameByGroupStops = groupStops([order({ destination: a }), order({ destination: b })]).length === 1
    expect(sameByStoreKey).toBe(sameByGroupStops)
  })
})
