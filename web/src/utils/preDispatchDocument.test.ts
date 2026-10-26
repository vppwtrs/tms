import { describe, expect, it } from 'vitest'
import type { PreDispatchTmsTrip } from '../api/tmsPull'
import { groupPreDispatchShipTos, preDispatchShipToHtml, preDispatchTripHtml } from './preDispatchDocument'

const trip: PreDispatchTmsTrip = {
  id: 'trip-1', tripNo: 'T-<1>', orderDate: '2026-10-26', statusId: 2, status: 'Confirm',
  carrierName: '', warehouse: 'KM23-CW-01', area: '', driver: '', licensePlate: '', vehicleTypeName: '',
  rows: [
    { pickingListNo: 'PL-1', planDeliveryDate: '', tripDate: '', tripNo: '', plStatus: '', tripStatus: '', plType: '', area: '', dealerCode: '', dealerName: '', branch: '', province: '', customerAddress: '', shipToName: 'Shop <A>', shipToAddress: 'Road & Lane', shipToProvince: '', shipToPostCode: '', unit: 2, totalQty: 2, pickupDate: '', deliveryDate: '', itemNo: 'FSBOX04 M', itemName: 'Box', itemQty: 2, itemSplitQty: null, qtySource: 'qty' },
    { pickingListNo: 'PL-2', planDeliveryDate: '', tripDate: '', tripNo: '', plStatus: '', tripStatus: '', plType: '', area: '', dealerCode: '', dealerName: '', branch: '', province: '', customerAddress: '', shipToName: 'Shop <A>', shipToAddress: 'Road & Lane', shipToProvince: '', shipToPostCode: '', unit: 1, totalQty: 1, pickupDate: '', deliveryDate: '', itemNo: 'SKU-2', itemName: 'Part', itemQty: 1, itemSplitQty: null, qtySource: 'qty' },
  ],
}

describe('pre-dispatch document', () => {
  it('groups by Ship to and includes separate PLs at the same address', () => {
    const groups = groupPreDispatchShipTos(trip)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.rows).toHaveLength(2)
  })

  it('does not turn a missing item quantity into a fabricated zero in box size totals', () => {
    const missingQty = { ...trip, rows: [{ ...trip.rows[0]!, itemQty: null, pickingListNo: '' }] }
    const html = preDispatchShipToHtml(missingQty, groupPreDispatchShipTos(missingQty)[0]!, '/logo.png')
    expect(html).toContain('<td>M</td>')
    expect(html).not.toContain('M (0)')
    expect(html).toContain('จำนวนใบ 0')
    expect(html).toContain('<td class="center">—</td></tr></tfoot>')
  })

  it('escapes live TMS values, leaves missing fields blank, and renders side-by-side signature lines', () => {
    const html = preDispatchShipToHtml(trip, groupPreDispatchShipTos(trip)[0]!, '/logo.png')
    expect(html).toContain('Shop &lt;A&gt;')
    expect(html).toContain('Road &amp; Lane')
    expect(html).toContain('<b>Location</b> : —')
    expect(html).toContain('—')
    expect(html).toContain('ผู้ตรวจเช็ค')
    expect(html).toContain('Consignee')
    expect(html).toContain('grid-template-columns:1fr 1fr')
    expect(html).toContain('FSBOX04 M')
    expect(html).not.toContain('POD')
    expect(html).not.toContain('รูปหลักฐาน')
  })

  it('puts all Ship Tos in one Trip document while keeping the individual Ship To document scoped', () => {
    const twoStops = { ...trip, rows: [...trip.rows, { ...trip.rows[0]!, shipToName: 'Second shop', shipToAddress: 'Other road' }] }
    const html = preDispatchTripHtml(twoStops, '/logo.png')
    expect(html).toContain('@page { size:A4')
    expect(html).toContain('break-inside:auto')
    expect(html.match(/<section class="sheet/g)).toHaveLength(1)
    expect(html).toContain('Ship To: Shop &lt;A&gt;')
    expect(html).toContain('Ship To: Second shop')
    expect(html).toContain('รวมทั้ง Trip · 2 Ship To')
    const singleShipTo = preDispatchShipToHtml(twoStops, groupPreDispatchShipTos(twoStops)[0]!, '/logo.png')
    expect(singleShipTo).not.toContain('Ship To: Second shop')
  })
})
