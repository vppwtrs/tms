/**
 * ฉลากจากเที่ยวของ TMS โดยตรง (tms_trips + tms_shipments) — ไม่ผ่านออเดอร์ในระบบเรา
 *
 * ออเดอร์ถูกสร้างตอนเที่ยวถึง OnDelivery แล้วเท่านั้น (ด่านนำเข้า 16 ก.ย. 2569)
 * แต่ฉลากต้องพิมพ์ก่อนรถออก ตอนที่เที่ยวยังเป็น Confirm — จึงต้องอ่านจากข้อมูลดิบที่ดึงมาทุก 5 นาที
 */
import { buildLabels, type LabelSource } from './storeLabel'

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
        row = { pl: s.picking_list_no, orderNo: s.picking_list_no, goods: s.item_name ?? '', units: s.unit, kind: null, items: [] }
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
      stores: list,
      count: buildLabels(t.trip_no, '', list).units.length,
    }
  })
}
