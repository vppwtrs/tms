import { supabase, toDataError } from './supabase.js'
import { tmsCall } from './tmsAuth.js'

/**
 * ดึงข้อมูลจาก TMS บริษัท แล้วส่งเข้า Supabase
 *
 * **แหล่งเดียวคือ Picking List** — เคยมีสองเส้น (PL กับ /v1/reports/actualshipment)
 * แล้วตัดเส้น actual ทิ้งเพราะไปดูของจริงในหน้า TMS แล้วพบว่า PL header ก้อนเดียว
 * ส่งครบกว่าทุกอย่างที่ระบบนี้ต้องใช้ และมีของที่ actual ไม่มีเลย: สถานะใบ สถานะเที่ยว
 * วันที่วางแผนส่ง ที่อยู่ปลายทาง และ details[] ที่ติดมาด้วยอยู่แล้ว
 * เส้น actual ต้องยิงหา item ทีละใบอีก ~23 request ต่อวัน เพื่อได้ข้อมูลที่น้อยกว่า
 *
 * ค่าคงที่ทุกตัวมาจากการวัดของจริง ไม่ใช่การเดา อย่าแก้โดยไม่วัดใหม่
 *
 * ลำดับ: ล็อกอิน TMS -> ดึง PL -> ส่งเข้า tms_shipments
 * จากนั้นเป็นคนละเรื่อง: จับคู่ร้าน -> นำเข้าเป็นออเดอร์ (ดู tms.ts)
 */

export interface Warehouse {
  code: string
  id: string
  description: string | null
}

/** 1 แถว = 1 item ของ 1 ใบ — ใบที่ไม่มี item ก็ยังได้แถวหนึ่งแถว ไม่ใช่หายไป */
export interface PlRow {
  pickingListNo: string
  planDeliveryDate: string
  tripDate: string
  tripNo: string
  plStatus: string
  tripStatus: string
  plType: string
  area: string
  dealerCode: string
  dealerName: string
  branch: string
  province: string
  customerAddress: string
  shipToName: string
  shipToAddress: string
  shipToProvince: string
  shipToPostCode: string
  unit: number | null
  totalQty: number | null
  pickupDate: string
  deliveryDate: string
  itemNo: string
  itemName: string
  itemQty: number | null
  itemSplitQty: number | null
  qtySource: 'qty' | 'split' | ''
}

const s = (v: unknown): string => (v == null ? '' : String(v))
const n = (v: unknown): number | null => (v === '' || v == null ? null : Number(v))
const day = (v: unknown): string => s(v).slice(0, 10)

/* ---------- คลัง ---------- */

/** รหัสคลังใน TMS บางหน้าถูกส่งมารวมกับชื่อเต็ม เช่น
 * `KM23-CW-01 - Vespiario (Thailand) Co., Ltd.` จึงต้องตัดให้เหลือรหัส
 * ก่อนนำไปเทียบกับคลังที่ระบบรับผิดชอบ */
function warehouseCode(value: unknown): string {
  const text = s(value).trim()
  const matched = text.match(/\bKM\d{2}-[A-Z]{2}-\d{2}\b/i)
  return (matched?.[0] ?? text).toUpperCase()
}

function toWarehouse(item: unknown): Warehouse {
  /* **แต่ละรายการเป็นสตริงเปล่า ๆ ก็ได้** — บาง build ของ TMS ส่ง ["KM23-CW-01", ...]
     ไม่ใช่ object ตอนย้ายจาก extractor เข้าแอปเผลอตัดเคสนี้ทิ้ง ผลคือช่องเลือกคลัง
     ว่างเปล่าโดยไม่มี error ขึ้นเลย เพราะ map ได้ code เป็น '' แล้วโดน filter ออกหมด */
  if (typeof item === 'string') return { code: warehouseCode(item), id: '', description: null }
  const w = (item ?? {}) as Record<string, unknown>
  return {
    /* TMS มีหลาย build ที่ใช้ warehouseCode/warehouseName แทน code/name
       ถ้าไม่รองรับจะได้ response จริงแต่แปลงเป็นรหัสว่าง แล้ว filter เหลือ 0 คลัง */
    code: warehouseCode(w.warehouseCode ?? w.warehouseNo ?? w.name ?? w.warehouse ?? w.warehouseName ?? w.code),
    id: s(w.warehouseGuid ?? w.guid ?? w.id ?? w.warehouseId ?? w.warehouseID),
    description: (w.description as string | null) ?? null,
  }
}

function unwrap(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  const o = (raw ?? {}) as { data?: unknown[] | { items?: unknown[]; data?: unknown[] }; items?: unknown[] }
  if (Array.isArray(o.items)) return o.items
  if (Array.isArray(o.data)) return o.data
  if (o.data && typeof o.data === 'object') {
    const nested = o.data as { items?: unknown[]; data?: unknown[] }
    return Array.isArray(nested.items) ? nested.items : Array.isArray(nested.data) ? nested.data : []
  }
  return []
}

/** ค้นคลังทั้งหมดที่บัญชีนี้เห็น — **ชื่อพารามิเตอร์ต้องเป็น pageNumber/pageSize**
 *  เคยส่ง page/pageSize/keyword ตามที่เดาเอาเอง แล้วได้ผลลัพธ์ว่างแบบไม่มี error
 *  ชื่อที่ถูกมาจาก extractor ที่ยิงกับของจริงมาก่อน อย่าแก้โดยไม่ทดสอบใหม่ */
async function searchWarehouses(): Promise<Warehouse[]> {
  const raw = await tmsCall<unknown>('/v1/warehouses/search', { pageNumber: 1, pageSize: 200 })
  return unwrap(raw).map(toWarehouse).filter((w) => w.code)
}

/** คลังที่ระบบนี้รับผิดชอบ — เจ้าของงานกำหนดเอง ไม่ใช่ทุกคลังที่บัญชี TMS มองเห็น
 *  บัญชีบางคนเห็นคลังของแผนกอื่นด้วย ซึ่งไม่ควรถูกดึงเข้าระบบนี้โดยบังเอิญ
 *  ปล่อยเป็น array ว่างเมื่อไหร่ = รับทุกคลังที่บัญชีเห็น */
export const ALLOWED_WAREHOUSES = ['KM23-CW-01', 'KM23-CW-02']

const allowed = (list: Warehouse[]): Warehouse[] =>
  ALLOWED_WAREHOUSES.length ? list.filter((w) => ALLOWED_WAREHOUSES.includes(w.code)) : list

export async function listWarehouses(): Promise<Warehouse[]> {
  /* /personal/warehouses คือคลังที่ผูกกับ "ตัวบุคคล" ซึ่งหลายบัญชีเป็นค่าว่าง
     ทั้งที่คนคนนั้นเปิดดูคลังได้จริงในหน้า TMS — extractor เลยมี KM23-CW-01
     ฝังเป็นค่าเริ่มต้นไว้กันเหนียว ที่นี่ไม่ฝังรหัสคลังลงโค้ด แต่ถอยไปถาม
     /v1/warehouses/search ซึ่งคืนคลังที่สิทธิ์ของบัญชีมองเห็นทั้งหมด */
  const personal = await tmsCall<unknown>('/personal/warehouses', undefined, 'GET')
    .then((raw) => unwrap(raw).map(toWarehouse).filter((w) => w.code))
    .catch(() => [] as Warehouse[])

  /* อย่าหยุดแค่ personal ถ้ามีรายการ แต่ไม่มีคลังที่เรารับผิดชอบ:
     กรณีนั้นเคยทำให้ระบบเห็นคลัง KM12 ของผู้ใช้หนึ่งรายการ แล้วตัดเป็น 0
     ทั้งที่ `/v1/warehouses/search` ยังมี KM23-CW-01/02 ซึ่งใช้ดึง Trip ได้ */
  const personalAllowed = allowed(personal)
  if (personalAllowed.length) return personalAllowed

  const searched = await searchWarehouses()
  const result = allowed(searched)
  if (!result.length) {
    const visible = [...new Set([...personal, ...searched].map((w) => w.code).filter(Boolean))]
    throw new Error(
      `ไม่พบคลังที่อนุญาต (${ALLOWED_WAREHOUSES.join(', ')}) จากบัญชี TMS` +
      (visible.length ? ` · คลังที่บัญชีเห็น: ${visible.slice(0, 6).join(', ')}` : ''),
    )
  }
  return result
}

/* GUID ของคลัง — ถามครั้งเดียวต่อรหัสแล้วจำไว้
   `/v1/tripheaders/{id}/search` อ้างคลังด้วย **GUID** ส่วน `/v1/pickinglistheaders/{code}/search`
   อ้างด้วย **รหัส** สองเส้นไม่เหมือนกัน ส่งผิดฝั่งได้ 404 ทุก request */
const whIdCache = new Map<string, string>()

export async function warehouseGuid(w: Warehouse): Promise<string> {
  if (w.id) return w.id
  const hit = whIdCache.get(w.code)
  if (hit) return hit

  for (const found of await searchWarehouses()) {
    if (found.id) whIdCache.set(found.code, found.id)
  }
  const id = whIdCache.get(w.code)
  if (!id) throw new Error(`หา GUID ของคลัง ${w.code} ไม่เจอ`)
  return id
}

/* ---------- Picking List ----------
 *
 * ข้อต่างที่ต้องรู้ก่อนแก้อะไรตรงนี้ (ยิงกับของจริงมาแล้ว):
 *   - อ้างคลังด้วย **รหัส** ไม่ใช่ GUID
 *   - **API ไม่มีช่องรับช่วงวันที่** ต้องดึงมาแล้วกรองฝั่งเรา สั่งเรียงจากใหม่ไปเก่า
 *     แล้วหยุดทันทีที่เจอหน้าที่เก่ากว่าวันเริ่มต้น ไม่งั้นคือไล่ทั้งคลัง ~15,000 ใบ
 *   - details[] ติดมากับ header อยู่แล้ว ไม่ต้องยิงหา item เพิ่ม
 */

/** สถานะของใบตามที่ TMS สะกดจริง — เรียงตามลำดับชีวิตของใบ */
export const PL_STATUS = ['New', 'AssignTrip', 'OnTruck', 'Completed'] as const
export type PlStatus = (typeof PL_STATUS)[number]

/** ใบที่ยังทำอะไรได้ — ตัวกรองนี้ใช้ตอน **นำเข้าเป็นออเดอร์** ไม่ใช่ตอนดึง
 *  ตอนดึงเก็บทุกสถานะรวม Completed เพราะต้องรู้ว่าใบที่เฝ้าอยู่จบแล้ว
 *  ถ้ากรองตอนดึง ใบที่ส่งจบจะหายจากตารางเงียบ ๆ แล้วไม่มีใครรู้ว่ามันไปไหน */
export const PL_PLANNABLE: PlStatus[] = ['New', 'AssignTrip', 'OnTruck']

interface PlDetail {
  itemNo?: string
  description?: string
  qty?: number
  splitQty?: number
}

interface PlHeader {
  pickingListNo?: string
  status?: string
  tripStatus?: string
  pickingListTypeName?: string
  planDeliveryDate?: string
  orderDate?: string
  pickupDate?: string
  deliveryDate?: string
  area?: string
  customerCode?: string
  customerName?: string
  customerAddress?: string
  customerProvince?: string
  shipToName?: string
  shipToAddress?: string
  shipToProvince?: string
  shipToPostCode?: string
  totalQty?: number
  tripNo?: string
  details?: PlDetail[]
}

const PL_PAGE_SIZE = 500
const PL_MAX_PAGES = 60

/** รอบเฝ้าสถานะ: 5 นาที — TMS เป็นระบบที่คนทั้งบริษัทใช้ ถี่กว่านี้คือไปกินทรัพยากรเขา
 *  โดยไม่ได้อะไรเพิ่ม สถานะงานขนส่งไม่เปลี่ยนถี่กว่านาที */
export const POLL_MS = 5 * 60 * 1000

/** รอบเฝ้าดึงแค่ 2 หน้าแรก (1,000 ใบล่าสุด) ไม่ใช่ทั้งคลัง
 *  เรียงจากวันวางแผนใหม่ไปเก่า ของที่ยังต้องเฝ้าจึงอยู่หน้าแรกเสมอ
 *  โหลดเต็มเก็บไว้ให้ปุ่ม "ดึงย้อนหลัง" ที่คนกดเอง — ไม่ใช่ของที่วนทุก 5 นาที */
const POLL_MAX_PAGES = 2

export interface PullResult {
  rows: PlRow[]
  pickingLists: number
  trips: number
  scanned: number
  missingItems: number
}

export async function pullPickingLists(
  opts: {
    from: string
    to: string
    warehouse: Warehouse
    statuses?: PlStatus[]
    maxPages?: number
  },
  onProgress?: (msg: string) => void,
): Promise<PullResult> {
  const path = `/v1/pickinglistheaders/${encodeURIComponent(opts.warehouse.code)}/search`
  const keep = new Set<string>(opts.statuses ?? [])
  const maxPages = opts.maxPages ?? PL_MAX_PAGES

  const headers: PlHeader[] = []
  let scanned = 0

  for (let page = 1; page <= maxPages; page++) {
    const r = await tmsCall<{ data?: PlHeader[]; items?: PlHeader[] }>(path, {
      orderBy: ['planDeliveryDate Descending'],
      pageNumber: page,
      pageSize: PL_PAGE_SIZE,
      keyword: null,
    })
    const batch = r.data ?? r.items ?? []
    scanned += batch.length

    let oldest = '9999-99-99'
    for (const h of batch) {
      const d = day(h.planDeliveryDate)
      if (d && d < oldest) oldest = d
      if (!d || d < opts.from || d > opts.to) continue
      if (keep.size && !keep.has(s(h.status))) continue
      headers.push(h)
    }

    onProgress?.(`สแกน ${scanned} ใบ · เข้าเงื่อนไข ${headers.length} ใบ`)

    /* เรียงจากใหม่ไปเก่า — หน้านี้เก่ากว่าวันเริ่มต้นแล้ว ที่เหลือก็เก่ากว่าทั้งหมด */
    if (oldest !== '9999-99-99' && oldest < opts.from) break
    if (batch.length < PL_PAGE_SIZE) break
  }

  return {
    rows: plRowsOf(headers),
    pickingLists: new Set(headers.map((h) => s(h.pickingListNo))).size,
    trips: new Set(headers.map((h) => s(h.tripNo)).filter(Boolean)).size,
    scanned,
    missingItems: headers.filter((h) => !(h.details ?? []).length).length,
  }
}

/** แปลง PL header เป็นแถวละ item — ใช้ทั้งเส้น PL และใบที่ติดมากับเที่ยว
 *  ใบที่ไม่มี item ยังได้แถวหนึ่งแถว ไม่ใช่หายไปเงียบ ๆ */
function plRowsOf(headers: PlHeader[]): PlRow[] {
  const rows: PlRow[] = []
  for (const h of headers) {
    const common = {
      pickingListNo: s(h.pickingListNo),
      planDeliveryDate: day(h.planDeliveryDate),
      /* orderDate = วันของเที่ยวที่ TMS จับใบนี้เข้าไป ว่างได้ถ้ายังไม่จัดเที่ยว
         คนละตัวกับ planDeliveryDate ห้ามยุบรวม (ดู 0012) */
      tripDate: day(h.orderDate),
      tripNo: s(h.tripNo),
      plStatus: s(h.status),
      tripStatus: s(h.tripStatus),
      plType: s(h.pickingListTypeName),
      area: s(h.area),
      dealerCode: s(h.customerCode),
      dealerName: s(h.customerName),
      branch: s(h.shipToName),
      province: s(h.customerProvince),
      customerAddress: s(h.customerAddress).trim(),
      shipToName: s(h.shipToName),
      shipToAddress: s(h.shipToAddress).trim(),
      shipToProvince: s(h.shipToProvince),
      shipToPostCode: s(h.shipToPostCode),
      unit: n(h.totalQty),
      totalQty: n(h.totalQty),
      pickupDate: day(h.pickupDate),
      deliveryDate: day(h.deliveryDate),
      /* ไม่มีทะเบียนกับคนขับใน PL — ใบที่ยังไม่ได้จัดเที่ยวยังไม่มีใครรับ
         ตั้งใจปล่อยว่าง ไม่ใช่ข้อมูลหาย */
    }
    const det = h.details ?? []
    if (!det.length) {
      rows.push({ ...common, itemNo: '', itemName: '', itemQty: null, itemSplitQty: null, qtySource: '' })
      continue
    }

    /* วัดของจริง 64 ใบแล้ว totalQty เท่ากับผลรวม qty ทุกใบ splitQty ยังไม่เคยจำเป็น
       แต่ยังบันทึกผลเทียบไว้เป็นตัวเฝ้าระวัง — วันไหน qtySource เริ่มว่างบ่อย ๆ
       แปลว่า TMS เปลี่ยนความหมายของ totalQty */
    const sumQty = det.reduce((t, d) => t + (Number(d.qty) || 0), 0)
    const sumSplit = det.reduce((t, d) => t + (Number(d.splitQty) || 0), 0)
    const u = Number(h.totalQty) || 0
    const qtySource: PlRow['qtySource'] = sumQty === u ? 'qty' : sumSplit === u ? 'split' : ''

    for (const d of det) {
      rows.push({
        ...common,
        itemNo: s(d.itemNo),
        itemName: s(d.description),
        itemQty: n(d.qty),
        itemSplitQty: n(d.splitQty),
        qtySource,
      })
    }
  }
  return rows
}

const iso = (offsetDays: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

/** รอบเฝ้าสถานะ — ย้อนหลัง 3 วันถึงล่วงหน้า 14 วัน 2 หน้าแรกเท่านั้น
 *  ย้อนหลัง 3 วันเพราะใบที่ส่งไปแล้วยังเปลี่ยนสถานะได้อีกวันสองวัน (ปิดงานย้อนหลัง)
 *  ล่วงหน้า 14 วันเพราะ TMS วางแผนล่วงหน้าไว้ ของพรุ่งนี้ต้องเห็นวันนี้ */
export async function pullRecent(warehouse: Warehouse, onProgress?: (msg: string) => void): Promise<PullResult> {
  return pullPickingLists(
    { from: iso(-3), to: iso(14), warehouse, maxPages: POLL_MAX_PAGES },
    onProgress,
  )
}

/* ---------- ส่งเข้า Supabase ---------- */

/* แบ่งส่งทีละก้อน — วันเดียวก็หลายร้อยแถว ส่งทีเดียวหมดคือถ้าเน็ตสะดุดกลางทางเสียทั้งก้อน
   ส่งซ้ำก้อนเดิมปลอดภัย เพราะ push_tms_shipments เป็น upsert ที่เทียบ row_hash ก่อนเขียน */
const PUSH_CHUNK = 400

export interface PushResult {
  rows: number
  inserted: number
  updated: number
  unchanged: number
  dates: string[]
}

export async function pushShipments(
  rows: PlRow[],
  onProgress?: (sent: number, total: number) => void,
): Promise<PushResult> {
  const num = (v: number | null): string => (v == null ? '' : String(v))
  const payload = rows
    .filter((r) => r.pickingListNo && r.planDeliveryDate)
    .map((r) => ({
      pickingListNo: r.pickingListNo,
      itemNo: r.itemNo,
      itemName: r.itemName,
      itemQty: num(r.itemQty),
      itemSplitQty: num(r.itemSplitQty),
      qtySource: r.qtySource,
      tripNo: r.tripNo,
      tripDate: r.tripDate,
      planDeliveryDate: r.planDeliveryDate,
      plStatus: r.plStatus,
      tripStatus: r.tripStatus,
      plType: r.plType,
      area: r.area,
      dealerCode: r.dealerCode,
      dealerName: r.dealerName,
      branch: r.branch,
      province: r.province,
      customerAddress: r.customerAddress,
      shipToName: r.shipToName,
      shipToAddress: r.shipToAddress,
      shipToProvince: r.shipToProvince,
      shipToPostCode: r.shipToPostCode,
      unit: num(r.unit),
      totalQty: num(r.totalQty),
      pickupDate: r.pickupDate,
      deliveryDate: r.deliveryDate,
    }))

  const out: PushResult = { rows: 0, inserted: 0, updated: 0, unchanged: 0, dates: [] }
  const dates = new Set<string>()
  let sent = 0

  for (let i = 0; i < payload.length; i += PUSH_CHUNK) {
    const chunk = payload.slice(i, i + PUSH_CHUNK)
    const { data, error } = await supabase.rpc('push_tms_shipments', { p_rows: chunk })
    if (error) throw toDataError(error)
    out.rows += data?.rows ?? 0
    out.inserted += data?.inserted ?? 0
    out.updated += data?.updated ?? 0
    out.unchanged += data?.unchanged ?? 0
    for (const d of data?.dates ?? []) dates.add(d)
    sent += chunk.length
    onProgress?.(sent, payload.length)
  }

  out.dates = [...dates]
  return out
}

/* ---------- Trip: "ใครวิ่ง ถึงไหนแล้ว" ----------
 *
 * วัดของจริงก่อนเขียน: KM23-CW-02 มี 172 เที่ยว carrier เป็น Fleet Owner ล้วน
 * KM23-CW-01 มี 4,200 เที่ยวแต่ของเราแค่ 66 จาก 200 แถวแรก ที่เหลือเป็น outsource
 * KM12-MQ-01 มี 1,940 เที่ยวและ **ไม่มีของเราเลย** — จึงกรองด้วย carrier ไม่ใช่ด้วยคลัง
 *
 * กองรถเราวิ่งวันละ 2–6 เที่ยว หน้าแรก 200 แถวจึงย้อนหลังได้เป็นสัปดาห์
 */

/** carrier ที่เป็นกองรถของบริษัท — เจ้าอื่นคือ outsource ไม่ใช่งานคนขับเรา
 *  รายการเดียวกันนี้อยู่ในตาราง `tms_carriers` ด้วย ฐานกรองซ้ำอีกชั้น
 *  ไม่ใช่ซ้ำซ้อนโดยไม่จำเป็น — ฐานต้องไม่พึ่งว่า client กรองมาถูก */
export const OUR_CARRIERS = ['Fleet Owner', 'Fleet Owner (Scooter)']

const ourCarrier = (value: string): string | null => {
  const normalized = value.trim().toLowerCase()
  return OUR_CARRIERS.find((name) => name.toLowerCase() === normalized) ?? null
}

/**
 * Trip API ของ TMS แต่ละรุ่นวาง Carrier ไม่เหมือนกัน บางรุ่นเป็น
 * `carrierName`, บางรุ่นซ่อนไว้ใน object ที่มากับ header จึงอ่านชื่อที่รู้จัก
 * จากทั้ง payload โดยไม่เดาชื่อ field อีกต่อไป
 *
 * จำกัดความลึกและจำนวน node เพื่อให้ payload ที่ผิดปกติไม่ทำให้หน้าเว็บค้าง
 */
function findOurCarrier(value: unknown, depth = 0, seen = new Set<unknown>()): string | null {
  if (typeof value === 'string') return ourCarrier(value)
  if (!value || typeof value !== 'object' || depth >= 5 || seen.has(value)) return null
  seen.add(value)

  const values = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>)
  for (const child of values) {
    const found = findOurCarrier(child, depth + 1, seen)
    if (found) return found
  }
  return null
}

/** สถานะเที่ยวตามที่ TMS ใช้จริง (statusId ตรงตัว) */
export const TRIP_STATUS: Record<number, string> = {
  2: 'Confirm',
  3: 'Handling',
  4: 'OnDelivery',
  5: 'Completed',
  6: 'Cancelled',
}

interface TripHeader {
  id?: string
  tripNo?: string
  warehouseId?: string
  warehouse?: string
  orderDate?: string
  licensePlate?: string
  driver?: string
  carrierId?: string
  carrierName?: string
  vehicleTypeName?: string
  area?: string
  cost?: number
  actualCost?: number
  statusId?: number
  status?: string
  reason?: string | null
  onDeliveryDate?: string | null
  totalPL?: number
  totalUnit?: number
  pickingLists?: PlHeader[]
}

/* ชื่อคอลัมน์ที่เห็นบนหน้า Trip ไม่ได้ตรงกับ JSON ทุก build ของ TMS
   normalize ตรงนี้ให้เหลือรูปเดียวก่อนกรอง/ส่งฐานข้อมูล จะได้ไม่เกิดกรณี
   หน้า Trip มีข้อมูลแต่ client อ่าน orderDate/carrierName เป็นค่าว่างทั้งหมด */
function toTripHeader(item: unknown): TripHeader {
  const t = (item ?? {}) as Record<string, unknown>
  const carrier = (t.carrier ?? {}) as Record<string, unknown>
  const driver = (t.driver ?? {}) as Record<string, unknown>
  const vehicle = (t.vehicleType ?? t.vehicle ?? {}) as Record<string, unknown>
  return {
    id: s(t.id ?? t.tripId ?? t.tripID),
    tripNo: s(t.tripNo ?? t.tripNumber ?? t.trip_no),
    warehouseId: s(t.warehouseId ?? t.warehouseGuid ?? t.warehouseID),
    warehouse: s(t.warehouse ?? t.warehouseCode ?? t.warehouseName),
    orderDate: s(t.orderDate ?? t.tripDate ?? t.trip_date),
    licensePlate: s(t.licensePlate ?? t.license_plate ?? t.plateNo),
    driver: s(t.driverName ?? t.driver_name ?? driver.name ?? driver.fullName ?? t.driver),
    carrierId: s(t.carrierId ?? carrier.id),
    carrierName: s(t.carrierName ?? t.carrier_name ?? carrier.name ?? carrier.carrierName ?? t.carrier) || findOurCarrier(t) || '',
    vehicleTypeName: s(t.vehicleTypeName ?? t.vehicle_type ?? vehicle.name ?? vehicle.type ?? t.vehicleType),
    area: s(t.area ?? t.areaName),
    cost: Number(t.cost ?? 0),
    actualCost: Number(t.actualCost ?? t.actual_cost ?? 0),
    statusId: Number(t.statusId ?? t.status_id ?? 0),
    status: s(t.status ?? t.statusName ?? t.tripStatus),
    reason: (t.reason as string | null) ?? null,
    onDeliveryDate: (t.onDeliveryDate ?? t.on_delivery_date ?? null) as string | null,
    totalPL: Number(t.totalPL ?? t.totalPl ?? t.totalPickingLists ?? 0),
    totalUnit: Number(t.totalUnit ?? t.totalUnits ?? 0),
    pickingLists: (t.pickingLists ?? t.pickingList ?? []) as PlHeader[],
  }
}

const TRIP_PAGE_SIZE = 200

export interface TripPullResult {
  /** เที่ยวของกองรถเราเท่านั้น พร้อม pickingLists ที่ติดมา */
  trips: TripHeader[]
  /** ใบในเที่ยวเหล่านั้น แปลงเป็นรูปเดียวกับฝั่ง PL เพื่อใช้ pushShipments ตัวเดิม */
  rows: PlRow[]
  scanned: number
  outsourced: number
}

/** ดึงเที่ยวของกองรถเรา — ไม่ระบุวัน เพราะ API ไม่มีช่องรับช่วงวันที่ (เหมือนฝั่ง PL)
 *  เรียงจากวันใหม่ไปเก่า แล้วหยุดเมื่อพ้นช่วงที่ขอ */
export async function pullTrips(
  opts: { from: string; to: string; warehouse: Warehouse; maxPages?: number },
  onProgress?: (msg: string) => void,
): Promise<TripPullResult> {
  const guid = await warehouseGuid(opts.warehouse)
  const path = `/v1/tripheaders/${encodeURIComponent(guid)}/search`
  const maxPages = opts.maxPages ?? 2

  const trips: TripHeader[] = []
  let scanned = 0
  let outsourced = 0

  for (let page = 1; page <= maxPages; page++) {
    const r = await tmsCall<unknown>(path, {
      orderBy: ['orderDate Descending'],
      pageNumber: page,
      pageSize: TRIP_PAGE_SIZE,
      keyword: null,
    })
    const batchRaw = unwrap(r)
    const batch = batchRaw.map(toTripHeader)
    scanned += batch.length

    let oldest = '9999-99-99'
    for (const t of batch) {
      const d = day(t.orderDate)
      if (d && d < oldest) oldest = d
      if (!d || d < opts.from || d > opts.to) continue
      const carrierName = ourCarrier(s(t.carrierName))
      if (!carrierName) {
        outsourced++
        continue
      }
      /* ส่งชื่อมาตรฐานให้ RPC เพราะฐานกรองด้วยชื่อ carrier แบบ exact */
      trips.push({ ...t, carrierName })
    }

    onProgress?.(`สแกน ${scanned} เที่ยว · ของกองรถเรา ${trips.length}`)

    if (oldest !== '9999-99-99' && oldest < opts.from) break
    if (batch.length < TRIP_PAGE_SIZE) break
  }

  /* ใบที่อยู่ในเที่ยวเราแปลงด้วยตัวเดียวกับฝั่ง PL — ที่อยู่ปลายทางที่ติดมากับ trip
     เป็นแบบเต็ม ("104 หมู่ที่ 7 บางกรวย นนทบุรี THA 11130") ต่างจาก PL search
     ที่ส่งมาเป็นบรรทัดเดียวห้วน ๆ จึงคุ้มที่จะ push ใบจากเส้นนี้ทับของเดิม */
  const rows = plRowsOf(trips.flatMap((t) => t.pickingLists ?? []))

  return { trips, rows, scanned, outsourced }
}

/** รอบเฝ้าสถานะฝั่งเที่ยว — ย้อนหลัง 3 วันถึงล่วงหน้า 14 วัน เหมือนฝั่ง PL */
export async function pullRecentTrips(
  warehouse: Warehouse,
  onProgress?: (msg: string) => void,
): Promise<TripPullResult> {
  return pullTrips({ from: iso(-3), to: iso(14), warehouse }, onProgress)
}

export interface TripPushResult {
  seen: number
  inserted: number
  updated: number
  unchanged: number
  skipped_carrier: number
  /** จำนวน **แถว item** ที่ผูกเข้าเที่ยว ไม่ใช่จำนวนใบ — ใบเดียวมีหลายแถวได้ */
  linked_pl: number
  /** เที่ยว/ออเดอร์ฝั่งเราที่สถานะขยับตาม TMS ในรอบนี้ (ไหลไปข้างหน้าทางเดียว) */
  synced_trips: number
  synced_orders: number
}

/** ส่งเที่ยวขึ้นระบบ — ต้อง push ใบ (pushShipments) **ก่อน** ถ้าอยากให้ผูกใบเข้าเที่ยวติดรอบเดียว
 *  สลับลำดับก็ไม่พัง แค่ใบจะไปผูกในรอบถัดไป (ฟังก์ชันผูกด้วยเลข PL ทุกครั้งที่เรียก) */
export async function pushTrips(trips: TripHeader[]): Promise<TripPushResult> {
  const out: TripPushResult = {
    seen: 0, inserted: 0, updated: 0, unchanged: 0, skipped_carrier: 0, linked_pl: 0,
    synced_trips: 0, synced_orders: 0,
  }
  if (!trips.length) return out

  /* ตัด details[] ของใบออกก่อนส่ง — ฟังก์ชันฝั่งฐานใช้แค่ pickingListNo เพื่อผูกใบเข้าเที่ยว
     เนื้อใบมีทางเข้าทางเดียวคือ push_tms_shipments ส่ง details มาก็ถูกทิ้ง แต่กิน bandwidth
     ของคนที่เปิดหน้านี้ผ่านมือถือฟรี ๆ */
  const payload = trips.map((t) => ({
    ...t,
    /* RPC ใช้ warehouse เป็นรหัสคลัง ไม่ใช่ warehouseId (GUID) */
    warehouse: t.warehouse ?? '',
    pickingLists: (t.pickingLists ?? []).map((p) => ({ pickingListNo: p.pickingListNo })),
  }))

  for (let i = 0; i < payload.length; i += 50) {
    const chunk = payload.slice(i, i + 50)
    /* ตัวห่อที่ push แล้วให้สถานะไหลเข้าเที่ยวที่นำเข้าแล้วต่อทันที
       ฐานเป็นคนตัดสินว่าอัปเดตอะไรได้ หน้าจอไม่ได้ส่งสถานะไปบอก
       และการไหลเป็นทางเดียว — คนขับปิดงานแล้ว TMS ยัง OnDelivery ก็ห้ามถอยกลับ */
    const { data, error } = await supabase.rpc('push_tms_trips_and_sync', { p_rows: chunk })
    if (error) throw toDataError(error)
    const d = (data ?? {}) as { push?: Partial<TripPushResult>; synced_trips?: number; synced_orders?: number }
    const p = d.push ?? {}
    out.seen += p.seen ?? 0
    out.inserted += p.inserted ?? 0
    out.updated += p.updated ?? 0
    out.unchanged += p.unchanged ?? 0
    out.skipped_carrier += p.skipped_carrier ?? 0
    out.linked_pl += p.linked_pl ?? 0
    out.synced_trips += d.synced_trips ?? 0
    out.synced_orders += d.synced_orders ?? 0
  }
  return out
}

/** กระดานสถานะ — วันล่าสุดที่มีงาน ยอดใบ ยอดคัน และแยกตามสถานะ
 *  ไม่ส่งวันมา = ฟังก์ชันเลือกวันล่าสุดที่มีงานจริงให้ ไม่ใช่ "วันนี้" (ดู 0012) */
export async function tmsBoard(date?: string): Promise<TmsBoard> {
  const { data, error } = await supabase.rpc('tms_board', { p_date: date ?? null })
  if (error) throw toDataError(error)
  return data as TmsBoard
}

export interface TmsBoard {
  date: string | null
  latest_date: string | null
  synced_at: string | null
  last_change_at: string | null
  /* ฝั่งเที่ยวเป็นตัวหลัก — คนจัดรถคิดเป็นเที่ยว ไม่ได้คิดเป็นใบ */
  trips: number
  trips_pending_import: number
  trips_by_status: { status: string; status_id: number; trips: number; units: number }[]
  /* จำนวนแยกตามชนิดงานจาก TMS — รถ / กล่อง */
  by_kind?: { kind: 'vehicle' | 'box'; trips: number; units: number }[]
  picking_lists: number
  total_qty: number
  pending_import: number
  by_status: { pl_status: string; trip_status: string; picking_lists: number }[]
  recent_days: { date: string; trips: number; picking_lists: number; pending: number }[]
}
