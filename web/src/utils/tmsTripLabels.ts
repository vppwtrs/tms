/**
 * ฉลากจากเที่ยวของ TMS โดยตรง — ไม่ผ่านออเดอร์และไม่ผ่านข้อมูลที่ระบบเก็บไว้
 *
 * ออเดอร์เกิดตอน OnDelivery แล้วเท่านั้น และรอบดึงข้อมูลเก็บเฉพาะกองรถเรา (Fleet Owner)
 * แต่ฉลากต้องติดรถทุกคันที่ออกจากคลัง ทุก carrier ทุกสถานะ (ยกเว้นยกเลิก)
 * หน้าพิมพ์ฉลากจึงอ่านจาก TMS ตรง ๆ ผ่าน scanTripsForLabels แล้วแปลงด้วยไฟล์นี้
 */
import { buildLabels, type LabelSource } from './storeLabel'
import type { LabelTmsTrip } from '../api/tmsPull'

/** status_id ของ TMS — ตรงกับ TRIP_STATUS ใน api/tmsPull.ts */
export const TMS_CONFIRM = 2
export const TMS_CANCELLED = 6

export interface TmsTripRaw {
  tms_id: string
  trip_no: string
  order_date: string | null
  status_id: number | null
  status: string | null
  warehouse_code: string | null
  carrier?: string | null
}

export interface TmsShipmentRaw {
  tms_trip_id: string | null
  picking_list_no: string
  pl_type: string | null
  unit: number | null
  item_no: string | null
  item_name: string | null
  item_qty: number | null
  item_split_qty: number | null
  dealer_name: string | null
  ship_to_name: string | null
  ship_to_province: string | null
  province: string | null
}

export interface TmsLabelTrip {
  /** tms_id — เลขทริปซ้ำกันข้ามคลังได้ (เจอจริง 20261012001 ทั้ง CW-01 และ CW-02) */
  key: string
  tripNo: string
  date: string | null
  statusId: number | null
  status: string
  warehouse: string
  carrier: string
  stores: LabelSource[]
  /** จำนวนดวงที่จะได้ (เฉพาะรถ ไม่รวมกล่อง) */
  count: number
}

export function groupTmsTrips(trips: TmsTripRaw[], ships: TmsShipmentRaw[]): TmsLabelTrip[] {
  const byTrip = new Map<string, TmsShipmentRaw[]>()
  for (const s of ships) {
    if (!s.tms_trip_id) continue
    const list = byTrip.get(s.tms_trip_id)
    if (list) list.push(s)
    else byTrip.set(s.tms_trip_id, [s])
  }

  return trips.map((t) => {
    const stores = new Map<string, LabelSource>()
    const pls = new Map<string, LabelSource['rows'][number]>()
    for (const s of byTrip.get(t.tms_id) ?? []) {
      const store = (s.ship_to_name || s.dealer_name || 'ไม่ระบุร้าน').trim()
      let src = stores.get(store)
      if (!src) {
        src = { store, address: (s.ship_to_province || s.province || '').trim(), rows: [] }
        stores.set(store, src)
      }
      const plKey = `${store}|${s.picking_list_no}`
      let row = pls.get(plKey)
      if (!row) {
        row = { pl: s.picking_list_no, orderNo: s.picking_list_no, goods: s.item_name ?? '', units: s.unit, kind: null, plType: s.pl_type, items: [] }
        pls.set(plKey, row)
        src.rows.push(row)
      }
      if (s.item_no) {
        row.items.push({ item_no: s.item_no, item_name: s.item_name, qty: s.item_split_qty || s.item_qty || 0 })
      }
    }
    const list = [...stores.values()]
    return {
      key: t.tms_id,
      tripNo: t.trip_no,
      date: t.order_date,
      statusId: t.status_id,
      status: t.status ?? '—',
      warehouse: t.warehouse_code ?? '',
      carrier: t.carrier ?? '',
      stores: list,
      count: buildLabels(t.trip_no, '', list).units.length,
    }
  })
}

/** แปลงผลอ่านจาก TMS (PlRow รายบรรทัดต่อรุ่น) เข้ารูปเดียวกับข้างบน */
export function labelTripsFromTms(trips: LabelTmsTrip[]): TmsLabelTrip[] {
  const raw: TmsTripRaw[] = trips.map((t) => ({
    tms_id: t.id, trip_no: t.tripNo, order_date: t.orderDate || null, status_id: t.statusId,
    status: t.status, warehouse_code: t.warehouse, carrier: t.carrierName,
  }))
  const ships: TmsShipmentRaw[] = trips.flatMap((t) => t.rows.map((r) => ({
    tms_trip_id: t.id,
    picking_list_no: r.pickingListNo,
    pl_type: r.plType,
    unit: r.unit,
    item_no: r.itemNo,
    item_name: r.itemName,
    item_qty: r.itemQty,
    item_split_qty: r.itemSplitQty,
    dealer_name: r.dealerName,
    ship_to_name: r.shipToName,
    ship_to_province: r.shipToProvince,
    province: r.province,
  })))
  return groupTmsTrips(raw, ships)
}
