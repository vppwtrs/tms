import { supabase, toDataError } from './supabase.js'
import { tmsCall } from './tmsAuth.js'

/**
 * ดึงข้อมูลจาก TMS บริษัท แล้วส่งเข้า Supabase
 *
 * ย้ายมาจาก extractor/tms-extractor/public/app.js — ตัวนั้นเจอของจริงมาก่อน
 * และค่าคงที่ทุกตัวในไฟล์นี้มาจากการวัดข้อมูลจริง ไม่ใช่การเดา อย่าแก้โดยไม่วัดใหม่
 *
 * ลำดับ: ล็อกอิน TMS -> ดึงรายงาน -> เติมชื่อ item -> ส่งเข้า tms_shipments
 * จากนั้นเป็นคนละเรื่อง: จับคู่ร้าน -> นำเข้าเป็นออเดอร์ (ดู tms.ts)
 */

export interface Warehouse {
  code: string
  id: string
  description: string | null
}

export interface ShipmentRow {
  orderDate: string
  tripNo: string
  pickingListNo: string
  dealerCode: string
  dealerName: string
  branch: string
  province: string
  unit: number | null
  licensePlate: string
  driver: string
  deliveryDate: string
  statusDelivery: string
  area: string
  actualCost: number | null
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

/** รายงาน actualshipment อ้าง warehouse ด้วย GUID ส่วน pickinglistheaders อ้างด้วยรหัส
 *  ต้องเก็บทั้งคู่ ไม่ใช่อย่างใดอย่างหนึ่ง — เคยพลาดตรงนี้มาแล้ว */
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

export async function listWarehouses(): Promise<Warehouse[]> {
  /* /personal/warehouses คือคลังที่ผูกกับ "ตัวบุคคล" ซึ่งหลายบัญชีเป็นค่าว่าง
     ทั้งที่คนคนนั้นเปิดดูคลังได้จริงในหน้า TMS — extractor เลยมี KM23-CW-01
     ฝังเป็นค่าเริ่มต้นไว้กันเหนียว ที่นี่ไม่ฝังรหัสคลังลงโค้ด แต่ถอยไปถาม
     /v1/warehouses/search ซึ่งคืนคลังที่สิทธิ์ของบัญชีมองเห็นทั้งหมด */
  const personal = await tmsCall<unknown>('/personal/warehouses', undefined, 'GET')
    .then((raw) => unwrap(raw).map(toWarehouse).filter((w) => w.code))
    .catch(() => [] as Warehouse[])

  if (personal.length) return personal
  return searchWarehouses()
}

/* GUID ของคลัง ถามครั้งเดียวต่อรหัส — /personal/warehouses บาง build ไม่ส่ง id มาให้
   แต่ /v1/reports/actualshipment อ้างคลังด้วย GUID เท่านั้น ส่งรหัสไปได้ผลลัพธ์ว่าง
   ยกวิธีมาจาก extractor/tms-extractor/public/app.js ที่ใช้งานได้จริงมาก่อน */
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

/* ---------- รายงาน ---------- */

interface RawShipment {
  [k: string]: unknown
}

/** ดึงรายงาน Actual Shipment ของช่วงวันที่ — คืน 1 แถวต่อ 1 บรรทัดรายงาน ยังไม่มี item */
async function fetchReport(from: string, to: string, warehouseId: string): Promise<RawShipment[]> {
  /* ส่งเป็น UTC เที่ยงคืนของวันที่เลือก เพื่อให้ date part ที่ API เห็นตรงกับที่ผู้ใช้เลือก
     ถ้าส่ง local time ผู้ใช้ที่อยู่ +07 จะได้ข้อมูลเหลื่อมไปหนึ่งวัน */
  const raw = await tmsCall<unknown>('/v1/reports/actualshipment', {
    planDeliveryDate: [`${from}T00:00:00.000Z`, `${to}T00:00:00.000Z`],
    warehouseId,
  })
  return (Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? [])) as RawShipment[]
}

/* ---------- เติมชื่อ item ----------
   รายงานไม่ส่ง item มาให้ มีแต่ pickingListNo ต้องไปดึงจาก pickinglistheaders

   ค้นทีละใบด้วย keyword ไม่ไล่หน้าทั้งคลัง: คลังนี้มี PL รวม ~15,000 ใบ (30 หน้า × 500)
   การไล่หน้าคือดึงมาทั้งหมดเพื่อใช้ไม่กี่สิบใบ ส่วนการค้นทีละใบใช้ ~23 request ต่อวัน
   และ TMS รับ keyword ที่มีหาง -C-04 ได้ตรง ๆ (ทดสอบกับของจริงแล้ว) */

/** เลข PL ในรายงานบางใบมีหาง -C-04 = ใบนั้นถูกแบ่งส่งหลายเที่ยว
 *  ลองทั้งแบบเต็มและแบบตัดหาง เพราะ PL header อาจเก็บแบบไหนก็ได้ */
function plKeyVariants(no: string): string[] {
  const full = no.trim()
  const base = full.replace(/-[A-Za-z]+-\d+$/, '')
  return base !== full ? [full, base] : [full]
}

/* ยิงพร้อมกันทีละ 5 — ไม่ใช่ทั้งหมดพร้อมกัน นี่คือ TMS ของบริษัทที่คนทั้งบริษัทใช้อยู่
   ยิงรัวเป็นร้อย request พร้อมกันคือไปกินทรัพยากรเขา */
const CHUNK = 5

interface PlDetail {
  itemNo?: string
  description?: string
  qty?: number
  splitQty?: number
}

async function fetchDetails(
  warehouseCode: string,
  wanted: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, PlDetail[]>> {
  const found = new Map<string, PlDetail[]>()
  const path = `/v1/pickinglistheaders/${encodeURIComponent(warehouseCode)}/search`

  for (let i = 0; i < wanted.length; i += CHUNK) {
    const batch = wanted.slice(i, i + CHUNK)
    await Promise.all(
      batch.map(async (key) => {
        try {
          const r = await tmsCall<{ data?: { pickingListNo?: string; details?: PlDetail[] }[] }>(path, {
            orderBy: [],
            pageNumber: 1,
            pageSize: 5,
            keyword: key,
          })
          for (const h of r.data ?? []) {
            if (h.pickingListNo) found.set(h.pickingListNo, h.details ?? [])
          }
        } catch {
          /* ใบเดียวหาไม่เจอไม่ควรทำให้ทั้งวันล้ม — ใบนั้นจะไปโผล่ในช่อง item ว่างแทน */
        }
      }),
    )
    onProgress?.(Math.min(i + CHUNK, wanted.length), wanted.length)
  }
  return found
}

/* ---------- ประกอบร่าง ---------- */

export interface PullResult {
  rows: ShipmentRow[]
  pickingLists: number
  trips: number
  missingItems: number
  qtyMismatch: number
}

export async function pullShipments(
  opts: {
    from: string
    to: string
    warehouse: Warehouse
    withItems?: boolean
  },
  onProgress?: (msg: string) => void,
): Promise<PullResult> {
  onProgress?.('กำลังดึงรายงาน...')
  const report = await fetchReport(opts.from, opts.to, await warehouseGuid(opts.warehouse))

  const base = report.map((a) => ({
    orderDate: day(a.orderDate),
    tripNo: s(a.tripNo),
    pickingListNo: s(a.pickingListNo),
    dealerCode: s(a.dealerCode),
    dealerName: s(a.dealerName),
    branch: s(a.branch),
    province: s(a.province),
    unit: n(a.unit),
    licensePlate: s(a.licensePlate),
    driver: s(a.driver),
    deliveryDate: day(a.deliveryDate),
    statusDelivery: s(a.statusDelivery),
    area: s(a.area),
    actualCost: n(a.actualCost),
  }))

  const pickingLists = new Set(base.map((r) => r.pickingListNo)).size
  const trips = new Set(base.map((r) => r.tripNo)).size

  if (!opts.withItems || !base.length) {
    return {
      rows: base.map((r) => ({ ...r, itemNo: '', itemName: '', itemQty: null, itemSplitQty: null, qtySource: '' as const })),
      pickingLists,
      trips,
      missingItems: 0,
      qtyMismatch: 0,
    }
  }

  const wanted = [...new Set(base.flatMap((r) => plKeyVariants(r.pickingListNo)))]
  const details = await fetchDetails(opts.warehouse.code, wanted, (d, t) =>
    onProgress?.(`หาชื่อสินค้า ${d}/${t} ใบ`),
  )

  const rows: ShipmentRow[] = []
  let missingItems = 0
  let qtyMismatch = 0

  for (const r of base) {
    const det = plKeyVariants(r.pickingListNo)
      .map((k) => details.get(k))
      .find((d) => d && d.length)

    if (!det) {
      missingItems++
      rows.push({ ...r, itemNo: '', itemName: '', itemQty: null, itemSplitQty: null, qtySource: '' })
      continue
    }

    /* วัดจาก 40 ใบจริง (รวมใบที่มีหาง -C-0n): unit เท่ากับผลรวม qty ทั้ง 40 ใบ
       splitQty ไม่เคยจำเป็นเลย — แต่ยังบันทึกผลเทียบไว้เป็นตัวเฝ้าระวัง
       ถ้าวันหนึ่ง qtySource เริ่มเป็นค่าว่างบ่อย ๆ แปลว่า TMS เปลี่ยนความหมายของ unit */
    const sumQty = det.reduce((t, d) => t + (Number(d.qty) || 0), 0)
    const sumSplit = det.reduce((t, d) => t + (Number(d.splitQty) || 0), 0)
    const u = r.unit ?? 0
    const qtySource: ShipmentRow['qtySource'] = sumQty === u ? 'qty' : sumSplit === u ? 'split' : ''
    if (!qtySource) qtyMismatch++

    for (const d of det) {
      rows.push({
        ...r,
        itemNo: s(d.itemNo),
        itemName: s(d.description),
        itemQty: n(d.qty),
        itemSplitQty: n(d.splitQty),
        qtySource,
      })
    }
  }

  return { rows, pickingLists, trips, missingItems, qtyMismatch }
}

/* ---------- ส่งเข้า Supabase ---------- */

/* แบ่งส่งทีละก้อน — วันเดียวก็หลายร้อยแถว ส่งทีเดียวหมดคือถ้าเน็ตสะดุดกลางทางเสียทั้งก้อน
   ส่งซ้ำก้อนเดิมปลอดภัย เพราะ push_tms_shipments เป็น upsert */
const PUSH_CHUNK = 400

export async function pushShipments(
  rows: ShipmentRow[],
  onProgress?: (sent: number, total: number) => void,
): Promise<{ rows: number; dates: string[] }> {
  const payload = rows
    .filter((r) => r.pickingListNo && r.orderDate)
    .map((r) => ({
      pickingListNo: r.pickingListNo,
      itemNo: r.itemNo,
      itemName: r.itemName,
      itemQty: r.itemQty == null ? '' : String(r.itemQty),
      itemSplitQty: r.itemSplitQty == null ? '' : String(r.itemSplitQty),
      qtySource: r.qtySource,
      tripNo: r.tripNo,
      /* คอลัมน์ในรายงานชื่อ "Trip Date" แต่ฟิลด์ที่ API ส่งมาคือ orderDate
         ไม่ใช่ planDeliveryDate ซึ่งเป็นแค่ชื่อพารามิเตอร์ตอนค้นหา (ดู 0006) */
      tripDate: r.orderDate,
      dealerCode: r.dealerCode,
      dealerName: r.dealerName,
      branch: r.branch,
      province: r.province,
      unit: r.unit == null ? '' : String(r.unit),
      licensePlate: r.licensePlate,
      driver: r.driver,
      statusDelivery: r.statusDelivery,
      actualCost: r.actualCost == null ? '' : String(r.actualCost),
      deliveryDate: r.deliveryDate,
      area: r.area,
    }))

  let sent = 0
  const dates = new Set<string>()

  for (let i = 0; i < payload.length; i += PUSH_CHUNK) {
    const chunk = payload.slice(i, i + PUSH_CHUNK)
    const { data, error } = await supabase.rpc('push_tms_shipments', { p_rows: chunk })
    if (error) throw toDataError(error)
    sent += data?.rows ?? 0
    for (const d of data?.dates ?? []) dates.add(d)
    onProgress?.(sent, payload.length)
  }

  return { rows: sent, dates: [...dates] }
}

/** ข้อมูลของวันนั้นถูกดึงไปหรือยัง — หน้าจอใช้ขึ้นแถบเตือนตอนเช้า */
export async function syncStatus(date: string): Promise<{
  date: string
  synced_at: string | null
  picking_lists: number
  pending_import: number
}> {
  const { data, error } = await supabase.rpc('tms_sync_status', { p_date: date })
  if (error) throw toDataError(error)
  return data
}
