/**
 * ฉลากติดของ 50 × 35 มม. — พิมพ์ผ่าน TSC TX300 (ตั้งม้วนฉลาก 50.0 × 35.0 มม. ในไดรเวอร์)
 *
 * หนึ่งดวงต่อของหนึ่งชิ้น (1:1) — ร้านที่มีรถ 6 คัน ได้ 6 ดวง เลข 1/6 … 6/6
 * ขาวดำล้วน: หัวพิมพ์ความร้อนไม่มีเทา โลโก้จึงบังคับเป็นขาวดำด้วย filter
 * ฟอนต์ Tahoma — มีในทุกเครื่อง Windows ที่ต่อเครื่องพิมพ์ ไทยอ่านชัดที่ขนาดเล็ก
 */

export interface LabelUnit {
  store: string
  address: string
  model: string
  itemNo: string
  pl: string
  tripNo: string
  date: string
  index: number
  total: number
}

/** สรุปหลังพิมพ์: ร้านละกี่ชิ้น แยกรุ่น */
export interface LabelStoreSummary {
  store: string
  total: number
  models: { model: string; itemNo: string; qty: number }[]
}

export interface LabelSource {
  store: string
  address: string
  rows: {
    pl: string | null
    orderNo: string
    goods: string
    units: number | null
    /** orders.work_kind — 'vehicle' | 'box' | null (null = เดาจาก goods ขึ้นต้น BOX) */
    kind: string | null
    items: { item_no: string; item_name: string | null; qty: number }[]
  }[]
}

/* พิมพ์ฉลากเฉพาะ "รถ" — ใบงานกล่อง (work_kind = box) ข้ามทั้งใบ
   และใบงานรถก็มีกล่องอุปกรณ์ปนมา ("PLAIN BOX 17x25x18", "กล่อง …") ต้องกรองรายบรรทัดด้วย
   ตรวจกับฐานจริง 1 ต.ค. 2569: box 183 ใบ, vehicle 103 ใบ */
const isBoxItem = (name: string): boolean => /\bBOX\b|กล่อง/i.test(name)
const isVehicleOrder = (kind: string | null, goods: string): boolean =>
  (kind ?? (/^box\b/i.test(goods.trim()) ? 'box' : 'vehicle')) === 'vehicle'

/** แตกใบเป็นรายคัน — ใบรถที่ไม่มีรายการของ ใช้จำนวนหน่วยจาก TMS แทน ขั้นต่ำ 1 ดวง */
export function buildLabels(tripNo: string, date: string, stores: LabelSource[]): {
  units: LabelUnit[]
  summary: LabelStoreSummary[]
} {
  const units: LabelUnit[] = []
  const summary: LabelStoreSummary[] = []
  for (const s of stores) {
    const mine: Omit<LabelUnit, 'index' | 'total'>[] = []
    const models = new Map<string, { model: string; itemNo: string; qty: number }>()
    for (const r of s.rows) {
      if (!isVehicleOrder(r.kind, r.goods)) continue
      const lines = r.items.length > 0
        ? r.items
          .map((it) => ({ model: it.item_name ?? it.item_no, itemNo: it.item_no, qty: Math.max(0, Math.round(it.qty)) }))
          .filter((ln) => !isBoxItem(ln.model))
        : [{ model: r.goods, itemNo: '', qty: Math.max(1, r.units ?? 1) }]
      for (const ln of lines) {
        const key = `${ln.itemNo}|${ln.model}`
        const m = models.get(key) ?? { model: ln.model, itemNo: ln.itemNo, qty: 0 }
        m.qty += ln.qty
        models.set(key, m)
        for (let i = 0; i < ln.qty; i++) {
          mine.push({ store: s.store, address: s.address, model: ln.model, itemNo: ln.itemNo, pl: r.pl ?? r.orderNo, tripNo, date })
        }
      }
    }
    if (mine.length === 0) continue /* ร้านที่มีแต่กล่อง ไม่ขึ้นทั้งฉลากและสรุป */
    mine.forEach((u, i) => units.push({ ...u, index: i + 1, total: mine.length }))
    summary.push({ store: s.store, total: mine.length, models: [...models.values()] })
  }
  return { units, summary }
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

/**
 * แยกชื่อร้านเป็น ชื่อ / สาขา — ทดสอบกับชื่อจริงที่ยาวที่สุดในฐาน
 * - สาขา = วงเล็บชุดท้ายสุดของชื่อ "(ตากสิน)" "(สาขาบางโพ)" "(AFS แจ้งส่ง)"
 *   วงเล็บกลางชื่อ เช่น "(ประเทศไทย)" "(จรัญสนิทวงศ์)" เป็นส่วนของชื่อบริษัท ไม่แตะ
 * - "เที่ยว N" ท้ายชื่อ (มีทั้งก่อนและหลังวงเล็บ) ย้ายไปอยู่แถวสาขา
 * ไม่มีทั้งสองอย่าง branch = '' — ไม่พิมพ์แถวนั้น
 */
export function splitStore(store: string): { name: string; branch: string } {
  let name = store.trim()
  const round = name.match(/\s*(เที่ยว\s*\d+)\s*$/)
  if (round) name = name.slice(0, round.index).trim()
  const paren = name.match(/^(.*\S)\s*\(([^()]*)\)$/)
  if (paren) name = paren[1]!.trim()
  const branch = [paren?.[2]?.trim(), round?.[1]].filter(Boolean).join(' · ')
  return { name, branch }
}
/* ผังฉลาก: โลโก้ + ทริปในกรอบ / ร้าน สาขา / จังหวัด (ชิดเส้นล่าง) / วันที่ + จำนวน — ไม่โชว์รุ่นกับ PL */
const label = (u: LabelUnit, logo: string): string => {
  const { name, branch } = splitStore(u.store)
  return `
<section class="lb">
  <header>
    <img src="${esc(logo)}" alt="">
    <span class="trip">${esc(u.tripNo)}</span>
  </header>
  <div class="mid">
    <h1>${esc(name)}</h1>
    ${branch ? `<p class="branch">${esc(branch)}</p>` : ''}
  </div>
  ${u.address ? `<p class="addr">${esc(u.address)}</p>` : ''}
  <footer>
    <b>${esc(u.date)}</b>
    <span class="no">${u.index}<i>/${u.total}</i></span>
  </footer>
</section>`
}
const html = (units: LabelUnit[], logo: string): string => `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>ฉลาก ${units.length} ดวง</title>
<style>
@page { size: 50mm 35mm; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; color: #000; }
body { font-family: Tahoma, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.lb { width: 50mm; height: 35mm; padding: 1.6mm 2mm 1.4mm; display: flex; flex-direction: column;
  overflow: hidden; page-break-after: always; break-after: page; }
.lb > header, .lb > footer, .lb > .addr, .mid > * { flex: none; }
.lb:last-child { page-break-after: auto; break-after: auto; }
header { display: flex; align-items: center; justify-content: space-between; height: 6.4mm; }
header img { height: 6.2mm; max-width: 26mm; object-fit: contain; filter: grayscale(1) contrast(4); }
.trip { font-size: 6.5pt; font-weight: 700; border: .25mm solid #000; border-radius: .8mm; padding: 0 1mm; line-height: 3.4mm; }
.mid { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: center; gap: .3mm; padding: .6mm 0 .8mm; overflow: hidden; }
h1 { font-size: 9.5pt; font-weight: 700; line-height: 1.18; max-height: 3.54em; overflow: hidden; }
.branch { font-size: 7.5pt; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; }
.addr { font-size: 8pt; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
footer { display: flex; align-items: flex-end; justify-content: space-between; margin-top: .9mm;
  border-top: .25mm dashed #666; padding-top: .6mm; } /* เส้นประบาง — เส้นทึบหนาแย่งสายตาจากชื่อร้าน */
footer b { font-size: 8pt; white-space: nowrap; }
.no { font-size: 13pt; font-weight: 700; line-height: 1; padding-left: 1mm; }
.no i { font-style: normal; font-size: 8pt; font-weight: 400; }@media screen {
  body { background: #ddd; padding: 6mm; display: flex; flex-wrap: wrap; gap: 4mm; }
  .lb { background: #fff; box-shadow: 0 0 0 .2mm #999; }
}
</style></head><body>${units.map((u) => label(u, logo)).join('')}</body></html>`

/**
 * ย่อตัวอักษรให้พอดีช่อง — ชื่อร้านจริงยาวถึง 3 บรรทัด ("บริษัท … จำกัด (สาขา…)")
 * ตัดด้วย … จะหายส่วนท้ายซึ่งมักเป็นชื่อสาขา ที่ต้องใช้แยกร้านมากที่สุด จึงย่อแทนตัด
 * รันจากฝั่งนี้ (ไม่ใช่ <script> ในเอกสาร) เพราะ CSP บล็อกสคริปต์ inline
 */
function fit(doc: Document): void {
  const shrink = (el: HTMLElement, over: () => boolean, min: number): void => {
    let size = parseFloat(doc.defaultView!.getComputedStyle(el).fontSize)
    while (over() && size > min) { size -= 0.5; el.style.fontSize = `${size}px` }
  }
  doc.querySelectorAll<HTMLElement>('.lb').forEach((lb) => {
    const h1 = lb.querySelector<HTMLElement>('h1')!
    const mid = lb.querySelector<HTMLElement>('.mid')!
    /* ชื่อ 2 บรรทัด + สาขา + จังหวัด เกินช่องได้ (เช่น ก้องพัฒนาเจริญยนต์ (กิ่งแก้ว)) — ย่อชื่อจนจังหวัดไม่โดนตัด */
    shrink(h1, () => h1.scrollHeight > h1.clientHeight + 1 || mid.scrollHeight > mid.clientHeight + 1, 9)
    const br = lb.querySelector<HTMLElement>('.branch') /* ไม่มีสาขา = ไม่มีแถวนี้ */
    if (br) shrink(br, () => br.scrollWidth > br.clientWidth + 1, 8)
  })
}

/** เปิดหน้าต่างพิมพ์ — false เมื่อป๊อปอัปถูกบล็อก (สั่งพิมพ์จากฝั่งนี้ เหตุผลเดียวกับ printConsignment: CSP) */
export function printLabels(units: LabelUnit[], logoUrl: string): boolean {
  const w = window.open('', '_blank', 'width=600,height=700')
  if (!w) return false
  w.document.write(html(units, logoUrl))
  w.document.close()
  const shoot = (): void => { fit(w.document); w.focus(); w.print() }
  const pending = [...w.document.images].filter((im) => !im.complete)
  if (!pending.length) { shoot(); return true }
  let left = pending.length
  const timer = w.setTimeout(shoot, 5000)
  const done = (): void => { if (--left > 0) return; w.clearTimeout(timer); shoot() }
  for (const im of pending) {
    im.addEventListener('load', done, { once: true })
    im.addEventListener('error', done, { once: true })
  }
  return true
}
