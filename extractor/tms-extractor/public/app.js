/* ============================================================
   TMS Extractor — frontend
   ทุก request ผ่าน /proxy ที่ server.js forward ไป pdi.vespiario.net
   read-only ทั้งหมด:
     POST /tokens                             login
     GET  /personal/profile, /personal/warehouses
     POST /v1/pickinglistheaders/{wh}/search  ข้อมูล
   ============================================================ */

const API = '/proxy/api';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const S = {
  token: null,
  refreshToken: null,
  mode: 'pl',        // 'pl' = Picking List, 'as' = Actual Shipment
  rows: [],          // 1 แถว = 1 item
  as: [],            // แถวรายงาน Actual Shipment
  asItems: false,    // แตกแถวตาม item แล้วหรือยัง (มีคอลัมน์ item เพิ่ม)
  view: 'rows',
  page: 1,
  perPage: 100,
  sort: { key: null, dir: 1 },
  q: '',
  abort: false
};

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = n => (n === '' || n == null) ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const stamp = () => new Date().toISOString().slice(0, 10);

// วันที่แบบเดียวกับรายงาน TMS: dd/mm/yyyy (ตัดเวลาทิ้ง)
function fmtD(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  const [y, m, d] = s.split('-');
  return (y && m && d) ? `${d}/${m}/${y}` : s;
}

function plog(msg, cls) {
  $('#plog').innerHTML = cls ? `<${cls}>${msg}</${cls}>` : msg;
}

async function api(path, opts = {}) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (S.token) h.Authorization = 'Bearer ' + S.token;
  const res = await fetch(API + path, Object.assign({}, opts, { headers: h }));
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* ไม่ใช่ json */ }
  if (!res.ok) {
    const err = new Error((json && (json.exception || json.message)) || text.slice(0, 200) || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return json;
}

/* ============================================================
   LOGIN
   ============================================================ */
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#loginBtn');
  const errBox = $('#loginErr');
  errBox.classList.add('hide');
  btn.disabled = true;
  btn.textContent = 'กำลังเข้าสู่ระบบ...';

  const user = $('#email').value.trim();
  const pass = $('#pw').value;
  const tenant = $('#tenant').value.trim() || 'root';

  // ยืนยันจาก API แล้วว่าใช้ userName + password (มี email เป็น fallback เผื่อ build อื่น)
  const shapes = [{ userName: user, password: pass }, { email: user, password: pass }];

  let ok = false, lastErr = null;
  for (const body of shapes) {
    try {
      const r = await api('/tokens', { method: 'POST', headers: { tenant }, body: JSON.stringify(body) });
      S.token = r.token;
      S.refreshToken = r.refreshToken || null;
      sessionStorage.setItem('tmsx', JSON.stringify({ token: S.token, refreshToken: S.refreshToken }));
      ok = true;
      break;
    } catch (err) {
      lastErr = err;
      if (err.status === 401) break;   // รหัสผิดจริง ไม่ต้องลอง shape อื่น
    }
  }

  btn.disabled = false;
  btn.textContent = 'เข้าสู่ระบบ';

  if (!ok) {
    errBox.textContent = lastErr && lastErr.status === 401
      ? 'เข้าสู่ระบบไม่สำเร็จ — ตรวจ email/username, รหัสผ่าน และ tenant อีกครั้ง'
      : 'เชื่อมต่อไม่ได้: ' + (lastErr ? lastErr.message : 'unknown');
    errBox.classList.remove('hide');
    return;
  }

  $('#pw').value = '';
  await boot();
});

$('#logout').onclick = () => {
  sessionStorage.removeItem('tmsx');
  location.reload();
};

/* ============================================================
   BOOT — โหลดโปรไฟล์ + warehouse
   ============================================================ */
async function boot() {
  $('#login').classList.add('hide');
  $('#app').classList.remove('hide');

  try {
    const p = await api('/personal/profile');
    $('#whoName').textContent = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.userName || 'user';
    $('#whoMail').textContent = p.email || '';
  } catch (e) { $('#whoName').textContent = 'user'; }

  try {
    const whs = await api('/personal/warehouses');
    const list = (Array.isArray(whs) ? whs : (whs && whs.data) || []);
    const sel = $('#wh');
    sel.innerHTML = '';
    list.forEach(w => {
      const name = w.name || w.warehouse || w;
      const o = document.createElement('option');
      o.value = name;
      // reports/actualshipment อ้าง warehouse ด้วย GUID ไม่ใช่รหัส — เก็บติดไว้กับ option
      const id = w.id || w.warehouseId || w.warehouseID || '';
      if (id) o.dataset.id = id;
      o.textContent = w.description ? `${name} — ${w.description}` : name;
      sel.appendChild(o);
    });
    if (!sel.options.length) sel.innerHTML = '<option>KM23-CW-01</option>';
  } catch (e) {
    $('#wh').innerHTML = '<option>KM23-CW-01</option>';
    plog('ดึงรายชื่อ warehouse ไม่ได้ ใช้ค่าเริ่มต้น', 'em');
  }

  renderStats();

  // push.js เกาะตรงนี้เพื่อเริ่มโหมดอัตโนมัติ — แยกไฟล์ไว้ให้ extractor ยังใช้เดี่ยว ๆ ได้
  // ถ้าไม่มี push.js อยู่ (ก๊อปไปแค่ตัวดึง) หน้าก็ยังทำงานปกติ
  if (typeof onBooted === 'function') onBooted();
}

/* ============================================================
   FETCH
   ============================================================ */
function flatten(h) {
  const ds = (h.details && h.details.length) ? h.details : [{}];
  return ds.map(d => ({
    pickingListNo:    h.pickingListNo || '',
    status:           h.status || '',
    planDeliveryDate: (h.planDeliveryDate || '').slice(0, 10),
    area:             h.area || '',
    plType:           h.pickingListTypeName || '',
    company:          h.company || '',
    warehouse:        h.warehouse || '',
    customerCode:     h.customerCode || '',
    customerName:     h.customerName || '',
    customerProvince: h.customerProvince || '',
    shipToName:       h.shipToName || '',
    shipToProvince:   h.shipToProvince || '',
    shipToPostCode:   h.shipToPostCode || '',
    totalQty:         h.totalQty ?? '',
    isManual:         h.isManual === true ? 'Y' : (h.isManual === false ? 'N' : ''),
    reason:           h.reason || '',
    tripNo:           h.tripNo || '',
    tripStatus:       h.tripStatus || '',
    orderDate:        (h.orderDate || '').slice(0, 10),
    pickupDate:       (h.pickupDate || '').slice(0, 19).replace('T', ' '),
    deliveryDate:     (h.deliveryDate || '').slice(0, 19).replace('T', ' '),
    itemNo:           d.itemNo || '',
    itemName:         d.description || '',
    itemQty:          d.qty ?? '',
    itemSplitQty:     d.splitQty ?? ''
  }));
}

$('#run').onclick = () => (S.mode === 'as' ? runActual() : runPL());

/* ---------- Actual Shipment ----------
   POST /v1/reports/actualshipment  { planDeliveryDate:[iso,iso], warehouseId }
   คืน array แบน 1 แถว = 1 บรรทัดรายงาน ไม่ต้องแบ่งหน้า                     */

// หา GUID ของ warehouse — ปกติติดมากับ /personal/warehouses อยู่แล้ว
// ถ้า build ไหนไม่ส่งมา ค่อยถาม /v1/warehouses/search เป็นทางสำรอง
let whIdCache = null;
async function warehouseId(code) {
  const opt = $('#wh').selectedOptions[0];
  if (opt && opt.dataset.id) return opt.dataset.id;

  if (!whIdCache) {
    const r = await api('/v1/warehouses/search', {
      method: 'POST',
      body: JSON.stringify({ pageNumber: 1, pageSize: 200 })
    });
    whIdCache = new Map((r.data || r.items || []).map(w => [w.name || w.warehouse, w.id]));
  }
  const id = whIdCache.get(code);
  if (!id) throw new Error(`หา warehouse id ของ ${code} ไม่เจอ`);
  return id;
}

/* ---------- เติมชื่อ item ให้รายงาน Actual Shipment ----------
   รายงานไม่มี item มาให้ มีแต่ pickingListNo — ต้องไปดึงจาก pickinglistheaders
   ซึ่งส่ง details[] (itemNo/description/qty) มาอยู่แล้ว แล้ว join ด้วยเลข PL

   ดึงแบบไล่หน้าทีเดียวจบ ไม่ยิงทีละ PL: รายงานวันเดียวมักมีหลายสิบ PL
   ยิงทีละใบจะกลายเป็นหลายสิบ request ส่วนการไล่หน้าใช้ไม่กี่ request แล้วหยุด
   ทันทีที่เจอครบทุกใบที่ต้องการ                                              */
function plKeyVariants(no) {
  // เลข PL ในรายงานบางใบมีหาง -C-04 ต่อท้าย ซึ่งอาจไม่ตรงกับที่เก็บใน PL header
  // ลองทั้งแบบเต็มและแบบตัดหางออก
  const s = String(no || '').trim();
  const base = s.replace(/-[A-Za-z]+-\d+$/, '');
  return base !== s ? [s, base] : [s];
}

async function attachItems() {
  const wh = $('#wh').value;
  const want = new Set();
  for (const r of S.as) plKeyVariants(r.pickingListNo).forEach(k => want.add(k));

  const found = new Map();   // pickingListNo -> details[]
  const ps = 500;
  let page = 1, scanned = 0;

  try {
    while (want.size && page <= 60 && !S.abort) {
      const r = await api(`/v1/pickinglistheaders/${encodeURIComponent(wh)}/search`, {
        method: 'POST',
        body: JSON.stringify({ orderBy: [], pageNumber: page, pageSize: ps, keyword: null })
      });
      const data = r.data || r.items || [];
      scanned += data.length;

      for (const h of data) {
        const no = h.pickingListNo;
        if (want.has(no)) { found.set(no, h.details || []); want.delete(no); }
      }
      plog(`หาชื่อ item... สแกน PL <b>${num(scanned)}</b> · เจอแล้ว <b>${num(found.size)}</b>`);

      if (data.length < ps) break;
      page++;
    }
  } catch (e) {
    plog('ดึงชื่อ item ไม่สำเร็จ: ' + e.message, 'em');
    return ['ดึงชื่อ item ไม่ครบ: ' + e.message];
  }

  // แตกแถว: 1 แถว = 1 item. PL ที่หา details ไม่เจอ ยังคงไว้ 1 แถวแต่ช่อง item ว่าง
  const out = [];
  let missing = 0, mismatch = 0;
  for (const r of S.as) {
    let det = null;
    for (const k of plKeyVariants(r.pickingListNo)) {
      if (found.has(k)) { det = found.get(k); break; }
    }
    if (!det || !det.length) {
      missing++;
      out.push(Object.assign({}, r, { itemNo: '', itemName: '', itemQty: '' }));
      continue;
    }
    // ค่า unit/actualCost ที่ซ้ำ ถูกเว้นว่างทีหลังใน dedupAs() ไม่ต้องจัดการตรงนี้
    //
    // เลข PL ที่มีหาง -C-04 คือ "ส่วนที่ 4" ของใบนั้น = PL ถูกแบ่งส่งหลายเที่ยว
    // details[] ที่ดึงมาเป็นของทั้งใบ ยอดจึงไม่เท่ากับ unit ของเที่ยวนี้
    // splitQty น่าจะเป็นจำนวนที่ยกไปจริง เลยเอามาแสดงคู่กับ qty ให้เทียบเอง
    const sumQty   = det.reduce((s, d) => s + (Number(d.qty) || 0), 0);
    const sumSplit = det.reduce((s, d) => s + (Number(d.splitQty) || 0), 0);
    const u = Number(r.unit) || 0;
    const match = sumQty === u ? 'qty' : (sumSplit === u ? 'split' : '');
    if (!match) mismatch++;

    det.forEach(d => out.push(Object.assign({}, r, {
      itemNo: d.itemNo || '',
      itemName: d.description || '',
      itemQty: d.qty ?? '',
      itemSplitQty: d.splitQty ?? '',
      qtyCheck: match === 'qty' ? 'ตรง (qty)'
              : match === 'split' ? 'ตรง (split)'
              : `ไม่ตรง (qty ${sumQty} / split ${sumSplit} / unit ${u})`
    })));
  }

  S.as = out;
  S.asItems = true;
  S.asMismatch = mismatch;
  // เก็บไว้ให้ runActual เอาไปต่อท้ายข้อความ "เสร็จ" ไม่งั้นโดนเขียนทับหายไป
  const warn = [];
  if (missing) warn.push(`หา item ไม่เจอ ${num(missing)} PL (ช่อง item ว่างไว้)`);
  if (mismatch) warn.push(`ยอด item ไม่ตรง unit ${num(mismatch)} PL — ดูคอลัมน์ "ตรวจยอด"`);
  return warn;
}

async function runActual() {
  const from = $('#tFrom').value, to = $('#tTo').value;
  if (!from || !to) { plog('เลือกช่วง Trip Date ก่อน', 'em'); return; }

  S.as = []; S.rows = []; S.abort = false; S.page = 1;
  $('#run').disabled = true;
  setExport(false);
  $('#bar').style.width = '15%';
  plog('กำลังดึงรายงาน...');

  try {
    const id = await warehouseId($('#wh').value);
    $('#bar').style.width = '45%';

    // ส่งเป็น UTC เที่ยงคืนของวันที่เลือก — ให้ date part ที่ API เห็นตรงกับที่ผู้ใช้เลือก
    const body = {
      planDeliveryDate: [from + 'T00:00:00.000Z', to + 'T00:00:00.000Z'],
      warehouseId: id
    };
    const r = await api('/v1/reports/actualshipment', { method: 'POST', body: JSON.stringify(body) });

    S.as = (Array.isArray(r) ? r : (r && (r.data || r.items)) || []).map(a => ({
      orderDate:           fmtD(a.orderDate),
      tripNo:              a.tripNo || '',
      pickingListNo:       a.pickingListNo || '',
      pickingListTypeName: a.pickingListTypeName || '',
      dealerCode:          a.dealerCode || '',
      dealerName:          a.dealerName || '',
      branch:              a.branch || '',
      province:            a.province || '',
      unit:                a.unit ?? '',
      licensePlate:        a.licensePlate || '',
      driver:              a.driver || '',
      planPickupDate:      fmtD(a.planPickupDate),
      pickupDate:          fmtD(a.pickupDate),
      onDeliveryDate:      fmtD(a.onDeliveryDate),
      deliveryDate:        fmtD(a.deliveryDate),
      statusDelivery:      a.statusDelivery || '',
      sla:                 a.sla || '',
      outsource:           a.outsource || '',
      type:                a.type || '',
      area:                a.area || '',
      actualCost:          a.actualCost ?? '',
      tripReason:          a.tripReason || '',
      pickingListReason:   a.pickingListReason || ''
    }));

    const plCount = new Set(S.as.map(r => r.pickingListNo)).size;
    S.asItems = false;

    let warn = [];
    if (S.as.length && $('#asItems').checked) {
      $('#bar').style.width = '55%';
      warn = await attachItems();
    }

    $('#bar').style.width = '100%';
    const trips = new Set(S.as.map(r => r.tripNo)).size;
    plog(S.as.length
      ? `เสร็จ — <b>${num(S.as.length)}</b> แถว · <b>${num(plCount)}</b> PL · <b>${num(trips)}</b> trip`
        + (warn.length ? '<br>' + warn.join('<br>') : '')
      : 'ไม่พบข้อมูลในช่วงที่เลือก');
  } catch (e) {
    plog(e.status === 401
      ? 'session หมดอายุ — ออกจากระบบแล้วเข้าใหม่'
      : 'error: ' + e.message, 'em');
  }

  $('#run').disabled = false;
  setExport(S.as.length > 0);
  render();
  renderStats();
}

async function runPL() {
  const wh = $('#wh').value;
  const ps = Math.max(10, +$('#oPs').value || 500);
  const maxPage = +$('#oMax').value || 0;

  const base = { orderBy: ['planDeliveryDate Descending'], pageSize: ps, keyword: null };
  const kw = $('#fKw').value.trim();          if (kw) base.keyword = kw;
  const st = $('#fStatus').value;             if (st) base.status = st;
  const ar = $('#fArea').value;               if (ar) base.area = ar;

  // ช่วงวันที่ "ไม่" ส่งไป API — ทดสอบแล้วว่า API ไม่มี field รับช่วงวันที่
  // จึงกรองฝั่ง client แทน แม่นยำแน่นอน (status/area กรองซ้ำอีกชั้นกันพลาด)
  const from = $('#fFrom').value, to = $('#fTo').value;
  const keep = h => {
    if (st && h.status !== st) return false;
    if (ar && h.area !== ar) return false;
    if (!from && !to) return true;
    const d = (h.planDeliveryDate || '').slice(0, 10);
    if (!d) return false;                 // ไม่มีวันที่ = ไม่เข้าช่วงที่เลือก
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };

  S.rows = []; S.abort = false; S.page = 1;
  $('#run').disabled = true;
  $('#stop').classList.remove('hide');
  setExport(false);
  $('#bar').style.width = '0%';

  let scanned = 0, kept = 0, total = null, stoppedEarly = false;
  try {
    for (let page = 1; !S.abort; page++) {
      const r = await api(`/v1/pickinglistheaders/${encodeURIComponent(wh)}/search`, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ pageNumber: page }, base))
      });

      const data = r.data || r.items || [];
      if (total == null) total = r.totalCount ?? r.total ?? null;
      scanned += data.length;

      let oldest = '9999-99-99';
      for (const h of data) {
        const d = (h.planDeliveryDate || '').slice(0, 10);
        if (d && d < oldest) oldest = d;
        if (keep(h)) { S.rows.push(...flatten(h)); kept++; }
      }

      // เรียงจากใหม่ไปเก่า ถ้าหน้านี้เก่ากว่าวันเริ่มต้นแล้ว ที่เหลือก็เก่ากว่าทั้งหมด
      if (from && oldest !== '9999-99-99' && oldest < from) stoppedEarly = true;

      const pct = total ? Math.min(100, Math.round(scanned / total * 100)) : Math.min(95, page * 5);
      $('#bar').style.width = pct + '%';
      plog(`หน้า ${page} · สแกน <b>${num(scanned)}</b>${total ? '/' + num(total) : ''}`
         + ` · เข้าเงื่อนไข <b>${num(kept)}</b> PL · แถว <b>${num(S.rows.length)}</b>`);

      render();
      renderStats();

      if (stoppedEarly) break;
      if (data.length < ps) break;
      if (maxPage && page >= maxPage) break;
    }

    $('#bar').style.width = '100%';
    plog(`${S.abort ? 'หยุดแล้ว' : 'เสร็จ'} — สแกน <b>${num(scanned)}</b>`
       + ` · เข้าเงื่อนไข <b>${num(kept)}</b> PL · แถว <b>${num(S.rows.length)}</b>`
       + (stoppedEarly ? '\nหยุดเร็วเพราะเจอข้อมูลเก่ากว่าช่วงที่เลือกแล้ว' : ''));
  } catch (e) {
    plog(e.status === 401
      ? 'session หมดอายุ — ออกจากระบบแล้วเข้าใหม่'
      : 'error: ' + e.message, 'em');
  }

  $('#run').disabled = false;
  $('#stop').classList.add('hide');
  setExport(S.rows.length > 0);
  render();
  renderStats();
}

$('#stop').onclick = () => { S.abort = true; plog('กำลังหยุด...'); };

/* ============================================================
   VIEWS
   ============================================================ */
const COLS = {
  rows: [
    ['pickingListNo', 'PL No'], ['status', 'Status'], ['planDeliveryDate', 'Plan Delivery'],
    ['area', 'Area'], ['plType', 'PL Type'], ['customerCode', 'Cust Code'],
    ['customerName', 'Customer'], ['shipToProvince', 'Province'],
    ['itemNo', 'Item No'], ['itemName', 'Item Name'], ['itemQty', 'Qty', 1],
    ['tripNo', 'Trip No'], ['tripStatus', 'Trip Status'],
    ['pickupDate', 'Pickup'], ['deliveryDate', 'Delivery'], ['reason', 'Reason']
  ],
  pl: [
    ['pickingListNo', 'PL No'], ['status', 'Status'], ['planDeliveryDate', 'Plan Delivery'],
    ['area', 'Area'], ['customerCode', 'Cust Code'], ['customerName', 'Customer'],
    ['shipToProvince', 'Province'], ['itemCount', 'จำนวน Item', 1],
    ['itemQty', 'Qty รวม', 1], ['items', 'Item ทั้งหมด'], ['tripNo', 'Trip No']
  ],
  item: [
    ['itemNo', 'Item No'], ['itemName', 'Item Name'], ['itemQty', 'Qty รวม', 1],
    ['plCount', 'จำนวน PL', 1], ['share', 'สัดส่วน', 1]
  ],
  // 23 คอลัมน์ ลำดับเดียวกับรายงาน Actual Shipment ของ TMS เป๊ะ
  as: [
    ['orderDate', 'Trip Date'], ['tripNo', 'Trip No'], ['pickingListNo', 'PL No'],
    ['pickingListTypeName', 'PL Type'], ['dealerCode', 'Dealer Code'],
    ['dealerName', 'Dealer Name'], ['branch', 'Branch'], ['province', 'Province'],
    ['unit', 'Unit', 1], ['licensePlate', 'License Plate'], ['driver', 'Driver'],
    ['planPickupDate', 'Plan Pickup'], ['pickupDate', 'Pickup'],
    ['onDeliveryDate', 'On Delivery'], ['deliveryDate', 'Delivery'],
    ['statusDelivery', 'Status'], ['sla', 'SLA'], ['outsource', 'Outsource'],
    ['type', 'Type'], ['area', 'Area'], ['actualCost', 'Actual Cost', 1],
    ['tripReason', 'Trip Reason'], ['pickingListReason', 'PL Reason']
  ]
};

// แทรกต่อจากคอลัมน์ Unit เพราะ item ทั้งก้อนคือรายละเอียดของ unit นั้น อ่านเทียบกันได้ในสายตาเดียว
const ITEM_COLS = [
  ['itemNo', 'Item No'], ['itemName', 'Item Name'],
  ['itemQty', 'Item Qty', 1], ['itemSplitQty', 'Split Qty', 1],
  ['qtyCheck', 'ตรวจยอด']
];
function colsFor(view) {
  if (view !== 'as' || !S.asItems) return COLS[view];
  const c = COLS.as.slice(), i = c.findIndex(x => x[0] === 'unit');
  c.splice(i < 0 ? c.length : i + 1, 0, ...ITEM_COLS);
  return c;
}

function aggPL() {
  const m = new Map();
  for (const r of S.rows) {
    let o = m.get(r.pickingListNo);
    if (!o) {
      o = Object.assign({}, r, { itemCount: 0, itemQty: 0, items: [] });
      m.set(r.pickingListNo, o);
    }
    if (r.itemNo) {
      o.itemCount++;
      o.itemQty += Number(r.itemQty) || 0;
      o.items.push(r.itemNo);
    }
  }
  return [...m.values()].map(o => Object.assign(o, { items: o.items.join(', ') }));
}

function aggItem() {
  const m = new Map();
  let grand = 0;
  for (const r of S.rows) {
    if (!r.itemNo) continue;
    let o = m.get(r.itemNo);
    if (!o) { o = { itemNo: r.itemNo, itemName: r.itemName, itemQty: 0, pls: new Set() }; m.set(r.itemNo, o); }
    const q = Number(r.itemQty) || 0;
    o.itemQty += q; grand += q;
    o.pls.add(r.pickingListNo);
  }
  return [...m.values()]
    .map(o => ({
      itemNo: o.itemNo, itemName: o.itemName, itemQty: o.itemQty,
      plCount: o.pls.size,
      share: grand ? +(o.itemQty / grand * 100).toFixed(2) : 0
    }))
    .sort((a, b) => b.itemQty - a.itemQty);
}

// รวมยอดต่อ trip — unit บวกกัน ส่วน actualCost เป็นค่าของทั้ง trip ไม่ใช่ของแต่ละแถว
// จึงหยิบค่าแรกที่เจอ ไม่บวกซ้ำ (ตรงกับวิธีของ TMS: calculateCost หา row แรกของ trip)
function tripTotals(data) {
  const m = new Map();
  for (const r of data) {
    let o = m.get(r.tripNo);
    if (!o) { o = { unit: 0, cost: Number(r.actualCost) || 0 }; m.set(r.tripNo, o); }
    o.unit += Number(r.unit) || 0;
  }
  return m;
}

/* ค่าที่ไม่ได้อยู่ระดับแถว ให้เขียนครั้งเดียวแล้วเว้นว่างที่เหลือ
     unit       — ระดับ PL  (1 PL แตกได้หลาย item)
     actualCost — ระดับ trip (1 trip มีได้หลาย PL)
   ทำที่นี่ที่เดียวหลังเรียง/กรองแล้ว ทุกทางออก (ตาราง, CSV, Excel, JSON) จะได้ตรงกัน
   ถ้าปล่อยให้ซ้ำ ลาก sum ใน Excel แล้วยอดจะบวมตามจำนวน item/PL */
function dedupAs(rows) {
  let pl = null, trip = null;
  return rows.map(r => {
    const o = Object.assign({}, r);
    if (pl === r.pickingListNo) o.unit = '';
    if (trip === r.tripNo) o.actualCost = '';
    pl = r.pickingListNo; trip = r.tripNo;
    return o;
  });
}

function currentData() {
  if (S.view === 'as') {
    let d = S.as;
    if (S.q) {
      const q = S.q.toLowerCase();
      d = d.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
    }
    if (S.sort.key) {
      const k = S.sort.key, dir = S.sort.dir;
      d = d.slice().sort((a, b) => String(a[k]).localeCompare(String(b[k]), 'th') * dir);
    }
    return dedupAs(d);
  }
  let d = S.view === 'rows' ? S.rows : S.view === 'pl' ? aggPL() : aggItem();
  if (S.q) {
    const q = S.q.toLowerCase();
    d = d.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
  }
  if (S.sort.key) {
    const k = S.sort.key, dir = S.sort.dir;
    d = d.slice().sort((a, b) => {
      const x = a[k], y = b[k];
      const nx = Number(x), ny = Number(y);
      if (x !== '' && y !== '' && !isNaN(nx) && !isNaN(ny)) return (nx - ny) * dir;
      return String(x).localeCompare(String(y), 'th') * dir;
    });
  }
  return d;
}

function render() {
  const cols = colsFor(S.view);
  const data = currentData();
  const pane = $('#pane');

  const loaded = S.view === 'as' ? S.as.length : S.rows.length;

  if (!data.length) {
    pane.innerHTML = loaded
      ? '<div class="empty"><div>ไม่พบรายการที่ตรงกับคำค้น</div></div>'
      : '<div class="empty"><div>ยังไม่มีข้อมูล<br>ตั้งค่าตัวกรองทางซ้ายแล้วกด <b>ดึงข้อมูล</b></div></div>';
    $('#cnt').textContent = '—';
    $('#pg').textContent = '–';
    $('#prev').disabled = $('#next').disabled = true;
    return;
  }

  const pages = Math.max(1, Math.ceil(data.length / S.perPage));
  if (S.page > pages) S.page = pages;
  const slice = data.slice((S.page - 1) * S.perPage, S.page * S.perPage);

  const maxQty = S.view === 'item' ? Math.max(...data.map(r => r.itemQty)) : 0;

  let h = '<table><thead><tr>';
  cols.forEach(([k, label, isNum]) => {
    const ar = S.sort.key === k ? (S.sort.dir > 0 ? '▲' : '▼') : '';
    h += `<th data-k="${k}" class="${isNum ? 'num' : ''}">${esc(label)}<span class="ar">${ar}</span></th>`;
  });
  h += '</tr></thead><tbody>';

  for (const r of slice) {
    h += '<tr>';
    for (const [k, , isNum] of cols) {
      let v = r[k];
      if (S.view === 'as' && (k === 'statusDelivery' || k === 'sla')) {
        const cls = (v === 'Completed' || v === 'OnTime') ? 'ok' : (v === 'Late' ? 'warn' : '');
        h += `<td class="${cls}" title="${esc(v)}">${esc(v)}</td>`;
        continue;
      }
      if (k === 'qtyCheck') {
        const bad = String(v || '').startsWith('ไม่ตรง');
        h += `<td class="${bad ? 'warn' : ''}" title="${esc(v)}">${esc(v)}</td>`;
        continue;
      }
      if (k === 'status' || k === 'tripStatus') {
        v = v ? `<span class="pill p-${esc(v)}">${esc(v)}</span>` : '';
      } else if (k === 'share') {
        const w = maxQty ? Math.round(r.itemQty / maxQty * 60) : 0;
        v = `<span class="bar-mini" style="width:${w}px"></span> ${v}%`;
      } else if (isNum) {
        v = num(v);
      } else {
        v = esc(v);
      }
      h += `<td class="${isNum ? 'num' : ''}" title="${esc(r[k])}">${v}</td>`;
    }
    h += '</tr>';
  }
  h += '</tbody></table>';
  pane.innerHTML = h;

  pane.querySelectorAll('th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k;
      S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 };
      render();
    };
  });

  $('#cnt').textContent = `${num(data.length)} แถว` + (S.q ? ` (กรองจาก ${num(S.view === 'rows' ? S.rows.length : '')})` : '');
  $('#pg').textContent = `${S.page} / ${pages}`;
  $('#prev').disabled = S.page <= 1;
  $('#next').disabled = S.page >= pages;
}

function renderStats() {
  if (S.mode === 'as') {
    const d = S.as;
    const trips = new Set(d.map(r => r.tripNo)).size;
    const units = d.reduce((s, r) => s + (Number(r.unit) || 0), 0);
    const cost = [...tripTotals(d).values()].reduce((s, t) => s + t.cost, 0);
    // นับสถานะที่ระดับ PL ไม่ใช่ระดับแถว — แตกแถวตาม item แล้วนับแถวจะบวมตามจำนวน item
    const byPL = new Map();
    for (const r of d) if (!byPL.has(r.pickingListNo)) byPL.set(r.pickingListNo, r);
    const pls = [...byPL.values()];
    const done = pls.filter(r => r.statusDelivery === 'Completed').length;
    const late = pls.filter(r => r.sla === 'Late').length;
    const onTime = pls.filter(r => r.sla === 'OnTime').length;

    $('#stats').innerHTML = [
      ['Trip', num(trips)],
      ['Picking List', num(pls.length)],
      [S.asItems ? 'แถว (PL × Item)' : 'แถว', num(d.length)],
      ['Unit รวม', num(units)],
      ['Actual Cost รวม', num(cost)],
      ['Completed', num(done)],
      ['OnTime / Late', `${num(onTime)} / ${num(late)}`]
    ].concat(S.asItems ? [
      ['Item Qty รวม', num(d.reduce((s, r) => s + (Number(r.itemQty) || 0), 0))],
      ['Split Qty รวม', num(d.reduce((s, r) => s + (Number(r.itemSplitQty) || 0), 0))],
      ['PL ยอดไม่ตรง', num(S.asMismatch || 0)]
    ] : []
    ).map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    return;
  }

  const rows = S.rows;
  const pls = new Set(rows.map(r => r.pickingListNo)).size;
  const items = new Set(rows.filter(r => r.itemNo).map(r => r.itemNo)).size;
  const qty = rows.reduce((s, r) => s + (Number(r.itemQty) || 0), 0);
  const noItem = new Set(rows.filter(r => !r.itemNo).map(r => r.pickingListNo)).size;
  const cust = new Set(rows.map(r => r.customerCode).filter(Boolean)).size;

  $('#stats').innerHTML = [
    ['Picking List', num(pls)],
    ['แถว (PL × Item)', num(rows.length)],
    ['Item ไม่ซ้ำ', num(items)],
    ['Qty รวม', num(qty)],
    ['ลูกค้า', num(cust)],
    ['PL ไม่มี item', num(noItem)]
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
}

/* ---------------- sidebar: หุบ/ขยาย + กลุ่มพับได้ ---------------- */
const side = $('#side'), scrim = $('#scrim'), tglBtn = $('#tgl');
const narrow = () => window.innerWidth <= 900;
const isRail = () => side.classList.contains('rail');

function setRail(on) {
  side.classList.toggle('rail', on);
  tglBtn.setAttribute('aria-expanded', String(!on));
  scrim.classList.toggle('on', narrow() && !on);
  try { localStorage.setItem('tmsx-rail', on ? '1' : '0'); } catch (e) {}
}

tglBtn.onclick = () => setRail(!isRail());
scrim.onclick = () => setRail(true);

// จอแคบเปิดมาให้หุบไว้ก่อน จอกว้างจำค่าที่ผู้ใช้เลือกไว้
(() => {
  let start = narrow();
  try {
    const saved = localStorage.getItem('tmsx-rail');
    if (!narrow() && saved !== null) start = saved === '1';
  } catch (e) {}
  setRail(start);
})();

$$('.grp-h').forEach(h => {
  h.onclick = () => {
    const g = h.parentElement;
    if (isRail()) {           // โหมดไอคอน: คลิกแล้วกางออกพร้อมเปิดกลุ่มนั้น
      setRail(false);
      g.dataset.open = '1';
      return;
    }
    g.dataset.open = g.dataset.open === '1' ? '0' : '1';
  };
});

/* ---------------- สลับรายงาน PL / Actual Shipment ---------------- */
function setMode(m) {
  S.mode = m;
  $$('#modes .mode').forEach(b => {
    const on = b.dataset.m === m;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  $$('.mode-pl').forEach(e => e.classList.toggle('hide', m !== 'pl'));
  $$('.mode-as').forEach(e => e.classList.toggle('hide', m !== 'as'));

  // แต่ละโหมดมีชุดมุมมองของตัวเอง สลับแล้วต้องเลือกแท็บแรกของโหมดนั้น
  S.view = m === 'as' ? 'as' : 'rows';
  S.page = 1; S.q = ''; S.sort = { key: null, dir: 1 };
  $('#q').value = '';
  $$('.tabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === S.view));

  setExport(m === 'as' ? S.as.length > 0 : S.rows.length > 0);
  render();
  renderStats();
}
$$('#modes .mode').forEach(b => {
  b.onclick = () => { if (isRail()) setRail(false); setMode(b.dataset.m); };
});

/* ---------------- ช่วงวันที่: preset + กำหนดเอง ---------------- */
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const thai = s => s ? s.split('-').reverse().join('/') : '';

function applyPreset(kind) {
  const now = new Date();
  let from = '', to = '';
  if (kind === 'today') { from = to = iso(now); }
  else if (kind === '7' || kind === '30') {
    const d = new Date(now); d.setDate(d.getDate() - (Number(kind) - 1));
    from = iso(d); to = iso(now);
  } else if (kind === 'month') {
    from = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    to = iso(now);
  }
  if (kind !== 'custom') { $('#fFrom').value = from; $('#fTo').value = to; }
  $('#rangeBox').classList.toggle('hide', kind !== 'custom');
  refreshRangeSummary();
  refreshFilterCount();
}

function refreshRangeSummary() {
  const f = $('#fFrom').value, t = $('#fTo').value, box = $('#rangeSum');
  if (!f && !t) { box.classList.add('hide'); return; }
  if (f && t) box.textContent = f === t ? thai(f) : `${thai(f)} – ${thai(t)}`;
  else if (f) box.textContent = 'ตั้งแต่ ' + thai(f);
  else box.textContent = 'ถึง ' + thai(t);
  box.classList.remove('hide');
}

$$('#rangeChips .chip').forEach(c => {
  c.onclick = () => {
    $$('#rangeChips .chip').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
    applyPreset(c.dataset.r);
  };
});
['#fFrom', '#fTo'].forEach(s => $(s).addEventListener('change', () => {
  refreshRangeSummary(); refreshFilterCount();
}));

/* ---------------- Trip Date (Actual Shipment) ---------------- */
// ค่าเริ่มต้น = เมื่อวาน เพราะข้อมูลของวันปัจจุบันยังไม่ actual
// รอบข้อมูลปิดและส่งหลังเที่ยงคืน — หน้า TMS ก็ตั้งค่าเริ่มต้นแบบเดียวกัน
function tripPreset(kind) {
  const y = new Date(); y.setDate(y.getDate() - 1);
  let from = iso(y), to = iso(y);
  if (kind === 'y7' || kind === 'y30') {
    const d = new Date(y); d.setDate(d.getDate() - (kind === 'y7' ? 6 : 29));
    from = iso(d);
  }
  if (kind !== 'custom') { $('#tFrom').value = from; $('#tTo').value = to; }
  $('#tripBox').classList.toggle('hide', kind !== 'custom');
  tripSummary();
}

function tripSummary() {
  const f = $('#tFrom').value, t = $('#tTo').value, box = $('#tripSum');
  if (!f || !t) { box.classList.add('hide'); return; }
  box.textContent = f === t ? thai(f) : `${thai(f)} – ${thai(t)}`;
  box.classList.remove('hide');
}

$$('#tripChips .chip').forEach(c => {
  c.onclick = () => {
    $$('#tripChips .chip').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
    tripPreset(c.dataset.r);
  };
});
['#tFrom', '#tTo'].forEach(s => $(s).addEventListener('change', tripSummary));
tripPreset('y');

// นับตัวกรองที่ตั้งไว้ แสดงเป็น badge (และจุดเขียวตอนหุบ)
function refreshFilterCount() {
  let n = ['#fStatus', '#fArea', '#fKw'].filter(s => $(s).value.trim()).length;
  if ($('#fFrom').value || $('#fTo').value) n++;   // ช่วงวันที่นับเป็น 1
  const b = $('#fCnt');
  b.textContent = n;
  b.classList.toggle('hide', n === 0);
  $('[data-grp="filter"] .grp-h').classList.toggle('has-dot', n > 0);
}
['#fStatus', '#fArea', '#fKw'].forEach(s => {
  $(s).addEventListener('change', refreshFilterCount);
  $(s).addEventListener('input', refreshFilterCount);
});
refreshFilterCount();

// คีย์ลัด: [ หุบ/ขยาย · Esc ปิด drawer ตอนจอแคบ
document.addEventListener('keydown', e => {
  const t = e.target;
  const typing = t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
  if (e.key === '[' && !typing) { e.preventDefault(); setRail(!isRail()); }
  if (e.key === 'Escape' && narrow() && !isRail()) setRail(true);
});

window.addEventListener('resize', () => {
  scrim.classList.toggle('on', narrow() && !isRail());
});

/* ---------------- controls ---------------- */
$$('.tabs button[data-tab]').forEach(b => {
  b.onclick = () => {
    $$('.tabs button[data-tab]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    S.view = b.dataset.tab;
    S.page = 1;
    S.sort = { key: null, dir: 1 };
    render();
  };
});

let qt;
$('#q').oninput = e => {
  clearTimeout(qt);
  qt = setTimeout(() => { S.q = e.target.value.trim(); S.page = 1; render(); }, 200);
};
$('#prev').onclick = () => { S.page--; render(); };
$('#next').onclick = () => { S.page++; render(); };
$('#perPage').onchange = e => { S.perPage = +e.target.value; S.page = 1; render(); };

/* ---------------- export ---------------- */
function setExport(on) {
  ['#exCsv', '#exXls', '#exJson'].forEach(s => { $(s).disabled = !on; });
}

function download(content, name, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportRows() {
  // export ตามมุมมองที่เปิดอยู่ + คำค้น (ไม่ตัดตามหน้า)
  return { data: currentData(), cols: colsFor(S.view) };
}

$('#exCsv').onclick = () => {
  const { data, cols } = exportRows();
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = '﻿' + [cols.map(c => q(c[1])).join(',')]
    .concat(data.map(r => cols.map(c => q(r[c[0]])).join(',')))
    .join('\r\n');
  download(csv, `tms-${S.view}-${stamp()}.csv`, 'text/csv;charset=utf-8;');
};

$('#exJson').onclick = () => {
  const { data } = exportRows();
  download(JSON.stringify(data, null, 2), `tms-${S.view}-${stamp()}.json`, 'application/json');
};

// .xlsx จริง (ไม่ใช่ SpreadsheetML เปลี่ยนนามสกุล) — Excel เปิดได้โดยไม่เตือนเรื่องฟอร์แมต
$('#exXls').onclick = () => {
  const { data, cols } = exportRows();
  const val = v => {
    const n = Number(v);
    return (v !== '' && v != null && !isNaN(n) && String(v).trim() !== '') ? n : (v ?? '');
  };

  if (S.view === 'as') {
    // ไม่มีแถวหัวเรื่อง — หัวตารางอยู่แถว 1 เลย เอาไป pivot/power query ต่อได้ทันที
    const rows = [cols.map(c => ({ v: c[1], s: 'head' }))];
    for (const r of data) {
      rows.push(cols.map(([k]) => {
        const v = val(r[k]);
        if (k === 'statusDelivery') return { v, s: v === 'Completed' ? 'ok' : 'wrap' };
        if (k === 'sla') return { v, s: v === 'OnTime' ? 'ok' : v === 'Late' ? 'warn' : 'wrap' };
        return { v, s: 'wrap' };
      }));
    }

    const blob = buildXlsx({
      sheet: 'ActualShipment',
      rows,
      cols: cols.map(c => ({ w: c[0] === 'dealerName' || c[0] === 'branch' ? 34 : 16 })),
      autoFilter: `A1:${xlsxColName(cols.length)}1`
    });
    const f = ($('#tFrom').value || '').replace(/-/g, ''), t = ($('#tTo').value || '').replace(/-/g, '');
    downloadBlob(blob, `ActualShipment_${f}_${t}.xlsx`);
    return;
  }

  const blob = buildXlsx({
    sheet: S.view === 'rows' ? 'Rows' : S.view === 'pl' ? 'ByPL' : 'ByItem',
    rows: [cols.map(c => ({ v: c[1], s: 'head' }))]
      .concat(data.map(r => cols.map(c => ({ v: val(r[c[0]]) })))),
    cols: cols.map(c => ({ w: c[0] === 'itemName' || c[0] === 'items' ? 34 : 16 })),
    autoFilter: `A1:${xlsxColName(cols.length)}1`
  });
  downloadBlob(blob, `tms-${S.view}-${stamp()}.xlsx`);
};

/* ---------------- resume session ---------------- */
(() => {
  try {
    const s = JSON.parse(sessionStorage.getItem('tmsx') || 'null');
    if (s && s.token) { S.token = s.token; S.refreshToken = s.refreshToken; boot(); }
  } catch (e) {}
})();
