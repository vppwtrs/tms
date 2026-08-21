import type { MyJob, MyJobOrder } from '../types.js'

/**
 * ข้อมูลสมมติสำหรับโหมดสาธิต — ไม่มีอะไรในนี้เป็นของจริง
 *
 * ชื่อร้าน เบอร์โทร ที่อยู่ และเลขเอกสารทั้งหมดแต่งขึ้น เบอร์โทรใช้ 02-000-xxxx
 * ซึ่งเป็นช่วงที่ไม่มีใครใช้จริง กันไม่ให้มีคนกดโทรออกจากจอสาธิตแล้วไปโดนคนอื่น
 *
 * ทั้งก้อนอยู่ในหน่วยความจำ รีเฟรชหน้าแล้วกลับมาเป็นค่าตั้งต้นเสมอ
 */

/** เวลาวันนี้ที่ชั่วโมงกำหนด — งานสาธิตต้องเป็นของ "วันนี้" เสมอ ไม่งั้นจอเปิดมาว่าง */
function todayAt(hour: number, minute = 0): string {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

let nextOrderId = 100

function order(o: Partial<MyJobOrder> & { destination: string; customer_name: string }): MyJobOrder {
  const id = nextOrderId++
  return {
    id,
    order_no: `DEMO-${id}`,
    trip_id: 0,
    status: 'assigned',
    priority: 'normal',
    origin: 'คลังสมมติ บางนา',
    distance_km: 0,
    goods_desc: 'สินค้าตัวอย่าง',
    weight_kg: 0,
    scheduled_at: todayAt(9),
    delivered_at: null,
    notes: null,
    customer_phone: '02-000-0000',
    customer_address: o.destination,
    has_pod: 0,
    tms_trip_no: null,
    tms_picking_list_no: null,
    tms_unit_count: null,
    seq: null,
    ...o,
  }
}

/** สร้างชุดใหม่ทุกครั้งที่เรียก — โหมดสาธิตแก้ข้อมูลได้ ต้องมีทางกลับไปตั้งต้น */
export function buildDemoJobs(): MyJob[] {
  nextOrderId = 100

  const jobs: MyJob[] = [
    {
      id: 1,
      trip_no: 'TRIP-DEMO-01',
      status: 'planned',
      departed_at: null,
      arrived_at: null,
      notes: null,
      vehicle_plate: '1กก 1111 สมมติ',
      vehicle_type: 'truck6',
      accepted_at: null,
      my_accepted_at: null,
      is_primary: true,
      driver_count: 1,
      accepted_count: 0,
      issue_note: null,
      warehouse_code: 'WH-DEMO',
      area: 'กรุงเทพฯ ตะวันออก',
      orders: [
        order({
          destination: 'ร้านตัวอย่าง หนึ่ง · ถนนสมมติ 1 บางนา',
          customer_name: 'ร้านตัวอย่าง หนึ่ง',
          goods_desc: 'น้ำดื่ม 12 ลัง',
          weight_kg: 144,
          distance_km: 12,
          tms_picking_list_no: 'PL-DEMO-001',
          tms_unit_count: 12,
          scheduled_at: todayAt(9),
          customer_phone: '02-000-0001',
        }),
        /* สองใบ ร้านเดียวกัน — จอคนขับต้องยุบเป็นจุดจอดเดียว ชุดสาธิตจึงต้องมีเคสนี้ */
        order({
          destination: 'ร้านตัวอย่าง สอง · ถนนสมมติ 9 ประเวศ',
          customer_name: 'ร้านตัวอย่าง สอง',
          goods_desc: 'อาหารแห้ง 5 ลัง',
          weight_kg: 60,
          distance_km: 8,
          tms_picking_list_no: 'PL-DEMO-002',
          tms_unit_count: 5,
          scheduled_at: todayAt(11),
          customer_phone: '02-000-0002',
        }),
        order({
          destination: 'ร้านตัวอย่าง สอง · ถนนสมมติ 9 ประเวศ',
          customer_name: 'ร้านตัวอย่าง สอง',
          goods_desc: 'เครื่องดื่ม 3 ลัง',
          weight_kg: 36,
          distance_km: 8,
          tms_picking_list_no: 'PL-DEMO-003',
          tms_unit_count: 3,
          scheduled_at: todayAt(11, 30),
          customer_phone: '02-000-0002',
        }),
        order({
          destination: 'ร้านตัวอย่าง สาม · ถนนสมมติ 21 ลาดกระบัง',
          customer_name: 'ร้านตัวอย่าง สาม',
          goods_desc: 'ของใช้ 8 ลัง',
          weight_kg: 96,
          distance_km: 17,
          priority: 'urgent',
          tms_picking_list_no: 'PL-DEMO-004',
          tms_unit_count: 8,
          scheduled_at: todayAt(14),
          customer_phone: '02-000-0003',
        }),
      ],
      total_weight: 0,
    },
    {
      /* เที่ยวที่รับแล้วและกำลังวิ่ง — เปิดมาต้องเห็นทั้งสองสถานะ ไม่ใช่แค่ใบใหม่ */
      id: 2,
      trip_no: 'TRIP-DEMO-02',
      status: 'in_progress',
      departed_at: todayAt(7, 45),
      arrived_at: null,
      notes: 'จอดรับของเพิ่มที่คลังก่อนออก',
      vehicle_plate: '2ขข 2222 สมมติ',
      vehicle_type: 'pickup',
      accepted_at: todayAt(7, 30),
      my_accepted_at: todayAt(7, 30),
      is_primary: true,
      driver_count: 2,
      accepted_count: 2,
      issue_note: null,
      warehouse_code: 'WH-DEMO',
      area: 'สมุทรปราการ',
      orders: [
        order({
          trip_id: 2,
          destination: 'ร้านตัวอย่าง สี่ · ถนนสมมติ 3 สำโรง',
          customer_name: 'ร้านตัวอย่าง สี่',
          goods_desc: 'กระดาษ 20 รีม',
          weight_kg: 50,
          distance_km: 6,
          status: 'delivered',
          delivered_at: todayAt(8, 40),
          has_pod: 1,
          seq: 1,
          scheduled_at: todayAt(8),
          customer_phone: '02-000-0004',
        }),
        order({
          trip_id: 2,
          destination: 'ร้านตัวอย่าง ห้า · ถนนสมมติ 15 บางพลี',
          customer_name: 'ร้านตัวอย่าง ห้า',
          goods_desc: 'อะไหล่ 2 กล่อง',
          weight_kg: 18,
          distance_km: 11,
          seq: 2,
          scheduled_at: todayAt(10),
          customer_phone: '02-000-0005',
        }),
      ],
      total_weight: 0,
    },
  ]

  for (const j of jobs) {
    for (const o of j.orders) o.trip_id = j.id
    j.total_weight = j.orders.reduce((s, o) => s + (o.weight_kg || 0), 0)
  }
  return jobs
}
