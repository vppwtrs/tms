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

function toWarehouse(item: unknown): Warehouse {
  /* **แต่ละรายการเป็นสตริงเปล่า ๆ ก็ได้** — บาง build ของ TMS ส่ง ["KM23-CW-01", ...]
     ไม่ใช่ object ตอนย้ายจาก extractor เข้าแอปเผลอตัดเคสนี้ทิ้ง ผลคือช่องเลือกคลัง
     ว่างเปล่าโดยไม่มี error ขึ้นเลย เพราะ map ได้ code เป็น '' แล้วโดน filter ออกหมด */
  if (typeof item === 'string') return { code: item, id: '', description: null }
  const w = (item ?? {}) as Record<string, unknown>
  return {
    code: s(w.name ?? w.warehouse ?? w.warehouseName ?? w.code),
    id: s(w.id ?? w.warehouseId ?? w.warehouseID),
    description: (w.description as string | null) ?? null,
  }
}

function unwrap(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  const o = (raw ?? {}) as { data?: unknown[]; items?: unknown[] }
  return o.data ?? o.items ?? []
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

  const list = personal.length ? personal : await searchWarehouses()
  return allowed(list)
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

  return {
    rows,
    pickingLists: new Set(rows.map((r) => r.pickingListNo)).size,
    trips: new Set(rows.map((r) => r.tripNo).filter(Boolean)).size,
    scanned,
    missingItems: headers.filter((h) => !(h.details ?? []).length).length,
  }
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
  picking_lists: number
  total_qty: number
  pending_import: number
  by_status: { pl_status: string; trip_status: string; picking_lists: number }[]
  recent_days: { date: string; picking_lists: number; pending: number }[]
}
