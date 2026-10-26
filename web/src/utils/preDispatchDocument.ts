import type { PlRow } from '../api/tmsPull'
import type { PreDispatchTmsTrip } from '../api/tmsPull'

export interface PreDispatchShipTo {
  key: string
  name: string
  address: string
  province: string
  postCode: string
  rows: PlRow[]
}

const esc = (value: string): string => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] as string))
const val = (value: string | null | undefined): string => value?.trim() || '—'
const thDate = (date: string): string => {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return '—'
  return `${day}/${month}/${year + 543}`
}

export function groupPreDispatchShipTos(trip: PreDispatchTmsTrip): PreDispatchShipTo[] {
  const groups = new Map<string, PreDispatchShipTo>()
  for (const row of trip.rows) {
    const name = row.shipToName.trim() || row.dealerName.trim() || 'ไม่ระบุ Ship to'
    const address = row.shipToAddress.trim() || row.customerAddress.trim()
    const province = row.shipToProvince.trim() || row.province.trim()
    const postCode = row.shipToPostCode.trim()
    const key = JSON.stringify([name.toLocaleLowerCase(), address.toLocaleLowerCase(), province.toLocaleLowerCase(), postCode])
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { key, name, address, province, postCode, rows: [row] })
  }
  return [...groups.values()]
}

const boxSizes = (rows: PlRow[]): string => {
  const sizes = new Map<string, number | null>()
  for (const row of rows) {
    const last = row.itemNo.trim().split(/\s+/).pop() ?? ''
    if (!/^(XXL|XL|[SML])\+?$/i.test(last)) continue
    const key = last.toUpperCase()
    if (!sizes.has(key)) sizes.set(key, row.itemQty)
    else {
      const previous = sizes.get(key)
      sizes.set(key, previous == null || row.itemQty == null ? null : previous + row.itemQty)
    }
  }
  return [...sizes].map(([size, qty]) => qty == null ? size : `${size} (${qty})`).join(' / ')
}

const pickingListCount = (rows: PlRow[]): number => new Set(rows.map((row) => row.pickingListNo.trim()).filter(Boolean)).size

const signature = `<div class="signatures">
  <div><div class="line"></div><b>ผู้ตรวจเช็ค</b></div>
  <div><div class="line"></div><b>Consignee</b></div>
</div>`

function page(trip: PreDispatchTmsTrip, shipTos: PreDispatchShipTo[], logoUrl: string, first: boolean): string {
  const rows = shipTos.flatMap((shipTo) => [
    `<tr class="ship-to-heading"><td colspan="6"><b>Ship To: ${esc(shipTo.name)}</b><br>${esc([shipTo.address, shipTo.province, shipTo.postCode].filter(Boolean).join(' ') || '—')}</td></tr>`,
    ...shipTo.rows.map((row, index) => `<tr>
      <td class="center">${index + 1}</td><td class="mono">${esc(val(row.pickingListNo))}</td>
      <td class="mono">${esc(val(row.itemNo))}</td><td>${esc(val(row.itemName))}</td>
      <td>${esc(boxSizes([row]))}</td><td class="center">${row.itemQty ?? '—'}</td>
    </tr>`),
  ]).join('')
  const allRows = shipTos.flatMap((shipTo) => shipTo.rows)
  const total = allRows.some((row) => row.itemQty == null)
    ? '—'
    : allRows.reduce((sum, row) => sum + (row.itemQty ?? 0), 0)
  const stopCount = shipTos.length
  const header = `<div class="top">
    <div><div class="logo" style="-webkit-mask-image:url('${esc(logoUrl)}');mask-image:url('${esc(logoUrl)}')"></div>
      <div class="sender"><b>VPPW (Thailand) Co., Ltd.</b><br>Building No. 28/10, Bang Na Trad KM.23Road,<br>Bang Sao Thong District, Samut Prakan 10570</div></div>
    <div class="meta"><dl><dt>เที่ยว</dt><dd>${esc(val(trip.tripNo))}</dd><dt>วันที่</dt><dd>${esc(thDate(trip.orderDate))}</dd>
      <dt>คลังต้นทาง</dt><dd>${esc(val(trip.warehouse))}</dd><dt>สถานะ</dt><dd>${esc(val(trip.status))}</dd>
      <dt>ขนส่ง</dt><dd>${esc(val(trip.carrierName))}</dd><dt>พนักงานขับรถ</dt><dd>${esc(val(trip.driver))}</dd>
      <dt>ทะเบียน / รถ</dt><dd>${esc([trip.licensePlate, trip.vehicleTypeName].filter(Boolean).join(' · ') || '—')}</dd>
      <dt>เขต</dt><dd>${esc(val(trip.area))}</dd></dl></div>
  </div>`
  return `<section class="sheet${first ? '' : ' next'}">
    ${header}
    <div class="box"><b>Ship To</b> : ${stopCount} จุด</div>
    <div class="box"><b>Location</b> : —</div>
    <div class="summary"><span>รวมทั้ง Trip · ${stopCount} Ship To</span><span>จำนวนใบ ${pickingListCount(allRows)}</span></div>
    <table><thead><tr><th class="center">#</th><th>Shipment ID</th><th>รหัสสินค้า</th><th>ชื่อสินค้า</th><th>Box Size</th><th class="center">Qty.</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="center">ไม่มีรายการสินค้า</td></tr>'}</tbody>
      <tfoot><tr><td colspan="5">รวม</td><td class="center">${total}</td></tr></tfoot></table>
    ${signature}
  </section>`
}

function documentHtml(title: string, pages: string): string {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size:A4; margin:0 }
    * { box-sizing:border-box }
    body { margin:0; padding:0; color:#000; font:11px Tahoma,"Sarabun",sans-serif }
    .sheet { min-height:297mm; padding:14mm; break-inside:auto }
    .sheet.next { break-before:page; page-break-before:always }
    .top { display:flex; justify-content:space-between; gap:18px; margin-bottom:14px }
    .logo { width:82px; height:34px; background:#000; -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat; -webkit-mask-size:contain; mask-size:contain; print-color-adjust:exact }
    .sender { font-weight:700; line-height:1.6; margin-top:10px }
    .meta { border:1px solid #000; padding:6px 10px; min-width:250px }
    .meta dl { display:grid; grid-template-columns:auto 1fr; gap:3px 10px; margin:0 }
    .meta dt { font-weight:700 }.meta dd { margin:0; text-align:right }
    .box { border:1px solid #000; padding:7px 8px; line-height:1.6 }.box + .box { border-top:0 }
    .summary { display:flex; justify-content:space-between; margin-top:10px; font-weight:700 }
    .ship-to-heading td { background:#eee; break-after:avoid; page-break-after:avoid }
    table { width:100%; border-collapse:collapse; margin-top:8px }
    th,td { border:1px solid #000; padding:5px 7px; text-align:left; vertical-align:top; font-weight:400 }
    th,tfoot td { font-weight:700 }.center { text-align:center }.mono { font-family:Consolas,monospace; font-size:10px }
    tbody tr { break-inside:avoid; page-break-inside:avoid }
    .signatures { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-top:32mm; text-align:center; break-inside:avoid; page-break-inside:avoid }
    .line { height:18mm; border-bottom:1px solid #000; margin-bottom:6px }
    @media screen { body { background:#eee }.sheet { width:210mm; margin:12px auto; background:white; box-shadow:0 1px 8px #999 } }
    @media print { .sheet { margin:0; box-shadow:none } }
  </style></head><body>${pages}</body></html>`
}

export function preDispatchTripHtml(trip: PreDispatchTmsTrip, logoUrl: string): string {
  const groups = groupPreDispatchShipTos(trip)
  return documentHtml(`ใบส่งสินค้า ${trip.tripNo}`, page(trip, groups, logoUrl, true))
}

export function preDispatchShipToHtml(trip: PreDispatchTmsTrip, shipTo: PreDispatchShipTo, logoUrl: string): string {
  return documentHtml(`ใบส่งสินค้า ${trip.tripNo} ${shipTo.name}`, page(trip, [shipTo], logoUrl, true))
}

export function printPreDispatchHtml(html: string): boolean {
  const printWindow = window.open('', '_blank', 'width=900,height=1100')
  if (!printWindow) return false
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
  return true
}
