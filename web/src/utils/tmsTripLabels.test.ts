import { describe, expect, it } from 'vitest'
import { groupTmsTrips, type TmsShipmentRaw, type TmsTripRaw } from './tmsTripLabels'

const trip = (tms_id: string, trip_no: string, status_id: number): TmsTripRaw =>
  ({ tms_id, trip_no, order_date: '2026-10-14', status_id, status: status_id === 2 ? 'Confirm' : 'OnDelivery', warehouse_code: 'KM23-CW-01' })
const ship = (tms_trip_id: string, pl: string, item_no: string, item_name: string, qty: number, store = 'ร้าน A'): TmsShipmentRaw =>
  ({ tms_trip_id, picking_list_no: pl, pl_type: 'NEW', unit: qty, item_no, item_name, item_qty: qty, item_split_qty: null,
     dealer_name: store, ship_to_name: store, ship_to_province: 'กรุงเทพมหานคร', province: null })

describe('groupTmsTrips', () => {
  it('รวมหลายบรรทัดของ PL เดียวกันเป็นใบเดียว นับดวงตามจำนวนรถ', () => {
    const [t] = groupTmsTrips([trip('a', '001', 2)], [
      ship('a', 'PL1', 'LX150', 'LX 150 BLUE', 1),
      ship('a', 'PL1', 'SP180', 'SPRINT 180 WHITE', 2),
    ])
    expect(t?.stores).toHaveLength(1)
    expect(t?.stores[0]?.rows).toHaveLength(1)
    expect(t?.stores[0]?.address).toBe('กรุงเทพมหานคร')
    expect(t?.count).toBe(3)
  })
  it('กล่องไม่นับเป็นฉลาก', () => {
    const [t] = groupTmsTrips([trip('b', '002', 2)], [ship('b', 'BK1', 'FSBOX01 S', 'BOX 12x12x8', 70)])
    expect(t?.count).toBe(0)
  })
  it('เลขทริปซ้ำข้ามคลัง แยกด้วย tms_id', () => {
    const out = groupTmsTrips([trip('x', '001', 2), trip('y', '001', 4)], [
      ship('x', 'PL1', 'PM180', 'PRIMAVERA', 1),
      ship('y', 'PL2', 'SP180', 'SPRINT', 2, 'ร้าน B'),
    ])
    expect(out.map((t) => [t.key, t.count])).toEqual([['x', 1], ['y', 2]])
  })
})
