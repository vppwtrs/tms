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

/** เวลาของวันก่อนหน้า — ประวัติงานจัดกลุ่มตามวัน ชุดสาธิตจึงต้องมีมากกว่าหนึ่งวัน */
function daysAgoAt(days: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
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
    cancel_reason: null,
    cancelled_at: null,
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
      vehicle_id: 1,
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
      vehicle_id: 2,
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
    {
      /* เที่ยวที่ส่งครบแล้วและกำลังวิ่งกลับคลัง — สถานะเดียวที่ปุ่ม "จบงาน" โผล่
         ถ้าไม่มีเที่ยวแบบนี้ในชุดสาธิต กล่องถามค่าทางด่วนจะทดสอบไม่ได้เลย
         นอกจากไล่ส่งของครบทุกร้านพร้อมเก็บหลักฐานก่อนทุกครั้ง */
      id: 5,
      trip_no: 'TRIP-DEMO-05',
      status: 'returning',
      departed_at: todayAt(6, 30),
      arrived_at: todayAt(11, 20),
      notes: null,
      vehicle_id: 4,
      vehicle_plate: '4งง 4444 สมมติ',
      vehicle_type: 'truck6',
      accepted_at: todayAt(6, 15),
      my_accepted_at: todayAt(6, 15),
      is_primary: true,
      driver_count: 1,
      accepted_count: 1,
      issue_note: null,
      warehouse_code: 'WH-DEMO',
      area: 'สมุทรปราการ',
      orders: [
        order({
          trip_id: 5,
          destination: 'ร้านตัวอย่าง หก · ถนนสมมติ 20 บางบ่อ',
          customer_name: 'ร้านตัวอย่าง หก',
          goods_desc: 'น้ำดื่ม 30 แพ็ก',
          weight_kg: 120,
          distance_km: 24,
          status: 'delivered',
          delivered_at: todayAt(10, 50),
          has_pod: 1,
          seq: 1,
          scheduled_at: todayAt(10, 30),
          customer_phone: '02-000-0006',
        }),
      ],
      total_weight: 0,
    },
    /* สองเที่ยวที่ปิดแล้ว — แท็บประวัติจัดกลุ่มตามวัน ถ้าไม่มีของสองวันจะเห็นแค่จอว่าง
       และตรวจไม่ได้ว่าหัวกลุ่มวันที่ทำงานถูก */
    {
      id: 3,
      trip_no: 'TRIP-DEMO-03',
      status: 'completed',
      departed_at: todayAt(5, 30),
      arrived_at: todayAt(7, 10),
      notes: null,
      vehicle_id: 3,
      vehicle_plate: '3คค 3333 สมมติ',
      vehicle_type: 'pickup',
      accepted_at: todayAt(5, 15),
      my_accepted_at: todayAt(5, 15),
      is_primary: true,
      driver_count: 1,
      accepted_count: 1,
      issue_note: null,
      warehouse_code: 'WH-DEMO',
      area: 'กรุงเทพฯ ตะวันออก',
      orders: [
        order({
          destination: 'ร้านตัวอย่าง หก · ถนนสมมติ 5 อ่อนนุช',
          customer_name: 'ร้านตัวอย่าง หก',
          goods_desc: 'น้ำดื่ม 6 ลัง',
          weight_kg: 72,
          distance_km: 9,
          status: 'delivered',
          delivered_at: todayAt(6, 20),
          has_pod: 1,
          seq: 1,
          scheduled_at: todayAt(6),
          customer_phone: '02-000-0006',
        }),
        order({
          destination: 'ร้านตัวอย่าง เจ็ด · ถนนสมมติ 7 พระโขนง',
          customer_name: 'ร้านตัวอย่าง เจ็ด',
          goods_desc: 'ของใช้ 4 ลัง',
          weight_kg: 48,
          distance_km: 5,
          status: 'delivered',
          delivered_at: todayAt(6, 55),
          has_pod: 1,
          seq: 2,
          scheduled_at: todayAt(6, 45),
          customer_phone: '02-000-0007',
        }),
      ],
      total_weight: 0,
    },
    {
      id: 4,
      trip_no: 'TRIP-DEMO-04',
      status: 'completed',
      departed_at: daysAgoAt(1, 8),
      arrived_at: daysAgoAt(1, 16, 20),
      notes: null,
      vehicle_id: 1,
      vehicle_plate: '1กก 1111 สมมติ',
      vehicle_type: 'truck6',
      accepted_at: daysAgoAt(1, 7, 40),
      my_accepted_at: daysAgoAt(1, 7, 40),
      is_primary: true,
      driver_count: 1,
      accepted_count: 1,
      issue_note: 'รถติดหนักช่วงบ่าย ส่งช้ากว่านัด 40 นาที',
      warehouse_code: 'WH-DEMO',
      area: 'สมุทรปราการ',
      orders: [
        order({
          destination: 'ร้านตัวอย่าง แปด · ถนนสมมติ 11 บางพลี',
          customer_name: 'ร้านตัวอย่าง แปด',
          goods_desc: 'อะไหล่ 3 กล่อง',
          weight_kg: 27,
          distance_km: 14,
          status: 'delivered',
          delivered_at: daysAgoAt(1, 10, 15),
          has_pod: 1,
          seq: 1,
          scheduled_at: daysAgoAt(1, 10),
          customer_phone: '02-000-0008',
        }),
        order({
          destination: 'ร้านตัวอย่าง เก้า · ถนนสมมติ 19 เทพารักษ์',
          customer_name: 'ร้านตัวอย่าง เก้า',
          goods_desc: 'กระดาษ 10 รีม',
          weight_kg: 25,
          distance_km: 8,
          status: 'delivered',
          delivered_at: daysAgoAt(1, 15, 40),
          has_pod: 1,
          seq: 2,
          scheduled_at: daysAgoAt(1, 15),
          customer_phone: '02-000-0009',
        }),
        order({
          destination: 'ร้านตัวอย่าง สิบ · ถนนสมมติ 23 บางเสาธง',
          customer_name: 'ร้านตัวอย่าง สิบ',
          goods_desc: 'ของใช้ 6 ลัง',
          weight_kg: 72,
          distance_km: 12,
          status: 'delivered',
          delivered_at: daysAgoAt(1, 16, 5),
          has_pod: 1,
          seq: 3,
          scheduled_at: daysAgoAt(1, 16),
          customer_phone: '02-000-0010',
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
