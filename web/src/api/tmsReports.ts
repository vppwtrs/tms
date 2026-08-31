import { tmsOp } from './tmsAuth'
import { plRowsOf, pullPickingLists, warehouseGuid, type PlHeader, type Warehouse } from './tmsPull'

/**
 * รายงานที่อ่านสดจาก TMS บริษัท — ไม่แตะฐานของเราเลย
 *
 * ต่างจาก `tmsPull` ตรงเจตนา: ที่นั่นดึงมาเพื่อ **นำเข้า** เป็นงานของคนขับ
 * ที่นี่ดึงมาเพื่อ **อ่าน** อย่างเดียว ไม่มีการเขียนลงฐานเรา ไม่มีการจับคู่ร้าน
 * เปิดหน้าแล้วเห็นของที่ TMS เห็น ณ ตอนนั้น แล้วเอาออกเป็นไฟล์ได้
 *
 * ราคาที่จ่ายคือทุกครั้งที่เปิดคือคำขอจริงไปถึงไทย ช้ากว่าอ่านจากฐานเราหลายวินาที
 * และต้องล็อกอินด้วยบัญชี TMS บริษัทค้างไว้ — เจ้าของงานเลือกทางนี้เพราะต้องการ
 * ตัวเลขที่ตรงกับหน้าจอ TMS เป๊ะ ไม่ใช่ตัวที่รอบดึงของเราเก็บมาได้
 */

/** หนึ่งบรรทัดของรายงาน Actual Shipment
 *
 *  ชื่อช่องยืนยันกับของจริงแล้วเมื่อ 31 ส.ค. 2569 (487 บรรทัด คลัง KM23-CW-01):
 *  pickupDate · onDeliveryDate · deliveryDate · statusDelivery · sla · actualCost ·
 *  tripNo · orderDate · pickingListNo · pickingListTypeName · dealerCode · dealerName ·
 *  branch · province · unit · licensePlate · driver · planPickupDate · outsource ·
 *  type · area · tripReason · pickingListReason
 *
 *  **ไม่มีช่อง planDeliveryDate ในคำตอบ** ทั้งที่ใช้ชื่อนี้กรองตอนส่งคำขอ —
 *  รอบแรกจึงแปลงคอลัมน์ "วางแผนส่ง" ออกมาว่างทั้งแถว ตัวที่ TMS ส่งกลับมาคือ
 *  planPickupDate (แผนรับของ) กับ onDeliveryDate (กำหนดส่ง) ซึ่งคนละความหมายกัน
 *  จึงแยกเป็นสองคอลัมน์ ไม่ยุบเป็นช่องเดียวที่อ่านแล้วไม่รู้ว่าเป็นวันอะไร
 *
 *  เก็บก้อนดิบไว้ด้วย (`raw`) เผื่อ build ของ TMS เปลี่ยนชื่อช่องในอนาคต */
export interface ActualShipmentRow {
  /** รหัสคลังที่บรรทัดนี้มาจาก — รายงานดึงทุกคลังที่ระบบรับผิดชอบมารวมกัน
   *  ถ้าไม่ติดไว้ คนอ่านจะแยกไม่ออกว่าเที่ยวนี้ของ KM.12 หรือ KM.21 */
  warehouse: string
  pickingListNo: string
  pickingListType: string
  orderDate: string
  planPickupDate: string
  pickupDate: string
  onDeliveryDate: string
  deliveryDate: string
  tripNo: string
  dealerCode: string
  dealerName: string
  branch: string
  province: string
  area: string
  licensePlate: string
  driverName: string
  /** ผู้ขนส่งภายนอก — ว่าง = กองรถของบริษัทเอง */
  outsource: string
  type: string
  unit: number | null
  actualCost: number | null
  /** สถานะการส่ง กับ SLA ที่ TMS ตัดสินให้ (เช่น ตรงเวลา/ช้า) — คำเต็มมาจากเขา ไม่ได้แปลเอง */
  statusDelivery: string
  sla: string
  reason: string
  raw: Record<string, unknown>
}

const s = (v: unknown): string => (v == null ? '' : String(v))
const n = (v: unknown): number | null => (v === '' || v == null ? null : Number(v))
const day = (v: unknown): string => s(v).slice(0, 10)

/** ชื่อช่องเดียวกันมาได้หลายแบบตาม build ของ TMS — ลองตามลำดับ ไม่ใช่ยึดชื่อเดียว
 *  เคยยึดชื่อเดียวแล้วได้ค่าว่างทั้งคอลัมน์โดยไม่มี error อะไรฟ้อง */
const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]
  return null
}

function toRow(item: unknown, warehouse: string): ActualShipmentRow {
  const o = (item ?? {}) as Record<string, unknown>
  return {
    warehouse,
    pickingListNo: s(pick(o, 'pickingListNo', 'pickingListNumber')),
    pickingListType: s(pick(o, 'pickingListTypeName', 'type')),
    orderDate: day(pick(o, 'orderDate')),
    planPickupDate: day(pick(o, 'planPickupDate')),
    pickupDate: day(pick(o, 'pickupDate')),
    onDeliveryDate: day(pick(o, 'onDeliveryDate')),
    deliveryDate: day(pick(o, 'deliveryDate')),
    tripNo: s(pick(o, 'tripNo', 'tripNumber')),
    dealerCode: s(pick(o, 'dealerCode', 'customerCode')),
    dealerName: s(pick(o, 'dealerName', 'customerName')),
    branch: s(pick(o, 'branch')),
    province: s(pick(o, 'province')),
    area: s(pick(o, 'area')),
    licensePlate: s(pick(o, 'licensePlate', 'vehicleNo')),
    driverName: s(pick(o, 'driver', 'driverName')),
    outsource: s(pick(o, 'outsource', 'carrier')),
    type: s(pick(o, 'type')),
    unit: n(pick(o, 'unit', 'totalUnit')),
    actualCost: n(pick(o, 'actualCost', 'cost')),
    statusDelivery: s(pick(o, 'statusDelivery', 'status')),
    sla: s(pick(o, 'sla')),
    reason: s(pick(o, 'tripReason', 'pickingListReason')),
    raw: o,
  }
}

function unwrap(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  const o = (raw ?? {}) as { data?: unknown[]; items?: unknown[] }
  return o.data ?? o.items ?? []
}

/** รายงาน Actual Shipment ของช่วงวัน ของคลังหนึ่ง
 *
 *  ช่วงวันคือ **วันที่วางแผนส่ง** ไม่ใช่วันที่ส่งจริง เพราะ TMS กรองด้วยช่องนั้น
 *  ใบที่ส่งช้าข้ามวันจึงยังอยู่ในช่วงเดิมของมัน ซึ่งเป็นสิ่งที่คนอ่านรายงานคาดหวัง */
export async function actualShipment(from: string, to: string, warehouses: Warehouse[]): Promise<ActualShipmentRow[]> {
  return everyWarehouse(warehouses, async (w) => {
    const warehouseId = await warehouseGuid(w)
    const raw = await tmsOp<unknown>('actualShipment', { from, to, warehouseId })
    return unwrap(raw).map((x) => toRow(x, w.code))
  })
}

/** ยิงทุกคลังที่ระบบรับผิดชอบแล้วต่อผลเป็นก้อนเดียว
 *
 *  เจ้าของงานสั่งชัดเมื่อ 31 ส.ค. 2569 ว่ารายงานต้องได้ทั้งสองคลังในการกดครั้งเดียว
 *  ไม่ใช่ให้เลือกทีละคลัง — คนอ่านต้องการภาพรวมของงานทั้งหมด การเลือกทีละคลัง
 *  แปลว่าต้องกดสองรอบแล้วเอาไฟล์สองไฟล์มาต่อกันเอง
 *
 *  คลังหนึ่งพังต้องไม่ทำให้ทั้งรายงานหาย แต่ต้องรู้ว่าขาด จึงโยน error เฉพาะตอน
 *  พังหมดทุกคลัง ถ้าพังบางคลังคือคืนของที่ได้ ไม่เงียบ ๆ ทำเป็นว่าครบ */
async function everyWarehouse<T>(warehouses: Warehouse[], fetchOne: (w: Warehouse) => Promise<T[]>): Promise<T[]> {
  if (!warehouses.length) throw new Error('ยังไม่รู้ว่าจะดึงคลังไหน — อ่านรายชื่อคลังจาก TMS ไม่ได้')
  const settled = await Promise.allSettled(warehouses.map(fetchOne))
  const ok = settled.filter((r): r is PromiseFulfilledResult<T[]> => r.status === 'fulfilled')
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason
  return ok.flatMap((r) => r.value)
}

/* ---------- Plan Simulate ---------- */

/** หนึ่งบรรทัดของรายงาน Plan Simulate — แผนที่ TMS จัดไว้ ก่อนของจะออกจากคลัง
 *
 *  เส้นทางและ body จับมาจากหน้า TMS จริง (Report › Plan Simulate › Search) เมื่อ
 *  31 ส.ค. 2569 body เหมือน actualshipment เป๊ะ ส่วนคำตอบยืนยันแล้วกับของจริง
 *  487 บรรทัด 18 ช่อง: warehouseId · tripNo · orderDate · pickingListNo ·
 *  pickingListTypeName · dealerCode · dealerName · branch · province · unit ·
 *  licensePlate · driver · planPickupDate · outsource · type · area ·
 *  tripReason · pickingListReason
 *
 *  ต่างจาก Actual Shipment ตรงที่**ไม่มีวันส่งจริง ไม่มีสถานะ ไม่มีค่าขนส่ง** —
 *  ซึ่งถูกแล้ว เพราะนี่คือแผน ไม่ใช่ผล ใครอยากรู้ผลต้องไปดูอีกแท็บ */
export interface PlanSimulateRow {
  /** รหัสคลังที่บรรทัดนี้มาจาก (ดู ActualShipmentRow) */
  warehouse: string
  tripNo: string
  orderDate: string
  pickingListNo: string
  pickingListType: string
  dealerCode: string
  dealerName: string
  branch: string
  province: string
  area: string
  unit: number | null
  licensePlate: string
  driverName: string
  planPickupDate: string
  /** ผู้ขนส่ง — 'Fleet Owner' / 'Fleet Owner (Scooter)' คือกองรถของเราเอง */
  outsource: string
  /** ชนิดรถที่แผนกำหนด เช่น 4W */
  type: string
  reason: string
  raw: Record<string, unknown>
}

function toPlanRow(item: unknown, warehouse: string): PlanSimulateRow {
  const o = (item ?? {}) as Record<string, unknown>
  return {
    warehouse,
    tripNo: s(pick(o, 'tripNo')),
    orderDate: day(pick(o, 'orderDate')),
    pickingListNo: s(pick(o, 'pickingListNo')),
    pickingListType: s(pick(o, 'pickingListTypeName')),
    dealerCode: s(pick(o, 'dealerCode')),
    dealerName: s(pick(o, 'dealerName')),
    branch: s(pick(o, 'branch')),
    province: s(pick(o, 'province')),
    area: s(pick(o, 'area')),
    unit: n(pick(o, 'unit')),
    licensePlate: s(pick(o, 'licensePlate')),
    driverName: s(pick(o, 'driver', 'driverName')),
    /* เวลาที่ติดมาด้วย (14:00:00) คือเวลานัดรับของ ไม่ใช่ของประดับ — ตัดทิ้งไม่ได้
       ทั้งก้อน แต่คอลัมน์วันที่ควรอ่านง่าย จึงเก็บวันไว้ที่นี่ เวลาอยู่ใน raw */
    planPickupDate: day(pick(o, 'planPickupDate')),
    outsource: s(pick(o, 'outsource')),
    type: s(pick(o, 'type')),
    reason: s(pick(o, 'tripReason', 'pickingListReason')),
    raw: o,
  }
}

export async function planSimulate(from: string, to: string, warehouses: Warehouse[]): Promise<PlanSimulateRow[]> {
  return everyWarehouse(warehouses, async (w) => {
    const warehouseId = await warehouseGuid(w)
    const raw = await tmsOp<unknown>('planSimulate', { from, to, warehouseId })
    return unwrap(raw).map((x) => toPlanRow(x, w.code))
  })
}

/* ---------- รายละเอียดสินค้าของแต่ละใบ ----------
 *
 * `actualshipment` ส่งมาแต่เลขใบ ไม่มีรายการสินค้าเลยสักช่อง (ยืนยันกับของจริง
 * 31 ส.ค. 2569 — 23 ช่อง ไม่มีช่องไหนเป็น item) รายละเอียดสินค้าจึงต้องมาจาก
 * PL header ซึ่งเป็นเส้นที่แท็บ Picking List ใช้อยู่แล้ว
 *
 * ยิงเส้นเดียวต่อการกดหนึ่งครั้ง ไม่ใช่ยิงรายใบ: การถามทีละใบคือ ~440 คำขอไปหา
 * TMS ของบริษัทต่อการเปิดรายงานหนึ่งครั้ง ซึ่งมากเกินกว่าจะยอมรับได้
 * (เคยมีวิธีถามรายใบสมัยใช้ actualshipment เป็นแหล่งหลัก แล้วเลิกไปด้วยเหตุผลนี้)
 */

export interface ShipmentItem {
  itemNo: string
  /** ชื่อเต็มตามที่ TMS เขียน เช่น "PRIMAVERA 180 ABS BROWN BEIGE" (ช่อง description) */
  itemName: string
  qty: number | null
  /** จำนวนที่ถูกแบ่งออกไปเที่ยวอื่น — 0 คือ "ใบนี้ไม่ได้ใช้ช่องนี้" ไม่ใช่ศูนย์ชิ้น
   *  ตัวแปลงฝั่ง tmsPull แปลง 0 เป็น null ให้แล้ว */
  splitQty: number | null
  /** ใบที่รายการนี้อยู่จริง — ต่างจากเลขใบที่ถามได้ เพราะใบที่ถูกแบ่ง (-C-0x)
   *  ค้นด้วยเลขตัดหางแล้วได้รายการของพี่น้องใบมาด้วย ต้องบอกได้ว่าบรรทัดไหนของใบไหน */
  pickingListNo: string
  /** คลังของใบนั้น */
  warehouse: string
}

/** เลขใบในรายงานบางใบมีหาง -C-04 = ใบนั้นถูกแบ่งส่งหลายเที่ยว
 *  PL header อาจเก็บแบบเต็มหรือแบบตัดหาง จึงต้องลองทั้งสองแบบ ไม่ใช่ยึดแบบเดียว
 *  (กติกาเดียวกับ plKeyVariants เดิมที่เคยใช้ตอน actualshipment เป็นแหล่งหลัก) */
export function plKeys(no: string): string[] {
  const full = no.trim()
  const base = full.replace(/-[A-Za-z]+-\d+$/, '')
  return base !== full ? [full, base] : [full]
}

/** ตารางค้นรายการสินค้า: เลขใบ -> รายการในใบนั้น
 *
 *  ใส่ทั้งเลขเต็มและเลขตัดหางเป็นคีย์ ให้ฝั่งที่ค้นไม่ต้องรู้ว่าใบถูกแบ่งหรือไม่
 *  ใบที่ TMS ไม่ส่งรายการมาจะไม่มีคีย์เลย ต่างจาก "มีคีย์แต่ลิสต์ว่าง" — สองอย่างนี้
 *  หน้าจอต้องเขียนต่างกัน ("ไม่มีรายการสินค้า" กับ "ยังไม่ได้โหลด") */
export async function shipmentItems(
  from: string,
  to: string,
  warehouses: Warehouse[],
): Promise<Map<string, ShipmentItem[]>> {
  const map = new Map<string, ShipmentItem[]>()
  const perWarehouse = await everyWarehouse(warehouses, async (w) => {
    const res = await pullPickingLists({ from, to, warehouse: w })
    return res.rows.map((r) => ({ row: r, code: w.code }))
  })
  for (const { row: r, code } of perWarehouse) {
    if (!r.itemNo && !r.itemName) continue
    const item: ShipmentItem = {
      itemNo: r.itemNo,
      itemName: r.itemName,
      qty: r.itemQty,
      splitQty: r.itemSplitQty,
      pickingListNo: r.pickingListNo,
      warehouse: code,
    }
    for (const k of plKeys(r.pickingListNo)) {
      const cur = map.get(k)
      if (cur) cur.push(item)
      else map.set(k, [item])
    }
  }
  return map
}

/** หารายการสินค้าของใบหนึ่ง — ลองเลขเต็มก่อน แล้วค่อยเลขตัดหาง
 *  คืน null = ยังไม่มีข้อมูลของใบนี้ ไม่ใช่ "ใบนี้ไม่มีสินค้า" */
export function itemsOf(map: Map<string, ShipmentItem[]>, pickingListNo: string): ShipmentItem[] | null {
  for (const k of plKeys(pickingListNo)) {
    const hit = map.get(k)
    if (hit) return hit
  }
  return null
}

/** เติมรายการสินค้าของใบที่ไล่ตามช่วงวันไม่เจอ — ค้นทีละเลขใบผ่าน PL header
 *
 *  ใบที่หาไม่เจอส่วนใหญ่คือใบที่ออกก่อนช่วงวันที่เลือก (สั่งเดือนก่อน ส่งเดือนนี้)
 *  การขยายช่วงวันของรอบไล่หน้าเพื่อให้ครอบคลุมคือการดึงใบเป็นหมื่นมาเพื่อใช้ไม่กี่สิบ
 *  ค้นทีละเลขจึงถูกกว่ามาก และ TMS รับเลขที่มีหาง -C-04 ได้ตรง ๆ
 *
 *  ลูปอยู่ใน Edge Function (op `scanPickingListsByNo`) เบราว์เซอร์ยิงคำขอเดียว
 *  ต่อหนึ่งก้อน — เพดานฝั่งโน้นคือ 60 เลขต่อคำขอ ที่นี่จึงแบ่งก้อนตามนั้น
 *
 *  @returns ตารางเดิมที่ถูกเติมแล้ว (คืนตัวใหม่ ไม่แก้ของเดิม)
 */
const BY_NO_CHUNK = 60

export async function fillItemsByNo(
  base: Map<string, ShipmentItem[]>,
  warehouses: Warehouse[],
  nos: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ items: Map<string, ShipmentItem[]>; notFound: Set<string> }> {
  const map = new Map(base)
  /* ใบที่ TMS หาไม่เจอเลย ต่างจากใบที่มีอยู่แต่ไม่มีรายการสินค้า
     ใบแรกแปลว่าเลขใบในรายงานกับในทะเบียนใบไม่ตรงกัน ซึ่งเป็นเรื่องที่ต้องมีคนดู */
  const notFound = new Set<string>()
  /* ตัดซ้ำก่อนยิง — ใบเดียวโผล่หลายบรรทัดได้ (ใบถูกแบ่งหลายเที่ยว)
     ไม่ตัดคือจ่ายคำขอซ้ำให้ TMS ฟรี ๆ */
  const todo = [...new Set(nos.map((x) => x.trim()).filter(Boolean))]
  /* ฝั่งเซิร์ฟเวอร์ไล่ค้นทีละคลังจนเจอ — ใบที่โผล่ในรายงานของคลังหนึ่ง ทะเบียนใบ
     อาจอยู่อีกคลัง (ใบถูกย้าย/ออกข้ามคลัง) ค้นคลังเดียวจึงได้ "TMS หาไม่เจอ"
     ทั้งที่ใบมีอยู่จริง */
  const codes = warehouses.map((w) => w.code)
  if (!codes.length) throw new Error('ยังไม่รู้ว่าจะค้นคลังไหน')

  for (let i = 0; i < todo.length; i += BY_NO_CHUNK) {
    const chunk = todo.slice(i, i + BY_NO_CHUNK)
    const res = await tmsOp<{ lists: { no: string; found?: number; items: unknown[]; via?: string }[] }>('scanPickingListsByNo', {
      warehouse: codes[0],
      warehouses: codes.slice(1),
      nos: chunk,
    })

    for (const entry of res.lists ?? []) {
      /* คำตอบคือ PL header เต็มใบ แปลงด้วยตัวแปลงเดียวกับแท็บ Picking List
         (plRowsOf) ไม่ใช่เขียนตัวอ่านจำนวนชุดที่สอง */
      const rows = plRowsOf((entry.items ?? []) as PlHeader[])
      /* via = "คลัง/คีย์เวิร์ด" ที่ฝั่งเซิร์ฟเวอร์เจอใบนี้ — เอาส่วนหน้าเป็นรหัสคลัง */
      const foundIn = (entry.via ?? '').split('/')[0] || codes[0]!
      const items: ShipmentItem[] = rows
        .filter((r) => r.itemNo || r.itemName)
        .map((r) => ({
          itemNo: r.itemNo,
          itemName: r.itemName,
          qty: r.itemQty,
          splitQty: r.itemSplitQty,
          pickingListNo: r.pickingListNo,
          warehouse: foundIn,
        }))
      /* ไม่เจอ = ใส่ลิสต์ว่างไว้ ไม่ปล่อยให้คีย์หายไป — ไม่งั้นกดค้นซ้ำจะยิงใบเดิมอีก
         ทุกครั้ง ทั้งที่รู้แล้วว่า TMS ไม่มีรายการของใบนี้ */
      if ((entry.found ?? 0) === 0) notFound.add(entry.no)
      for (const k of plKeys(entry.no)) map.set(k, items)
    }
    onProgress?.(Math.min(i + chunk.length, todo.length), todo.length)
  }
  return { items: map, notFound }
}
