/**
 * ใบส่งของ (Consignment) — พิมพ์เป็น PDF ผ่านหน้าต่างพิมพ์ของเบราว์เซอร์
 *
 * ทำไมไม่ใช้ไลบรารี PDF: เอกสารใบนี้เป็นข้อความกับตารางล้วน มีรูปเดียวคือลายเซ็น
 * ซึ่งเก็บเป็น data URL อยู่แล้ว เบราว์เซอร์ทุกตัวมี "Save as PDF" ในกล่องพิมพ์
 * การเพิ่ม jsPDF เข้ามาแลกกับฟอนต์ไทยที่ต้องฝังเองทั้งชุด ไม่คุ้มกับเอกสารหน้าเดียว
 *
 * ทำไมเปิดหน้าต่างใหม่แทน @media print ในหน้าเดิม: หน้าออเดอร์มีธีมมืด ตัวแปรสี
 * และ layout ของตัวเองเต็มไปหมด การพิมพ์จากในนั้นต้องไล่ปิดทีละชิ้นและพังเงียบ ๆ
 * ทุกครั้งที่หน้าจอถูกแก้ เอกสารตั้งต้นเปล่า ๆ ควบคุมได้แน่นอนกว่า
 */

export interface ConsignmentLine {
  /** เลขที่ใบที่คนนอกระบบใช้เรียก — PL ก่อนเสมอ */
  shipmentId: string
  /** ของในใบ รหัสกับชื่อตามที่คลังส่งมา ใบหนึ่งมีได้หลายรายการ */
  items: { itemNo: string; itemName: string; qty: number }[]
  /** ไซซ์กล่องพร้อมจำนวน เช่น `S (5) / M (3)` — ว่างได้เมื่อของในใบไม่ใช่กล่อง */
  boxSize: string
  qty: number
}

export interface ConsignmentData {
  /** เลขเที่ยว — มุมขวาบนของเอกสาร */
  tripNo: string
  /** วันที่นัดส่ง ไม่ใช่วันที่พิมพ์ */
  scheduledAt: string
  /** คลังต้นทาง + เขต — คำถามแรกเวลาของมีปัญหาคือของออกจากคลังไหน */
  warehouse: string
  area: string
  /** ชื่อร้าน/ลูกค้าปลายทาง */
  consignee: string
  /** ที่อยู่จุดส่ง อาจมีหลายบรรทัดเมื่อจุดเดียวมีหลายที่อยู่ย่อย */
  address: string[]
  lat: number | null
  lng: number | null
  lines: ConsignmentLine[]
  /** คนส่งของ — คนขับที่วิ่งเที่ยวนี้ */
  sender: string
  /** ชื่อผู้รับที่คนขับกรอกไว้ตอนเก็บหลักฐาน — คู่กับลายเซ็น
   *  ลายเซ็นอย่างเดียวอ่านไม่ออกว่าใครเซ็น ซึ่งเป็นสิ่งแรกที่ถูกเถียงเวลามีปัญหา */
  recipient: string
  /** ลายเซ็นผู้รับเป็น data URL ตรงจากฐาน ใส่ img ได้ทันที */
  signature: string
  /** เวลาที่เก็บหลักฐาน ไม่ใช่เวลาที่กดพิมพ์ */
  collectedAt: string
  notes: string
  /** รูปที่คนขับถ่ายไว้ตอนส่ง — ลิงก์มีอายุจำกัด ต้องพิมพ์ตอนที่ยังเปิดอยู่
   *  ใส่ท้ายใบ ไม่ใช่หน้าแรก เพราะกระดาษที่ยื่นให้ร้านเซ็นคือหน้าแรกหน้าเดียว */
  photos: { url: string; label: string }[]
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/** 25/8/2569 15:22:38 — รูปแบบเดียวกับใบที่ TMS บริษัทออก คนคลังอ่านแบบนี้อยู่แล้ว */
function stamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 28 ส.ค. 2569 — วันที่นัดส่ง เขียนเต็มกันสับสนกับรูปแบบ ค.ศ. */
function day(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const m = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
  return `${d.getDate()} ${m[d.getMonth()] as string} ${d.getFullYear() + 543}`
}

function html(c: ConsignmentData, logo: string): string {
  const qty = c.lines.reduce((s, l) => s + l.qty, 0)
  const loc = c.lat != null && c.lng != null ? `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}` : '—'
  /* ที่อยู่ขึ้นบรรทัดละแบบ ไม่ใช่ต่อกันด้วย / — จุดที่มีหลายที่อยู่ย่อยจะได้อ่านออก
     ว่ามีกี่แห่ง ของเดิมต่อกันยาวจนชื่อคนรับกับเบอร์โทรกลืนไปกับตัวที่อยู่ */
  const addr = c.address.length ? c.address.map(esc).join('<br>') : '—'
  /* ใบหนึ่งมีได้หลายรายการ — แตกเป็นบรรทัดย่อยในช่องเดียว ไม่ใช่แตกเป็นแถวใหม่
     เพราะแถวใหม่ต้องซ้ำเลข PL ทุกบรรทัด ซึ่งอ่านแล้วนับจำนวนใบผิด */
  const cell = (l: ConsignmentLine, pick: (it: ConsignmentLine['items'][number]) => string): string =>
    l.items.length ? l.items.map((it) => esc(pick(it)) || '—').join('<br>') : '—'
  const rows = c.lines.map((l, i) => `<tr>
      <td class="mid">${i + 1}</td>
      <td class="ids">${esc(l.shipmentId)}</td>
      <td class="ids">${cell(l, (it) => it.itemNo)}</td>
      <td>${cell(l, (it) => it.itemName)}</td>
      <td>${esc(l.boxSize)}</td>
      <td class="mid">${l.qty}</td>
    </tr>`).join('')
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>&#8203;</title>
<style>
  /* ขอบกระดาษเป็นศูนย์ แล้วเว้นขอบเองด้วย padding ของ body — หัวกระดาษกับ
     ท้ายกระดาษที่เบราว์เซอร์เติมให้ (วันที่ · URL · เลขหน้า) ถูกวาดในพื้นที่ขอบ
     ไม่มีขอบก็ไม่มีที่ให้วาด เป็นทางเดียวที่โค้ดสั่งซ่อนมันได้ CSS แตะมันตรง ๆ ไม่ได้ */
  @page { size: A4; margin: 0; }
  /* กระดาษเต็มความสูงเสมอ แล้วดันบรรทัดที่มาของเอกสารลงไปติดขอบล่าง —
     ของเดิมทุกอย่างกองอยู่ครึ่งบน เหลือครึ่งล่างว่างเปล่าจนใบดูเอียงขึ้นข้างบน */
  body { padding: 14mm; min-height: 297mm; display: flex; flex-direction: column; }
  .foot { margin-top: auto; padding-top: 10px; }
  * { box-sizing: border-box; }
  body { font-family: "Sarabun", "Tahoma", sans-serif; font-size: 11px; color: #000; margin: 0; }
  .head { display: flex; justify-content: center; position: relative; font-weight: 700; font-size: 13px; margin-bottom: 14px; }
  .head .no { position: absolute; right: 0; font-weight: 400; }
  /* โลโก้เป็นภาพหน้ากาก (alpha) ไม่ใช่ภาพสี — เอาไปใส่ <img> ตรง ๆ ได้กระดาษเปล่า
     ระบายสีผ่าน mask แทน จึงบังคับให้เป็นตัวหนังสือสีดำบนกระดาษขาวได้แน่นอน
     print-color-adjust จำเป็น ไม่งั้นเบราว์เซอร์ตัดพื้นหลังทิ้งตอนพิมพ์ = โลโก้หาย */
  .logo {
    width: 82px; height: 34px; background: #000;
    -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
    -webkit-mask-size: contain; mask-size: contain;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* หัวกระดาษสองฝั่ง: ผู้ส่งซ้าย ข้อมูลเที่ยวขวา — คนอ่านมองหาเลขเที่ยวกับวันที่ก่อน
     ของเดิมวางเรียงลงมาทางเดียวจนครึ่งบนของกระดาษว่างเปล่าฝั่งขวาทั้งแถบ */
  .top { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 14px; }
  .from { font-weight: 700; line-height: 1.5; margin-top: 10px; }
  .meta { border: 1px solid #000; padding: 6px 10px; min-width: 250px; }
  .meta dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; }
  .meta dt { font-weight: 700; }
  .meta dd { margin: 0; text-align: right; }
  .box { border: 1px solid #000; padding: 6px 8px; line-height: 1.6; }
  .box + .box { border-top: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #000; padding: 5px 8px; text-align: left; vertical-align: top; font-weight: 400; }
  th { font-weight: 700; }
  .mid { text-align: center; }
  .ids { font-family: "Consolas", monospace; font-size: 10px; }
  tfoot td { font-weight: 700; }
  /* ช่องเซ็นเดียวกลางใบ — คนขับไม่ได้เซ็นเอกสารนี้ ชื่อคนขับอยู่ในกล่องข้อมูล
     เที่ยวมุมขวาบนแล้ว ช่องเซ็นที่เหลือจึงมีของผู้รับอย่างเดียว วางกลางกันเข้าใจ
     ว่ามีอีกช่องที่ถูกลืมไว้ฝั่งซ้าย */
  .sign { display: flex; justify-content: center; margin-top: 16px; }
  .sign > div { width: 58%; text-align: center; }
  /* ลายเซ็นวางกลางช่อง ไม่ชิดซ้าย — เส้นเซ็นเป็นเส้นเดียวกลางกระดาษ
     ลายเซ็นที่เกาะขอบซ้ายอ่านเหมือนวางผิดตำแหน่งมากกว่าตั้งใจจัด */
  .sign .pad { height: 64px; border-bottom: 1px solid #000; display: flex; align-items: flex-end; justify-content: center; }
  /* ยกลายเซ็นให้ลอยเหนือเส้น 3px — ภาพลายเซ็นเป็น PNG พื้นทึบ วางบนเส้นพอดี
     แล้วพื้นขาวของภาพทับเส้นหายไปช่วงกลาง ดูเหมือนเส้นขาด */
  .sign img { max-height: 58px; max-width: 100%; object-fit: contain; margin-bottom: 3px; }
  .sign .who { margin-top: 4px; line-height: 1.6; }
  .note { border: 1px solid #000; margin-top: 12px; padding: 6px 8px; min-height: 32px; }
  .foot { font-size: 10px; text-align: center; }
  /* รูปอยู่หน้าเดียวกับใบ ไม่ดันขึ้นหน้าใหม่ — รอบก่อนบังคับขึ้นหน้าใหม่แล้วได้
     กระดาษสองแผ่นที่ว่างครึ่งใบทั้งคู่ ทั้งที่ของทั้งหมดใส่หน้าเดียวพอดี
     avoid กันไม่ให้บล็อกรูปถูกผ่ากลางเมื่อใบยาวจนต้องขึ้นหน้าจริง ๆ */
  .shots { margin-top: 12px; break-inside: avoid; }
  .shots h2 { font-size: 11px; margin: 0 0 6px; }
  /* จำนวนคอลัมน์เท่าจำนวนรูป (สูงสุด 4) — ตรึงไว้ 4 เสมอแล้วใบที่มี 3 รูป
     จะเหลือช่องว่างค้างฝั่งขวาหนึ่งช่อง ซึ่งอ่านเหมือนรูปหายไปหนึ่งใบ */
  .grid { display: grid; gap: 6px; }
  .grid figure { margin: 0; break-inside: avoid; }
  .grid img { width: 100%; height: 42mm; object-fit: cover; border: 1px solid #000; background: #fff; }
  .grid figcaption { font-size: 9px; margin-top: 2px; }
</style></head><body>
<div class="head">Consignment<span class="no">${esc(c.tripNo)}</span></div>
<div class="top">
  <div>
    <div class="logo" role="img" aria-label="VPPW (Thailand) Co., Ltd." style="-webkit-mask-image:url('${logo}');mask-image:url('${logo}')"></div>
    <div class="from">VPPW (Thailand) Co., Ltd.<br>Building No. 28/10, Bang Na Trad KM.23Road,<br>Bang Sao Thong District, Samut Prakan 10570</div>
  </div>
  <div class="meta"><dl>
    <dt>เที่ยว</dt><dd>${esc(c.tripNo)}</dd>
    <dt>วันที่ส่ง</dt><dd>${esc(day(c.scheduledAt))}</dd>
    <dt>คลังต้นทาง</dt><dd>${esc(c.warehouse || '—')}${c.area ? ` · เขต ${esc(c.area)}` : ''}</dd>
    <dt>พนักงานขับรถ</dt><dd>${esc(c.sender)}</dd>
    <dt>จำนวนใบ</dt><dd>${c.lines.length}</dd>
  </dl></div>
</div>
<div class="box"><b>To</b> : ${esc(c.consignee)}</div>
<div class="box"><b>Address</b> : ${addr}</div>
<div class="box"><b>Location</b> : ${esc(loc)}</div>
<table>
  <thead><tr>
    <th style="width:26px" class="mid">#</th>
    <th style="width:24%">Shipment ID</th>
    <th style="width:17%">รหัสสินค้า</th>
    <th>ชื่อสินค้า</th>
    <th style="width:16%">Box Size</th>
    <th style="width:48px" class="mid">Qty.</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="5">รวม ${c.lines.length} ใบ</td><td class="mid">${qty}</td></tr></tfoot>
</table>
<div class="sign">
  <div>
    <div class="pad">${c.signature ? `<img src="${c.signature}" alt="">` : ''}</div>
    <div class="who"><b>Consignee</b> : ${esc(c.recipient) || '________________'}<br>${esc(stamp(c.collectedAt))}</div>
  </div>
</div>
<div class="note"><b>หมายเหตุ</b> : ${esc(c.notes)}</div>
${c.photos.length ? `<section class="shots">
  <h2>รูปหลักฐานการส่งมอบ (${c.photos.length})</h2>
  <div class="grid" style="grid-template-columns:repeat(${Math.min(c.photos.length, 4)},1fr)">${c.photos.map((ph) => `<figure><img src="${ph.url}" alt=""><figcaption>${esc(ph.label)}</figcaption></figure>`).join('')}</div>
</section>` : ''}
<div class="foot">พิมพ์จากระบบบริหารจัดการขนส่ง VPPW — ลายเซ็นและพิกัดบันทึกจากเครื่องของพนักงานขับรถ ณ เวลาที่ส่งมอบ</div>
<script>
  /* สั่งพิมพ์จากในเอกสารเอง ไม่ใช่จากหน้าต่างที่เปิดมัน — onload ของฝั่งผู้เปิด
     ยิงไปแล้วตั้งแต่ก่อน document.write บางเบราว์เซอร์ กล่องพิมพ์จึงเปิดมาพร้อม
     ช่องรูปว่าง ทั้งที่ลายเซ็นกับรูปหลักฐานโหลดทันอยู่แล้ว */
  addEventListener('load', function () {
    focus()
    /* title เป็นช่องว่างศูนย์ความกว้าง (U+200B) ไม่ใช่ค่าว่าง — ปล่อยว่างจริง
       เบราว์เซอร์จะถอยไปใช้ URL แทน แล้วได้คำว่า about:blank ขึ้นหัวกระดาษ
       ซึ่งแย่กว่าเดิม และห้ามตั้ง title ใหม่ระหว่างนี้ Chrome เรนเดอร์ตัวอย่าง
       พิมพ์ใหม่ทุกครั้งที่ title เปลี่ยน ชื่อจึงโผล่กลับมาทั้งที่ตั้งหลัง print() */
    print()
  })
</script>
</body></html>`
}

/**
 * เปิดหน้าต่างพิมพ์ — คนกดเลือก "Save as PDF" เองในกล่องของเบราว์เซอร์
 *
 * ช่อง Box Size เว้นว่างโดยตั้งใจ ระบบเราไม่ได้เก็บขนาดกล่อง (M+/S/S+) ไว้เลย
 * ทั้ง TMS ก็ไม่ได้ส่งมาให้ตอนนำเข้า เดาขนาดใส่ลงเอกสารที่ใช้อ้างกับลูกค้าได้
 * แย่กว่าเว้นว่างให้คนกรอกมือ ถ้าวันหนึ่งมีข้อมูลจริง เติมที่ ConsignmentLine ได้
 *
 * คืน false เมื่อป๊อปอัปถูกบล็อก — ผู้เรียกต้องบอกผู้ใช้ ไม่ใช่เงียบไป
 */
export function printConsignment(c: ConsignmentData, logoUrl: string): boolean {
  const w = window.open('', '_blank', 'width=800,height=1000')
  if (!w) return false
  w.document.write(html(c, logoUrl))
  w.document.close()
  return true
}
