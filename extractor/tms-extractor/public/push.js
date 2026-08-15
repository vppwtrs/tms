/* ============================================================
   ส่งข้อมูลที่ดึงมาขึ้น Supabase

   ทำไมต้องยิงจากเครื่องนี้ ไม่ใช่จากหน้าเว็บบนคลาวด์:
   เบราว์เซอร์ยิงหา pdi.vespiario.net จากโดเมนอื่นไม่ได้ (CORS) — server.js ตัวนี้
   ทำ proxy ให้อยู่แล้ว ตัวดึงจึงต้องอยู่บนเครื่องเสมอ ส่วน "ที่เก็บ" ย้ายขึ้นคลาวด์ได้

   ไม่ใช้ไลบรารี supabase-js — คุยกับ PostgREST/GoTrue ด้วย fetch ตรง ๆ
   extractor ตั้งใจให้ zero dependency ตั้งแต่แรก จะได้ก๊อปโฟลเดอร์ไปวางเครื่องไหนก็รัน

   รหัสผ่านทั้งสองระบบ (TMS และ Supabase) ไม่เคยถูกเขียนลงดิสก์
   เก็บแค่ token ใน sessionStorage ปิดแท็บแล้วหาย
   ============================================================ */

const SB = {
  token: null,
  refresh: null,
  email: null,
  userName: null
};

/* session ของ Supabase เก็บใน localStorage ไม่ใช่ sessionStorage — ตั้งใจ
 *
 * ต่างจาก token ของ TMS ที่จงใจให้หายเมื่อปิดแท็บ เพราะนั่นคือระบบของบริษัท
 * ส่วนนี่คือระบบของเราเอง และคนออฟฟิศต้องกดส่งทุกเช้า ถ้าให้ล็อกอินสองรอบทุกวัน
 * สุดท้ายคนจะเลิกกด แล้วคนขับก็ไม่มีงาน
 *
 * เก็บ token ไม่ใช่รหัสผ่าน — access_token หมดอายุใน 1 ชั่วโมง ต่ออายุด้วย refresh_token
 * ปุ่ม "ออก" ลบทิ้งได้ตลอด
 */
const SB_KEY = 'sbSession';

function sbSave() {
  localStorage.setItem(SB_KEY, JSON.stringify({
    token: SB.token, refresh: SB.refresh, email: SB.email, userName: SB.userName
  }));
}

function sbCfg() {
  const c = window.SB_CONFIG || {};
  return {
    url: (localStorage.getItem('sbUrl') || c.url || '').replace(/\/+$/, ''),
    key: localStorage.getItem('sbKey') || c.anonKey || ''
  };
}

async function sbFetch(path, opts = {}, retried = false) {
  const { url, key } = sbCfg();
  if (!url || !key) throw new Error('ยังไม่ได้ตั้งค่า Supabase URL / anon key');

  const h = Object.assign(
    { 'Content-Type': 'application/json', apikey: key },
    opts.headers || {}
  );
  if (SB.token) h.Authorization = 'Bearer ' + SB.token;

  const res = await fetch(url + path, Object.assign({}, opts, { headers: h }));

  /* token หมดอายุระหว่างส่ง — ต่ออายุแล้วยิงซ้ำครั้งเดียว ไม่งั้นคนที่เปิดหน้าทิ้งไว้
     ข้ามคืนจะเจอ error ทั้งที่ไม่ได้ทำอะไรผิด  retried กันวนไม่รู้จบเมื่อต่ออายุไม่ได้จริง */
  if (res.status === 401 && SB.refresh && !retried && !path.startsWith('/auth/')) {
    if (await sbRefresh()) return sbFetch(path, opts, true);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* ไม่ใช่ json */ }
  if (!res.ok) {
    const err = new Error(
      (json && (json.message || json.error_description || json.msg || json.hint)) ||
      text.slice(0, 200) || ('HTTP ' + res.status)
    );
    err.status = res.status;
    throw err;
  }
  return json;
}

async function sbLogin(email, password) {
  const r = await sbFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  SB.token = r.access_token;
  SB.refresh = r.refresh_token || null;
  SB.email = (r.user && r.user.email) || email;
  sbSave();
  await sbWho();
}

async function sbRefresh() {
  try {
    const r = await sbFetch('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: SB.refresh })
    });
    SB.token = r.access_token;
    SB.refresh = r.refresh_token || SB.refresh;
    sbSave();
    return true;
  } catch (e) {
    sbLogout();
    return false;
  }
}

// ดึงชื่อจากตาราง users — ยืนยันว่าบัญชีนี้ถูกผูก auth_id แล้วจริง ไม่ใช่แค่ล็อกอินผ่าน
async function sbWho() {
  try {
    const me = await sbFetch('/rest/v1/users?select=name,role&limit=1');
    SB.userName = (me && me[0] && me[0].name) || null;
    sbSave();
  } catch (e) { /* ไม่ critical */ }
}

function sbLogout() {
  SB.token = null; SB.refresh = null; SB.email = null; SB.userName = null;
  localStorage.removeItem(SB_KEY);
  renderPush();
}

/* ---------- แปลงแถวรายงาน -> รูปแบบที่ push_tms_shipments รับ ---------- */

// หน้าจอแสดงวันที่เป็น dd/mm/yyyy (fmtD) — ฐานข้อมูลต้องการ ISO
function toIso(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// qtyCheck เป็นข้อความสำหรับคนอ่าน — ฐานข้อมูลรับแค่ 'qty' / 'split' / null
function qtySource(v) {
  const s = String(v || '');
  if (s.includes('(qty)')) return 'qty';
  if (s.includes('(split)')) return 'split';
  return '';
}

function pushRows() {
  return S.as.map(r => ({
    pickingListNo: r.pickingListNo,
    itemNo:        r.itemNo || '',
    itemName:      r.itemName || '',
    itemQty:       r.itemQty === '' || r.itemQty == null ? '' : String(r.itemQty),
    itemSplitQty:  r.itemSplitQty === '' || r.itemSplitQty == null ? '' : String(r.itemSplitQty),
    qtySource:     qtySource(r.qtyCheck),
    tripNo:        r.tripNo || '',
    tripDate:      toIso(r.orderDate),
    dealerCode:    r.dealerCode || '',
    dealerName:    r.dealerName || '',
    branch:        r.branch || '',
    province:      r.province || '',
    unit:          r.unit === '' || r.unit == null ? '' : String(r.unit),
    licensePlate:  r.licensePlate || '',
    driver:        r.driver || '',
    statusDelivery: r.statusDelivery || '',
    actualCost:    r.actualCost === '' || r.actualCost == null ? '' : String(r.actualCost),
    deliveryDate:  toIso(r.deliveryDate),
    area:          r.area || ''
  })).filter(r => r.pickingListNo);
}

/* แบ่งส่งทีละก้อน — วันเดียวก็หลายร้อยแถวแล้ว ถ้าส่งทีเดียวหมดจะกิน memory
   ฝั่ง Postgres โดยเปล่าประโยชน์ และถ้าเน็ตสะดุดกลางทางคือเสียทั้งก้อน
   ส่งซ้ำก้อนเดิมปลอดภัยเพราะฟังก์ชันเป็น upsert */
const PUSH_CHUNK = 400;

async function doPush() {
  const btn = $('#pushBtn');
  const log = $('#pushLog');

  const rows = pushRows();
  if (!rows.length) { log.textContent = 'ไม่มีข้อมูลให้ส่ง — กดดึงข้อมูลก่อน'; return; }

  const noDate = rows.filter(r => !r.tripDate).length;
  if (noDate === rows.length) {
    log.textContent = 'ข้อมูลไม่มีวันที่ ส่งไม่ได้';
    return;
  }

  btn.disabled = true;
  let sent = 0;
  const dates = new Set();

  try {
    for (let i = 0; i < rows.length; i += PUSH_CHUNK) {
      const chunk = rows.slice(i, i + PUSH_CHUNK);
      const r = await sbFetch('/rest/v1/rpc/push_tms_shipments', {
        method: 'POST',
        body: JSON.stringify({ p_rows: chunk })
      });
      sent += (r && r.rows) || 0;
      ((r && r.dates) || []).forEach(d => dates.add(d));
      log.innerHTML = `กำลังส่ง... <b>${num(sent)}</b>/<b>${num(rows.length)}</b> แถว`;
    }

    log.innerHTML = `ส่งขึ้นระบบแล้ว <b>${num(sent)}</b> แถว`
      + ` · <b>${dates.size}</b> วัน`
      + (noDate ? `<br><em>ข้าม ${num(noDate)} แถวที่ไม่มีวันที่</em>` : '')
      + '<br>ขั้นต่อไป: เปิดหน้าออฟฟิศ ตรวจการจับคู่ร้าน แล้วกดนำเข้า';
  } catch (e) {
    log.innerHTML = e.status === 401
      ? '<em>session Supabase หมดอายุ — เข้าสู่ระบบใหม่</em>'
      : `<em>ส่งไม่สำเร็จ: ${esc(e.message)}</em>`
      + (sent ? `<br>ส่งไปแล้ว ${num(sent)} แถว กดใหม่ได้ ข้อมูลไม่ซ้ำ` : '');
  }

  btn.disabled = false;
}

/* ============================================================
   โหมดอัตโนมัติ

   ล็อกอิน TMS เสร็จ -> ดึงเมื่อวาน -> ส่งขึ้นระบบ โดยไม่ต้องกดอะไรเลย
   แล้ววนซ้ำทุกชั่วโมงตราบที่หน้าต่างยังเปิดอยู่

   ทำไมต้องมีรอบวนซ้ำ ทั้งที่รอบข้อมูลปิดหลังเที่ยงคืนไปแล้ว:
   สถานะของเที่ยว (OnTruck -> Completed) ยังขยับได้ระหว่างวัน และคนออฟฟิศ
   เปิดหน้านี้ค้างไว้ทั้งวันอยู่แล้ว การดึงซ้ำจึงได้ของใหม่ฟรี ๆ

   ทำไมชั่วโมงละครั้ง ไม่ใช่ทุก 5 นาที: นี่คือ TMS ของบริษัท ไม่ใช่ของเรา
   ดึงถี่เกินจำเป็นคือไปกินทรัพยากรระบบที่คนทั้งบริษัทใช้อยู่
   ============================================================ */

const AUTO_KEY = 'sbAuto';
const AUTO_EVERY = 60 * 60 * 1000;
let autoTimer = null;
let autoBusy = false;

const autoOn = () => localStorage.getItem(AUTO_KEY) === '1';

async function autoRun(why) {
  // กันซ้อน: ถ้ารอบก่อนยังไม่จบ (เน็ตช้า/ข้อมูลเยอะ) ข้ามรอบนี้ไปเลย ดีกว่ายิงทับกัน
  if (autoBusy || !autoOn() || !SB.token || !S.token) return;
  autoBusy = true;

  try {
    if (S.mode !== 'as') setMode('as');
    tripPreset('y');                       // เมื่อวาน — วันเดียวกับที่หน้า TMS ตั้งไว้
    $('#pushLog').textContent = `อัตโนมัติ: กำลังดึงข้อมูล (${why})`;

    await runActual();
    if (!S.as.length) { $('#pushLog').textContent = 'อัตโนมัติ: ไม่มีข้อมูลของเมื่อวาน'; return; }

    await doPush();
  } catch (e) {
    $('#pushLog').innerHTML = `<em>อัตโนมัติล้มเหลว: ${esc(e.message)}</em>`;
  } finally {
    autoBusy = false;
    renderPush();
  }
}

function autoSync() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (autoOn()) autoTimer = setInterval(() => autoRun('รอบประจำชั่วโมง'), AUTO_EVERY);
  const box = $('#autoChk');
  if (box) box.checked = autoOn();
}

// เรียกจาก app.js หลังล็อกอิน TMS สำเร็จและโหลดโปรไฟล์เสร็จ
function onBooted() {
  autoSync();
  if (autoOn()) autoRun('หลังเข้าสู่ระบบ');
}

/* ---------- UI ---------- */
function renderPush() {
  const inBox = $('#pushIn');
  const outBox = $('#pushOut');
  const { url, key } = sbCfg();

  if (!url || !key) {
    inBox.classList.remove('hide');
    outBox.classList.add('hide');
    $('#pushWho').textContent = '';
    $('#pushCfgWrap').classList.remove('hide');
    return;
  }
  $('#pushCfgWrap').classList.add('hide');

  if (!SB.token) {
    inBox.classList.remove('hide');
    outBox.classList.add('hide');
    $('#pushWho').textContent = '';
  } else {
    inBox.classList.add('hide');
    outBox.classList.remove('hide');
    $('#pushWho').textContent = SB.userName ? `${SB.userName} · ${SB.email}` : SB.email;
  }

  // ส่งได้เฉพาะรายงาน Actual Shipment — ตาราง tms_shipments ออกแบบตามรายงานตัวนั้น
  const ok = S.mode === 'as' && S.as.length > 0;
  $('#pushBtn').disabled = !ok;
  $('#pushHint').textContent = S.mode !== 'as'
    ? 'สลับไปโหมด Actual Shipment แล้วดึงข้อมูลก่อน'
    : (S.as.length ? `พร้อมส่ง ${num(S.as.length)} แถว` : 'ยังไม่มีข้อมูล — กดดึงข้อมูลก่อน');
}

function initPush() {
  const saved = localStorage.getItem(SB_KEY);
  if (saved) {
    try {
      const o = JSON.parse(saved);
      SB.token = o.token; SB.refresh = o.refresh;
      SB.email = o.email; SB.userName = o.userName;
    } catch (e) { /* ข้อมูลเสีย ปล่อยให้ล็อกอินใหม่ */ }
  }

  const cfg = sbCfg();
  $('#sbUrl').value = cfg.url;
  $('#sbKey').value = cfg.key;

  $('#pushOpen').onclick = () => { $('#pushModal').classList.remove('hide'); renderPush(); };
  $('#pushClose').onclick = () => $('#pushModal').classList.add('hide');
  $('#pushModal').addEventListener('click', e => {
    if (e.target.id === 'pushModal') $('#pushModal').classList.add('hide');
  });

  $('#sbCfgSave').onclick = () => {
    localStorage.setItem('sbUrl', $('#sbUrl').value.trim());
    localStorage.setItem('sbKey', $('#sbKey').value.trim());
    $('#pushLog').textContent = 'บันทึกการตั้งค่าแล้ว';
    renderPush();
  };

  $('#pushIn').addEventListener('submit', async e => {
    e.preventDefault();
    const b = $('#sbLoginBtn');
    b.disabled = true; b.textContent = 'กำลังเข้าสู่ระบบ...';
    try {
      await sbLogin($('#sbEmail').value.trim(), $('#sbPw').value);
      $('#sbPw').value = '';
      $('#pushLog').textContent = '';
    } catch (err) {
      $('#pushLog').innerHTML = `<em>${esc(
        err.status === 400 ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : err.message
      )}</em>`;
    }
    b.disabled = false; b.textContent = 'เข้าสู่ระบบ';
    renderPush();
  });

  $('#sbLogout').onclick = sbLogout;
  $('#pushBtn').onclick = doPush;

  $('#autoChk').onchange = e => {
    localStorage.setItem(AUTO_KEY, e.target.checked ? '1' : '0');
    autoSync();
    // เปิดตอนที่ล็อกอินครบทั้งสองระบบแล้ว ก็ไม่ต้องรอรอบหน้า ยิงเลย
    if (e.target.checked && S.token && SB.token) autoRun('เพิ่งเปิดใช้');
    else $('#pushLog').textContent = e.target.checked ? 'เปิดโหมดอัตโนมัติแล้ว' : 'ปิดโหมดอัตโนมัติแล้ว';
  };

  autoSync();
  renderPush();
}

document.addEventListener('DOMContentLoaded', initPush);
