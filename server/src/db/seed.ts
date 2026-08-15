import bcrypt from 'bcryptjs'
import type Database from 'better-sqlite3'
import { addDays, daysAgo, generateDocNo } from '../utils/helpers.js'
import { migrate } from './schema.js'
import type { OrderStatus, TripStatus, VehicleStatus, DriverStatus, Priority } from '../core/constants.js'

/** RNG แบบกำหนด seed — seed ซ้ำได้ผลลัพธ์เดิม */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = mulberry32(20260811)
const randInt = (min: number, max: number): number => Math.floor(rng() * (max - min + 1)) + min

const CUSTOMERS = [
  { name: 'บริษัท ไทยฟู้ดส์ จำกัด', contact_person: 'คุณวิภา จันทร์ศรี', phone: '081-234-5678', address: '99/1 ถ.สุขุมวิท กรุงเทพฯ' },
  { name: 'หจก. ศรีสวัสดิ์ อิเล็คทริค', contact_person: 'คุณสมชาย ศรีสวัสดิ์', phone: '089-111-2233', address: '12 ม.4 ต.บางแก้ว จ.สมุทรปราการ' },
  { name: 'บริษัท เกษตรไทยรวมผล จำกัด', contact_person: 'คุณประดิษฐ์ วงษ์ทอง', phone: '086-555-7788', address: '55 ถ.มิตรภาพ จ.นครราชสีมา' },
  { name: 'บริษัท โกลด์เบฟเวอเรจ จำกัด', contact_person: 'คุณณัฐยา พลอยแดง', phone: '090-888-1212', address: '88 ถ.พระราม 2 กรุงเทพฯ' },
  { name: 'บริษัท ชัยวัฒน์ ก่อสร้าง จำกัด', contact_person: 'คุณชัยวัฒน์ บุญเรือง', phone: '083-444-5566', address: '120 ถ.พหลโยธิน จ.สระบุรี' },
  { name: 'บริษัท คูลเฟรช ฟู้ดส์ จำกัด', contact_person: 'คุณกมลชนก วิเศษ', phone: '095-777-8899', address: '7/2 ถ.บางนา-ตราด จ.ฉะเชิงเทรา' },
  { name: 'หจก. บ้านและสวน ชลบุรี', contact_person: 'คุณธนกร มาลากุล', phone: '087-222-3344', address: '44 ถ.เลียบชายทะเล จ.ชลบุรี' },
  { name: 'บริษัท นครชัย อะไหล่ยนต์ จำกัด', contact_person: 'คุณอรทัย กิจเจริญ', phone: '092-666-7788', address: '330 ถ.มิตรภาพ จ.ขอนแก่น' },
  { name: 'บริษัท เชียงใหม่เฟรชโปรดิวซ์ จำกัด', contact_person: 'คุณพิชัย สุทธิกุล', phone: '088-333-4455', address: '22 ถ.ห้วยแก้ว จ.เชียงใหม่' },
  { name: 'บริษัท ใต้ฟ้า คอนซูเมอร์ จำกัด', contact_person: 'คุณสุนทร เพชรไพโรจน์', phone: '094-111-9900', address: '66 ถ.เพชรเกษม จ.สงขลา' },
] as const

const VEHICLES: { plate_no: string; brand: string; model: string; vehicle_type: string; capacity_kg: number }[] = [
  { plate_no: 'กท-1234', brand: 'Isuzu', model: 'D-Max', vehicle_type: 'pickup', capacity_kg: 1500 },
  { plate_no: 'ชน-4567', brand: 'Toyota', model: 'Hilux Revo', vehicle_type: 'pickup', capacity_kg: 1200 },
  { plate_no: '5กท-8901', brand: 'Hino', model: '300 Series', vehicle_type: 'truck6', capacity_kg: 6000 },
  { plate_no: '6กท-2345', brand: 'Isuzu', model: 'FRR', vehicle_type: 'truck6', capacity_kg: 5500 },
  { plate_no: '8กท-6789', brand: 'Hino', model: '500 Series', vehicle_type: 'truck10', capacity_kg: 10000 },
  { plate_no: '9กท-0123', brand: 'Volvo', model: 'FM 420', vehicle_type: 'truck10', capacity_kg: 12000 },
  { plate_no: 'ฉช-3456', brand: 'Isuzu', model: 'Elf FVR', vehicle_type: 'reefer', capacity_kg: 4000 },
  { plate_no: 'กท-7890', brand: 'Toyota', model: 'Hiace', vehicle_type: 'van', capacity_kg: 900 },
] as const

const DRIVERS: { name: string; phone: string; license_no: string; license_type: string }[] = [
  { name: 'สมชาย ใจดี', phone: '081-000-0001', license_no: 'ลท 123456', license_type: 'ประเภท 2' },
  { name: 'วิชัย ทองดี', phone: '081-000-0002', license_no: 'ลท 234567', license_type: 'ประเภท 2' },
  { name: 'ประเสริฐ ศรีสุวรรณ', phone: '081-000-0003', license_no: 'ลท 345678', license_type: 'ประเภท 4' },
  { name: 'อนุชา พงษ์พันธ์', phone: '081-000-0004', license_no: 'ลท 456789', license_type: 'ประเภท 4' },
  { name: 'กิตติศักดิ์ รักไทย', phone: '081-000-0005', license_no: 'ลท 567890', license_type: 'ประเภท 2' },
  { name: 'สมศักดิ์ บุญมา', phone: '081-000-0006', license_no: 'ลท 678901', license_type: 'ประเภท 4' },
  { name: 'นภดล แสงจันทร์', phone: '081-000-0007', license_no: 'ลท 789012', license_type: 'ประเภท 2' },
  { name: 'ธีรพงศ์ วัฒนะ', phone: '081-000-0008', license_no: 'ลท 890123', license_type: 'ประเภท 4' },
] as const

/** เส้นทาง (ต้นทาง → ปลายทาง, ระยะทาง กม.) */
const ROUTES: { origin: string; destination: string; dist: number }[] = [
  { origin: 'กรุงเทพฯ', destination: 'ชลบุรี', dist: 130 },
  { origin: 'กรุงเทพฯ', destination: 'ระยอง', dist: 200 },
  { origin: 'สมุทรปราการ', destination: 'ฉะเชิงเทรา', dist: 80 },
  { origin: 'กรุงเทพฯ', destination: 'นครราชสีมา', dist: 260 },
  { origin: 'นครราชสีมา', destination: 'ขอนแก่น', dist: 190 },
  { origin: 'กรุงเทพฯ', destination: 'ขอนแก่น', dist: 450 },
  { origin: 'กรุงเทพฯ', destination: 'พิษณุโลก', dist: 380 },
  { origin: 'กรุงเทพฯ', destination: 'เชียงใหม่', dist: 700 },
  { origin: 'นครปฐม', destination: 'กรุงเทพฯ', dist: 60 },
  { origin: 'กรุงเทพฯ', destination: 'สงขลา', dist: 950 },
  { origin: 'สมุทรปราการ', destination: 'ชลบุรี', dist: 90 },
  { origin: 'กรุงเทพฯ', destination: 'อยุธยา', dist: 90 },
  { origin: 'ชลบุรี', destination: 'ระยอง', dist: 70 },
  { origin: 'กรุงเทพฯ', destination: 'นครปฐม', dist: 60 },
] as const

const GOODS = [
  'เครื่องใช้ไฟฟ้า', 'อาหารแช่แข็ง', 'วัสดุก่อสร้าง', 'สินค้าอุปโภคบริโภค', 'ชิ้นส่วนยานยนต์',
  'ข้าวสารบรรจุถุง', 'น้ำดื่มบรรจุลัง', 'เครื่องจักรกล', 'เฟอร์นิเจอร์', 'ยาและเวชภัณฑ์',
] as const

const iso = (d: Date): string => d.toISOString()
const isoDate = (d: Date): string => d.toISOString().slice(0, 10)

/** เติมข้อมูลตัวอย่าง — เรียกครั้งเดียวเมื่อ DB ว่าง */
export function seed(db: Database.Database): void {
  const wipe = db.transaction(() => {
    for (const t of ['pod', 'orders', 'trips', 'quotes', 'customer_interactions', 'customer_tasks', 'customers', 'vehicles', 'drivers', 'users', 'settings']) {
      db.prepare(`DELETE FROM ${t}`).run()
    }
    db.prepare(
      `DELETE FROM sqlite_sequence WHERE name IN ('pod','orders','trips','quotes','customer_interactions','customer_tasks','customers','vehicles','drivers','users')`,
    ).run()
  })
  wipe()

  const settings = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`)
  settings.run('org_name', 'ทรานส์พลัส โลจิสติกส์')
  settings.run('currency_code', 'THB')
  settings.run('currency_symbol', '฿')

  const insertUser = db.prepare(`INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)`)
  const hash = bcrypt.hashSync('admin123', 10)
  insertUser.run('admin', hash, 'ผู้ดูแลระบบ', 'admin')
  insertUser.run('dispatcher', bcrypt.hashSync('dispatch123', 10), 'ภรณี วางแผน', 'dispatcher')
  insertUser.run('viewer', bcrypt.hashSync('viewer123', 10), 'ผู้อ่านรายงาน', 'viewer')

  // โปรไฟล์ CRM ของลูกค้า: กลุ่ม (segment), เลขภาษี, เงื่อนไขเครดิต, แท็ก, เงื่อนไขราคา
  const SEGMENTS = ['VIP', 'A', 'B', 'B', 'C'] as const
  const CREDIT_DAYS = [60, 30, 30, 15, 7] as const
  const insertCustomer = db.prepare(
    `INSERT INTO customers (name, contact_person, phone, email, address, segment, tax_id, credit_terms, tags, price_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const customerIds: number[] = []
  CUSTOMERS.forEach((c, i) => {
    const segment = SEGMENTS[i % SEGMENTS.length]!
    const credit = CREDIT_DAYS[i % CREDIT_DAYS.length]!
    const tags = [segment === 'VIP' ? 'ลูกค้าหลัก' : segment === 'A' ? 'รายใหญ่' : 'ทั่วไป', i % 2 === 0 ? 'ขนส่งประจำ' : 'ตามออเดอร์'].join(', ')
    const info = insertCustomer.run(
      c.name,
      c.contact_person,
      c.phone,
      `contact${i + 1}@example.com`,
      c.address,
      segment,
      `13${String(1010000000000 + i * 137).slice(0, 12)}`,
      credit,
      tags,
      segment === 'VIP' ? 'ราคาพิเศษ -5% สำหรับเส้นทางประจำ' : null,
    )
    customerIds.push(Number(info.lastInsertRowid))
  })

  const insertVehicle = db.prepare(
    `INSERT INTO vehicles (plate_no, brand, model, vehicle_type, capacity_kg, status) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const vehicleIds: number[] = []
  VEHICLES.forEach((v, i) => {
    const status: VehicleStatus = i >= 6 ? 'available' : 'available'
    const info = insertVehicle.run(v.plate_no, v.brand, v.model, v.vehicle_type, v.capacity_kg, status)
    vehicleIds.push(Number(info.lastInsertRowid))
  })

  const insertDriver = db.prepare(
    `INSERT INTO drivers (name, phone, license_no, license_type, status, joined_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const driverIds: number[] = []
  DRIVERS.forEach((d, i) => {
    const joined = daysAgo(randInt(300, 2500))
    const info = insertDriver.run(d.name, d.phone, d.license_no, d.license_type, 'available', isoDate(joined))
    driverIds.push(Number(info.lastInsertRowid))
  })

  const insertTrip = db.prepare(
    `INSERT INTO trips (trip_no, vehicle_id, driver_id, status, departed_at, arrived_at, fuel_cost, toll_cost, other_cost, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertOrder = db.prepare(
    `INSERT INTO orders (order_no, customer_id, origin, destination, distance_km, goods_desc, weight_kg, fee, status, priority, scheduled_at, delivered_at, trip_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  let tripSeq = 0
  let orderSeq = 0
  const year = new Date().getFullYear()

  const buildOrder = (
    o: { route: (typeof ROUTES)[number]; customer_id: number; weight: number; priority: Priority; scheduled: Date },
    status: OrderStatus,
    delivered?: Date,
    tripId?: number | null,
    extraNote?: string,
  ): string => {
    orderSeq += 1
    const fee = Math.round((1200 + o.route.dist * 6.5) / 50) * 50
    const note = extraNote ?? (status === 'cancelled' ? 'ลูกค้ายกเลิก - เปลี่ยนแผนการสั่งซื้อ' : null)
    const orderNo = generateDocNo('ORD', orderSeq, year)
    insertOrder.run(
      orderNo,
      o.customer_id,
      o.route.origin,
      o.route.destination,
      o.route.dist,
      GOODS[randInt(0, GOODS.length - 1)]!,
      o.weight,
      fee,
      status,
      o.priority,
      iso(o.scheduled),
      delivered ? iso(delivered) : null,
      tripId ?? null,
      note,
    )
    return orderNo
  }

  const createTrip = (
    vehicleIdx: number,
    driverIdx: number,
    status: TripStatus,
    departed: Date,
    arrived: Date | null,
    dist: number,
  ): number => {
    tripSeq += 1
    const fuel = Math.round((dist * 4.2 + randInt(50, 300)) / 10) * 10
    const toll = randInt(1, 10) > 6 ? Math.round((dist * 0.9) / 10) * 10 : 0
    const other = randInt(1, 10) > 6 ? randInt(100, 500) : 0
    const info = insertTrip.run(
      generateDocNo('TRP', tripSeq, year),
      vehicleIds[vehicleIdx % vehicleIds.length],
      driverIds[driverIdx % driverIds.length],
      status,
      iso(departed),
      arrived ? iso(arrived) : null,
      fuel,
      toll,
      other,
      null,
    )
    return Number(info.lastInsertRowid)
  }

  // ---------- ออเดอร์ประวัติ (ส่งสำเร็จแล้ว) ----------
  const deliveredCount = 58
  const deliveredTrips: number[] = []
  const setCreatedAt = db.prepare(`UPDATE orders SET created_at = ? WHERE order_no = ?`)
  const orderIdByNo = db.prepare(`SELECT id FROM orders WHERE order_no = ?`)

  // ---------- POD ตัวอย่าง (หลักฐานการส่งมอบ) — ลายเซ็นแบบ SVG จำลอง ----------
  const fakeSignature = (): string => {
    let d = `M${20 + randInt(0, 30)},${90 - randInt(0, 20)}`
    const segs = randInt(3, 5)
    for (let i = 0; i < segs; i++) {
      const x1 = 40 + i * 70 + randInt(0, 30)
      const y1 = 30 + randInt(0, 60)
      const x2 = x1 + 50 + randInt(0, 20)
      const y2 = 30 + randInt(0, 60)
      d += ` Q${x1},${y1} ${x2},${y2}`
    }
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='130' viewBox='0 0 420 130'><rect width='420' height='130' fill='#fff'/><path d='${d}' stroke='#0f172a' stroke-width='2.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>`
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  }
  const insertPod = db.prepare(
    `INSERT INTO pod (order_id, recipient_name, signature_data, notes, status, lat, lng, collected_by, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const dispatcherId = (db.prepare(`SELECT id FROM users WHERE username = 'dispatcher'`).get() as { id: number }).id
  const podRecipients = [
    'คุณสมชาย ใจดี (ผจก.คลัง)', 'คุณอรทัย กิจเจริญ', 'คุณธนกร มาลากุล', 'คุณสุนทร เพชรไพโรจน์', 'คุณพิชัย สุทธิกุล',
  ] as const
  for (let i = 0; i < deliveredCount; i++) {
    const route = ROUTES[i % ROUTES.length]!
    const customerId = customerIds[i % customerIds.length]!
    const scheduled = daysAgo(2 + ((i * 2) % 116), randInt(7, 18))
    // ส่วนใหญ่ส่งก่อนกำหนด (ตรงเวลา ~78%) บางใบมาสาย
    const late = rng() < 0.22
    const deliverHours = late ? randInt(4, 20) : -randInt(1, 6)
    const deliveredAt = new Date(scheduled.getTime() + deliverHours * 3600_000)
    const vehicleIdx = i % VEHICLES.length
    const driverIdx = i % DRIVERS.length
    const weight = randInt(400, 9000)
    const tripId = createTrip(vehicleIdx, driverIdx, 'completed', new Date(deliveredAt.getTime() - randInt(3, 10) * 3600_000), deliveredAt, route.dist)
    deliveredTrips.push(tripId)
    const orderNo = buildOrder(
      { route, customer_id: customerId, weight, priority: rng() < 0.15 ? 'urgent' : 'normal', scheduled },
      'delivered',
      deliveredAt,
      tripId,
    )
    // สร้างออเดอร์ก่อนวันส่ง 1-3 วัน (เหมือนรับออเดอร์ล่วงหน้า) — ทำให้เวลาส่งเฉลี่ยเป็นบวก
    setCreatedAt.run(iso(new Date(deliveredAt.getTime() - randInt(1, 3) * 86400_000)), orderNo)
    // ออเดอร์ 5 ใบแรกมี POD (4 ยังไม่ยืนยัน + 1 ยืนยันแล้ว) — เก็บ POD หลังส่ง 10 นาที
    if (i < 5) {
      const { id: orderId } = orderIdByNo.get(orderNo) as { id: number }
      insertPod.run(
        orderId,
        podRecipients[i]!,
        fakeSignature(),
        'สินค้าครบ ตรวจรับเรียบร้อย',
        i < 4 ? 'collected' : 'verified',
        Math.round((13.72 + rng() * 0.15) * 100000) / 100000,
        Math.round((100.5 + rng() * 0.2) * 100000) / 100000,
        dispatcherId,
        iso(new Date(deliveredAt.getTime() + 10 * 60_000)),
      )
    }
  }

  // ---------- ทริปกำลังขนส่ง (in_progress) ----------
  const inTransitOrders = 3
  const inProgressTripIds: number[] = []
  for (let t = 0; t < 2; t++) {
    const route = ROUTES[(t + 3) % ROUTES.length]!
    const vehicleIdx = (t + 5) % VEHICLES.length
    const driverIdx = (t + 5) % DRIVERS.length
    const departed = new Date(Date.now() - randInt(1, 4) * 3600_000 - t * 3 * 3600_000)
    const tripId = createTrip(vehicleIdx, driverIdx, 'in_progress', departed, null, route.dist)
    inProgressTripIds.push(tripId)
    db.prepare(`UPDATE vehicles SET status = 'on_trip' WHERE id = ?`).run(vehicleIds[vehicleIdx % vehicleIds.length])
    db.prepare(`UPDATE drivers SET status = 'on_trip' WHERE id = ?`).run(driverIds[driverIdx % driverIds.length])
    for (let k = 0; k < Math.ceil(inTransitOrders / 2); k++) {
      const customerId = customerIds[(t * 3 + k) % customerIds.length]!
      buildOrder(
        { route, customer_id: customerId, weight: randInt(800, 6000), priority: 'normal', scheduled: new Date(Date.now() + randInt(2, 12) * 3600_000) },
        'in_transit',
        undefined,
        tripId,
      )
    }
  }

  // ---------- ทริปวางแผนแล้ว (planned — จองรถ/คนขับแล้ว) ----------
  {
    const route = ROUTES[6]!
    const vehicleIdx = 7
    const driverIdx = 7
    const tomorrow = addDays(new Date(), 1)
    const tripId = createTrip(vehicleIdx, driverIdx, 'planned', tomorrow, null, route.dist)
    db.prepare(`UPDATE vehicles SET status = 'on_trip' WHERE id = ?`).run(vehicleIds[vehicleIdx % vehicleIds.length])
    db.prepare(`UPDATE drivers SET status = 'on_trip' WHERE id = ?`).run(driverIds[driverIdx % driverIds.length])
    for (let k = 0; k < 2; k++) {
      buildOrder(
        { route, customer_id: customerIds[(k + 1) % customerIds.length]!, weight: randInt(800, 4000), priority: k === 0 ? 'urgent' : 'normal', scheduled: tomorrow },
        'assigned',
        undefined,
        tripId,
      )
    }
  }

  // ---------- ออเดอร์รอจัดคิว (pending) ----------
  const pendingRoutes = [ROUTES[0]!, ROUTES[3]!, ROUTES[5]!, ROUTES[9]!, ROUTES[7]!]
  pendingRoutes.forEach((route, i) => {
    const isUrgent = i === 0 || i === 3
    const scheduled = isUrgent && i === 0 ? daysAgo(1, 9) : addDays(new Date(), i) // ใบแรกเลยกำหนดแล้ว (ด่วน+ล่าช้า)
    buildOrder(
      { route, customer_id: customerIds[(i + 4) % customerIds.length]!, weight: randInt(300, 5000), priority: isUrgent ? 'urgent' : 'normal', scheduled },
      'pending',
    )
  })

  // ---------- ออเดอร์ยกเลิก (สร้างในอดีต เหมือนยกเลิกไปแล้ว) ----------
  for (let i = 0; i < 4; i++) {
    const route = ROUTES[(i + 2) % ROUTES.length]!
    const scheduled = daysAgo(randInt(3, 40), 10)
    const orderNo = buildOrder(
      { route, customer_id: customerIds[(i + 2) % customerIds.length]!, weight: randInt(300, 4000), priority: 'normal', scheduled },
      'cancelled',
    )
    setCreatedAt.run(iso(new Date(scheduled.getTime() - randInt(1, 3) * 86400_000)), orderNo)
  }

  // ตั้งค่ารถ 2 คันให้เป็นซ่อมบำรุง และคนขับ 1 คนหยุดงาน (ความสมจริง)
  db.prepare(`UPDATE vehicles SET status = 'maintenance' WHERE id = ?`).run(vehicleIds[3]!)
  db.prepare(`UPDATE drivers SET status = 'off_duty' WHERE id = ?`).run(driverIds[2]!)

  // ============ CRM: ใบเสนอราคา (quotes) ============
  const insertQuote = db.prepare(
    `INSERT INTO quotes (quote_no, customer_id, origin, destination, distance_km, goods_desc, weight_kg, fee, status, valid_until, notes, created_by, converted_order_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const orderIdList = (db.prepare(`SELECT id FROM orders ORDER BY id`).all() as { id: number }[]).map((r) => r.id)
  const quoteDefs: { cus: number; route: (typeof ROUTES)[number]; goods: string; weight: number; status: string; daysAgoVal: number; validDays: number; note?: string }[] = [
    { cus: 0, route: ROUTES[4]!, goods: 'ชิ้นส่วนยานยนต์', weight: 3500, status: 'accepted', daysAgoVal: 12, validDays: 14, note: 'ราคาประจำ เส้นทางขอนแก่น' },
    { cus: 1, route: ROUTES[2]!, goods: 'สินค้าอุปโภคบริโภค', weight: 2800, status: 'sent', daysAgoVal: 4, validDays: 7 },
    { cus: 2, route: ROUTES[5]!, goods: 'อาหารแช่แข็ง', weight: 5000, status: 'sent', daysAgoVal: 2, validDays: 10, note: 'รอลูกค้าตอบกลับภายในสัปดาห์นี้' },
    { cus: 3, route: ROUTES[9]!, goods: 'เฟอร์นิเจอร์', weight: 1500, status: 'rejected', daysAgoVal: 8, validDays: 7, note: 'ราคาสูงกว่าคู่แข่ง ลูกค้าขอพักไว้ก่อน' },
    { cus: 4, route: ROUTES[7]!, goods: 'เครื่องจักรกล', weight: 4500, status: 'draft', daysAgoVal: 1, validDays: 14, note: 'รอเช็คน้ำหนักกับลูกค้าก่อนส่ง' },
    { cus: 5, route: ROUTES[1]!, goods: 'วัสดุก่อสร้าง', weight: 6200, status: 'accepted', daysAgoVal: 20, validDays: 30, note: 'ขนส่งต่อเนื่อง 2 เที่ยว/สัปดาห์' },
    { cus: 6, route: ROUTES[3]!, goods: 'น้ำดื่มบรรจุลัง', weight: 4000, status: 'expired', daysAgoVal: 40, validDays: 7 },
    { cus: 7, route: ROUTES[6]!, goods: 'ยาและเวชภัณฑ์', weight: 900, status: 'sent', daysAgoVal: 3, validDays: 5 },
  ]
  quoteDefs.forEach((qd, i) => {
    const created = daysAgo(qd.daysAgoVal, 10)
    const fee = Math.round((1200 + qd.route.dist * 6.5) / 50) * 50
    const convertedId = qd.status === 'accepted' && i < 2 ? (orderIdList[(i + 1) % orderIdList.length] ?? null) : null
    insertQuote.run(
      generateDocNo('QOT', i + 1, year),
      customerIds[qd.cus] ?? null,
      qd.route.origin,
      qd.route.destination,
      qd.route.dist,
      qd.goods,
      qd.weight,
      fee,
      qd.status,
      isoDate(addDays(created, qd.validDays)),
      qd.note ?? null,
      dispatcherId,
      convertedId,
      iso(created),
    )
  })

  // ============ CRM: ประวัติการติดต่อ (interactions) ============
  const insertInteraction = db.prepare(
    `INSERT INTO customer_interactions (customer_id, type, subject, note, happened_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const interactionDefs: { cus: number; type: string; subject: string; note?: string; daysAgoVal: number }[] = [
    { cus: 0, type: 'meeting', subject: 'ประชุมทบทวนสัญญาประจำปี', note: 'ลูกค้าพอใจบริการ ขอขยายเส้นทางเพิ่ม 1 เส้นทาง', daysAgoVal: 5 },
    { cus: 0, type: 'email', subject: 'ส่งใบเสนอราคาเส้นทางใหม่', note: 'ส่งทางอีเมล รอตอบกลับ', daysAgoVal: 2 },
    { cus: 1, type: 'call', subject: 'สอบถามกำหนดส่งล็อตใหม่', note: 'ติดต่อคุณสมชาย — ยังสรุปไม่ได้ รอผู้จัดการ', daysAgoVal: 3 },
    { cus: 2, type: 'line', subject: 'อัปเดตสถานะเที่ยวเร่งด่วน', note: 'แจ้งผ่าน LINE กลุ่มว่าโหลดแล้ว ออกเดินทางเย็นนี้', daysAgoVal: 1 },
    { cus: 3, type: 'call', subject: 'ติดตามใบเสนอราคา', note: 'ลูกค้าบอกยังเทียบราคาอยู่ ขอเวลาอีก 1 สัปดาห์', daysAgoVal: 6 },
    { cus: 4, type: 'meeting', subject: 'เยี่ยมหน้างาน ลูกค้าใหม่', note: 'นำเสนอทีม ชอบระบบ POD มาก', daysAgoVal: 4 },
    { cus: 5, type: 'email', subject: 'สรุปยอดขนส่งรายเดือน', note: 'ส่งรายงานสรุปเดือนก่อนหน้าให้ฝ่ายบัญชี', daysAgoVal: 9 },
  ]
  interactionDefs.forEach((it) => {
    insertInteraction.run(
      customerIds[it.cus] ?? null,
      it.type,
      it.subject,
      it.note ?? null,
      iso(daysAgo(it.daysAgoVal, randInt(9, 17))),
      dispatcherId,
    )
  })

  // ============ CRM: งานติดตาม (tasks) ============
  const insertTask = db.prepare(
    `INSERT INTO customer_tasks (customer_id, title, due_at, status, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const taskDefs: { cus: number; title: string; due: number; status: string; note?: string }[] = [
    { cus: 1, title: 'โทรติดตามใบเสนอราคา', due: 1, status: 'pending', note: 'คุณสมชาย รอตัดสินใจ' },
    { cus: 2, title: 'ส่งใบเสนอราคาอาหารแช่แข็งให้ฝ่ายจัดซื้อ', due: 2, status: 'pending' },
    { cus: 4, title: 'เช็คน้ำหนักสินค้ากับคุณชัยวัฒน์', due: 1, status: 'pending' },
    { cus: 0, title: 'เตรียมเอกสารต่อสัญญารายปี', due: 7, status: 'pending', note: 'สัญญาหมดสิ้นเดือนหน้า' },
    { cus: 3, title: 'เสนอราคาใหม่หลังพักใบเดิม', due: -2, status: 'pending', note: 'เลยกำหนดแล้ว ต้องรีบติดต่อ' },
    { cus: 5, title: 'ส่งรายงานสรุปการใช้บริการรายเดือน', due: -4, status: 'done' },
  ]
  taskDefs.forEach((tk) => {
    insertTask.run(
      customerIds[tk.cus] ?? null,
      tk.title,
      tk.status === 'done' ? isoDate(daysAgo(5, 12)) : isoDate(addDays(new Date(), tk.due)),
      tk.status,
      tk.note ?? null,
      dispatcherId,
    )
  })
}

/** เติมเฉพาะเมื่อ DB ว่างเปล่า (ไม่มีผู้ใช้) */
export function seedIfEmpty(db: Database.Database): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }
  if (row.c > 0) return false
  seed(db)
  return true
}

/** สคริปต์ standalone: npm run seed */
import { pathToFileURL } from 'node:url'
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { openDb } = await import('./connection.js')
  const config = await import('../config.js')
  const db = openDb(config.config.dbPath)
  migrate(db)
  seed(db)
  const count = db.prepare(`SELECT COUNT(*) AS c FROM orders`).get() as { c: number }
  console.log(`✔ Seed เสร็จสิ้น — ออเดอร์ ${count.c} รายการ`)
  db.close()
}
