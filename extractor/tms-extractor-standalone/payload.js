/* ============================================================
   TMS Extractor — standalone (no server)
   วางใน Console ของ https://pdi.vespiario.net (หน้าไหนก็ได้)
   same-origin จึงไม่ติด CORS และ login ด้วย user/password ได้ตรง ๆ

   read-only ทั้งหมด:
     POST /tms-api/api/tokens                        login
     GET  /tms-api/api/personal/profile|warehouses
     POST /tms-api/api/v1/pickinglistheaders/{wh}/search
   ============================================================ */
(() => {
  const HOST_ID = 'tms-extractor-standalone';
  const API = '/tms-api/api';

  if (!location.host.includes('pdi.vespiario.net')) {
    alert('ต้องรันบนหน้า pdi.vespiario.net เท่านั้น (ข้อจำกัด CORS)');
    return;
  }
  const old = document.getElementById(HOST_ID);
  if (old) old.remove();

  /* ---------------- state ---------------- */
  const S = {
    token: null, user: null,
    mode: 'pl',        // 'pl' = Picking List, 'as' = Actual Shipment
    as: [],            // แถวรายงาน Actual Shipment
    asItems: false,    // แตกแถวตาม item แล้วหรือยัง
    rows: [], view: 'rows', page: 1, perPage: 100,
    sort: { key: null, dir: 1 }, q: '', abort: false, running: false
  };

  /* ---------------- utils ---------------- */
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = n => (n === '' || n == null || isNaN(Number(n))) ? (n ?? '') : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const stamp = () => new Date().toISOString().slice(0, 10);

  // วันที่แบบเดียวกับรายงาน TMS: dd/mm/yyyy
  function fmtD(v) {
    if (!v) return '';
    const s = String(v).slice(0, 10), [y, m, d] = s.split('-');
    return (y && m && d) ? `${d}/${m}/${y}` : s;
  }

  async function api(path, opts = {}) {
    const h = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (S.token) h.Authorization = 'Bearer ' + S.token;
    const res = await fetch(API + path, Object.assign({}, opts, { headers: h }));
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      let msg = (json && (json.exception || json.message || json.title)) || text.slice(0, 200) || ('HTTP ' + res.status);
      if (json && json.errors) msg += ' — ' + Object.keys(json.errors).join(', ');
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  /* ---------------- xlsx writer ----------------
     สำเนาจาก tms-extractor/public/xlsx.js — เวอร์ชัน standalone เป็นไฟล์เดียว
     จึงต้องฝังมาทั้งก้อน แก้ที่ไฟล์ต้นทางแล้วรัน build.js เพื่อ sync */
__XLSX__

  /* ---------------- shell (shadow DOM กัน CSS ชนกับ Angular) ---------------- */
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
<style>
  :host{all:initial}
  *{box-sizing:border-box;margin:0;padding:0}
  .wrap{
    position:fixed;inset:0;background:#f2f6f4;color:#132018;
    font:14px/1.55 -apple-system,"Segoe UI",Roboto,"Noto Sans Thai",sans-serif;
    display:flex;flex-direction:column;overflow:hidden
  }
  button,input,select{font:inherit;color:inherit}
  button{cursor:pointer}
  .hide{display:none !important}

  /* login */
  .login{position:absolute;inset:0;z-index:5;display:grid;place-items:center;
    background:linear-gradient(160deg,#0d8a58,#00a566 45%,#37c491)}
  .lbox{width:min(400px,92vw);background:#fff;border-radius:16px;padding:32px;
    box-shadow:0 24px 70px rgba(0,0,0,.3)}
  .lbox h1{font-size:22px;letter-spacing:-.3px;margin-bottom:4px}
  .lbox .s{color:#61756b;font-size:13px;margin-bottom:22px}
  .f{margin-bottom:14px}
  .f label{display:block;font-size:11.5px;font-weight:700;color:#61756b;
    text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
  .f input,.f select{width:100%;padding:10px 12px;border:1px solid #dde6e0;
    border-radius:9px;background:#fff}
  .f input:focus,.f select:focus{outline:2px solid rgba(0,165,102,.35);border-color:#00a566}
  .btn{width:100%;padding:11px;border:0;border-radius:9px;background:#00a566;color:#fff;
    font-weight:700}
  .btn:hover:not(:disabled){background:#00875a}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .btn.danger{background:#dc2626}
  .btn.danger:hover{background:#b91c1c}
  .err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:9px;
    padding:10px 12px;font-size:13px;margin-bottom:14px;white-space:pre-wrap}
  .hint{font-size:11.5px;color:#61756b;margin-top:16px;line-height:1.65}
  .lx{position:absolute;top:18px;right:22px;background:rgba(255,255,255,.2);color:#fff;
    border:0;border-radius:8px;width:34px;height:34px;font-size:19px;line-height:1}
  .lx:hover{background:rgba(255,255,255,.35)}

  /* top */
  .top{background:#fff;border-bottom:1px solid #dde6e0;padding:0 18px;height:54px;
    display:flex;align-items:center;gap:14px;flex:none}
  .top .logo{font-weight:800;font-size:15px}
  .top .logo i{color:#00a566;font-style:normal}
  .top .who{margin-left:auto;font-size:12px;color:#61756b;text-align:right;line-height:1.35}
  .top .who b{color:#132018;display:block;font-size:13px}
  .top button{background:transparent;border:1px solid #dde6e0;border-radius:8px;
    padding:6px 12px;font-size:12.5px;color:#61756b}
  .top button:hover{border-color:#dc2626;color:#dc2626}
  .top button.cl:hover{border-color:#132018;color:#132018}

  .main{flex:1;display:flex;min-height:0}

  /* ---------- side (หุบ/ขยายได้) ---------- */
  .side{
    width:272px;flex:none;background:#fff;border-right:1px solid #dde6e0;
    display:flex;flex-direction:column;position:relative;
    transition:width .2s ease-out
  }
  .side.rail{width:56px}
  .side-body{flex:1;overflow-y:auto;overflow-x:hidden;padding:10px 14px 16px}
  .side.rail .side-body{padding:10px 0 16px;overflow:visible}

  /* สลับรายงาน */
  .modes{display:flex;gap:4px;background:#e6f6ef;border-radius:11px;padding:4px;margin:2px 0 12px}
  .mode{flex:1;min-width:0;display:flex;align-items:center;justify-content:center;gap:7px;
    border:0;background:none;border-radius:8px;padding:9px 6px;min-height:38px;cursor:pointer;
    font:inherit;font-size:12px;font-weight:700;color:#00734d;white-space:nowrap;
    transition:background .15s ease-out,box-shadow .15s ease-out}
  .mode svg{display:none;flex:none;width:15px;height:15px;stroke:currentColor;fill:none;
    stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .mode span{overflow:hidden;text-overflow:ellipsis}
  .mode:hover{background:rgba(255,255,255,.55)}
  .mode.on{background:#fff;color:#00875a;box-shadow:0 1px 3px rgba(9,20,15,.12)}
  .mode:focus-visible{outline:2px solid #00a566;outline-offset:2px}
  .side.rail .modes{flex-direction:column;gap:3px;margin:2px 8px 10px;padding:3px}
  .side.rail .mode{padding:0;height:36px}
  .side.rail .mode span{display:none}
  .side.rail .mode svg{display:block}
  .chk{display:flex;align-items:flex-start;gap:8px;margin-top:11px;cursor:pointer;
    font-size:12px;line-height:1.5;color:#132018}
  .chk input{flex:none;width:16px;height:16px;margin:1px 0 0;accent-color:#00a566;cursor:pointer}
  .chk input:focus-visible{outline:2px solid #00a566;outline-offset:2px}
  .note-s{margin:10px 0 0;font-size:11.5px;line-height:1.6;color:#5f736a;
    border-left:2px solid #dde6e0;padding-left:9px}

  /* กลุ่มพับได้ */
  .grp{border-bottom:1px solid #eef3f0}
  .grp:last-of-type{border-bottom:0}
  .grp-h{
    width:100%;display:flex;align-items:center;gap:9px;background:none;border:0;
    padding:11px 2px;min-height:44px;font-size:11.5px;font-weight:800;color:#61756b;
    text-transform:uppercase;letter-spacing:.6px;text-align:left;border-radius:8px
  }
  .grp-h:hover{color:#00875a}
  .grp-h:focus-visible,.icon-btn:focus-visible,.rail-btn:focus-visible{
    outline:2px solid #00a566;outline-offset:2px}
  .grp-h svg{flex:none;width:16px;height:16px;stroke:currentColor;fill:none;
    stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
  .grp-h .lb{flex:1;min-width:0}
  .grp-h .cv{width:14px;height:14px;transition:transform .2s ease-out;opacity:.6}
  .grp[data-open="1"] .grp-h .cv{transform:rotate(180deg)}
  .grp-b{display:none;padding:0 2px 14px}
  .grp[data-open="1"] .grp-b{display:block}
  .badge{
    background:#e6f6ef;color:#00734d;border-radius:20px;padding:1px 7px;font-size:10.5px;
    font-weight:800;letter-spacing:0}

  /* โหมด rail: เหลือแต่ไอคอน */
  .side.rail .grp{border:0}
  .side.rail .grp-h{justify-content:center;padding:0;margin:3px auto;width:40px;height:40px;
    min-height:40px;border-radius:9px}
  .side.rail .grp-h:hover{background:#e6f6ef}
  .side.rail .grp-h .lb,.side.rail .grp-h .cv,.side.rail .grp-h .badge,
  .side.rail .grp-b,.side.rail .side-foot .lbl{display:none}
  .side.rail .grp-h svg{width:19px;height:19px}
  .grp-h{position:relative}
  .grp-h .dot{display:none}
  .side.rail .grp-h.has-dot .dot{
    display:block;position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;
    background:#00a566;border:2px solid #fff}

  .side-foot{border-top:1px solid #eef3f0;padding:12px 14px;background:#fff}
  .side.rail .side-foot{padding:10px 8px}
  .side.rail .side-foot .btn{padding:0;height:40px;display:grid;place-items:center}
  .side.rail .prog,.side.rail .plog{display:none}
  .side:not(.rail) #run .ic{display:none}
  #run .ic{stroke:currentColor}

  /* ช่วงวันที่ */
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{border:1px solid #dde6e0;background:#fff;border-radius:20px;padding:7px 12px;
    font-size:12px;font-weight:600;color:#61756b;line-height:1.2;white-space:nowrap}
  .chip:hover{border-color:#00a566;color:#00875a}
  .chip:focus-visible{outline:2px solid #00a566;outline-offset:2px}
  .chip.on{background:#e6f6ef;border-color:#00a566;color:#00734d}
  .range{margin-top:9px;display:flex;flex-direction:column;gap:7px}
  .rr{display:flex;align-items:center;gap:8px}
  .rr span{flex:none;width:26px;font-size:11.5px;color:#61756b;font-weight:700}
  .rr input{flex:1;min-width:0;padding:8px 9px;border:1px solid #dde6e0;border-radius:9px;
    background:#fff;font-size:13px}
  .rr input:focus{outline:2px solid rgba(0,165,102,.35);border-color:#00a566}
  .rsum{margin-top:7px;font-size:11.5px;color:#00734d;background:#e6f6ef;border-radius:7px;
    padding:5px 9px;font-variant-numeric:tabular-nums}

  .g2{display:grid;grid-template-columns:1fr 1fr;gap:9px}
  .prog{height:6px;background:#eef3f0;border-radius:5px;overflow:hidden;margin-top:11px}
  .prog i{display:block;height:100%;width:0;background:#00a566;transition:width .25s}
  .plog{margin-top:8px;font-size:11.5px;color:#61756b;min-height:32px;white-space:pre-wrap;
    font-family:Consolas,monospace;line-height:1.5}
  .plog b{color:#00875a}
  .plog em{color:#dc2626;font-style:normal}

  /* ปุ่มไอคอนบน top bar */
  .icon-btn{
    width:36px;height:36px;display:grid;place-items:center;border:1px solid #dde6e0;
    background:#fff;border-radius:9px;flex:none;padding:0}
  .icon-btn:hover{border-color:#00a566;background:#e6f6ef}
  .icon-btn svg{width:18px;height:18px;stroke:#41544a;fill:none;stroke-width:1.75;
    stroke-linecap:round;stroke-linejoin:round}
  .icon-btn:hover svg{stroke:#00734d}

  /* จอแคบ: sidebar กลายเป็น drawer ลอย */
  .scrim{position:absolute;inset:0;background:rgba(9,20,15,.45);z-index:3;display:none}
  @media (max-width:900px){
    .side{position:absolute;top:54px;bottom:0;left:0;z-index:4;
      box-shadow:6px 0 26px rgba(9,20,15,.16)}
    .side.rail{transform:translateX(-100%);width:272px;box-shadow:none}
    .scrim.on{display:block}
  }
  @media (prefers-reduced-motion:reduce){
    .side,.grp-h .cv,.prog i{transition:none}
  }

  /* content */
  .content{flex:1;display:flex;flex-direction:column;min-width:0;padding:16px 18px;gap:13px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:11px;flex:none}
  .stat{background:#fff;border:1px solid #dde6e0;border-radius:12px;padding:12px 15px}
  .stat .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:#61756b;font-weight:700}
  .stat .v{font-size:24px;font-weight:800;letter-spacing:-.7px;margin-top:2px;line-height:1.1}

  .tabs{display:flex;gap:5px;flex:none;border-bottom:1px solid #dde6e0;align-items:flex-end;
    flex-wrap:wrap}
  .tabs button[data-tab]{background:none;border:0;border-bottom:2px solid transparent;
    padding:9px 14px;font-weight:600;font-size:13.5px;color:#61756b;margin-bottom:-1px;
    white-space:nowrap}
  .tabs button[data-tab].on{color:#00875a;border-bottom-color:#00a566}
  .tabs .sp{margin-left:auto;display:flex;gap:7px;align-items:center;padding-bottom:7px;
    flex-wrap:wrap;min-width:0}
  .tabs .sp input{padding:7px 11px;border:1px solid #dde6e0;border-radius:8px;
    flex:1 1 130px;width:200px;max-width:200px;min-width:110px;font-size:13px}
  .tabs .sp button{border:1px solid #dde6e0;border-radius:8px;padding:7px 13px;font-size:12.5px;
    background:#fff;font-weight:600}
  .tabs .sp button:hover:not(:disabled){border-color:#00a566;color:#00875a}
  .tabs .sp button:disabled{opacity:.4;cursor:not-allowed}

  .pane{flex:1;background:#fff;border:1px solid #dde6e0;border-radius:12px;
    overflow:auto;min-height:0}
  table{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px}
  thead th{position:sticky;top:0;background:#f7faf8;z-index:2;text-align:left;font-weight:700;
    padding:9px 11px;border-bottom:1px solid #dde6e0;white-space:nowrap;cursor:pointer;
    color:#61756b;font-size:11px;text-transform:uppercase;letter-spacing:.35px}
  thead th:hover{color:#00875a}
  thead th .ar{opacity:.45;font-size:10px;margin-left:3px}
  tbody td{padding:8px 11px;border-bottom:1px solid #eef3f0;white-space:nowrap;
    max-width:280px;overflow:hidden;text-overflow:ellipsis}
  tbody tr:hover td{background:#f8fbf9}
  td.ok{background:#e4f7e0}
  td.warn{background:#fdf0d8}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .pill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700}
  .p-New{background:#dbeafe;color:#1d4ed8}
  .p-AssignTrip{background:#fef3c7;color:#92400e}
  .p-OnTruck{background:#ede9fe;color:#5b21b6}
  .p-Completed{background:#d1fae5;color:#065f46}
  .p-Cancelled{background:#fee2e2;color:#991b1b}
  .empty{display:grid;place-items:center;height:100%;color:#61756b;text-align:center;
    padding:40px;line-height:1.9}
  .empty>div{max-width:420px}
  .foot{flex:none;display:flex;align-items:center;gap:12px;font-size:12.5px;color:#61756b}
  .foot .sp2{margin-left:auto;display:flex;gap:7px;align-items:center}
  .foot button,.foot select{border:1px solid #dde6e0;background:#fff;border-radius:7px;
    padding:5px 11px;font-size:12.5px}
  .foot button:disabled{opacity:.4;cursor:not-allowed}
  .barm{display:inline-block;height:7px;background:#00a566;border-radius:4px;min-width:2px;
    vertical-align:middle}
</style>

<div class="wrap">

  <!-- login -->
  <div class="login" id="login">
    <button class="lx" id="lx" title="ปิด">&times;</button>
    <form class="lbox" id="lform">
      <h1>TMS Extractor</h1>
      <div class="s">ดึง Picking List พร้อมชื่อ Item ออกเป็น CSV / Excel / JSON</div>
      <div class="err hide" id="lerr"></div>
      <div class="f"><label>Username</label>
        <input id="u" type="text" autocomplete="username" required></div>
      <div class="f"><label>Password</label>
        <input id="p" type="password" autocomplete="current-password" required></div>
      <div class="f"><label>Tenant</label><input id="t" value="root"></div>
      <button class="btn" id="lbtn" type="submit">เข้าสู่ระบบ</button>
      <div class="hint">
        ล็อคอินด้วย user TMS ของคุณเอง — รหัสผ่านถูกส่งไปที่
        <b>/tms-api/api/tokens</b> ของเซิร์ฟเวอร์ TMS ตัวจริงเท่านั้น
        แล้วเคลียร์ออกจากฟอร์มทันที ไม่เก็บ ไม่ส่งที่อื่น<br>
        token อยู่ในหน่วยความจำของแท็บนี้ ปิดแล้วหาย
      </div>
    </form>
  </div>

  <!-- app -->
  <div class="top">
    <button class="icon-btn" id="tgl" title="หุบ/ขยายแผงตัวกรอง  ( [ )" aria-label="หุบหรือขยายแผงตัวกรอง" aria-expanded="true">
      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>
    </button>
    <div class="logo"><i>&#9632;</i> TMS Extractor</div>
    <div class="who"><b id="wn">&mdash;</b><span id="wm"></span></div>
    <button id="out">ออกจากระบบ</button>
    <button id="close" class="cl">ปิด</button>
  </div>

  <div class="main">
    <div class="scrim" id="scrim"></div>

    <aside class="side" id="side">
      <div class="side-body">

        <div class="modes" id="modes" role="tablist" aria-label="เลือกรายงาน">
          <button class="mode on" data-m="pl" role="tab" aria-selected="true">
            <svg viewBox="0 0 24 24"><path d="M8 3h8a2 2 0 0 1 2 2v16l-6-3-6 3V5a2 2 0 0 1 2-2z"/></svg>
            <span>Picking List</span>
          </button>
          <button class="mode" data-m="as" role="tab" aria-selected="false">
            <svg viewBox="0 0 24 24"><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>
            <span>Actual Shipment</span>
          </button>
        </div>

        <section class="grp" data-grp="src" data-open="1">
          <button class="grp-h" title="แหล่งข้อมูล">
            <svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>
            <span class="lb">แหล่งข้อมูล</span>
            <span class="dot"></span>
            <svg class="cv" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="grp-b">
            <div class="f"><label for="wh">Warehouse</label><select id="wh"></select></div>
          </div>
        </section>

        <section class="grp mode-as hide" data-grp="trip" data-open="1">
          <button class="grp-h" title="ช่วงวันที่">
            <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
            <span class="lb">Trip Date</span>
            <span class="dot"></span>
            <svg class="cv" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="grp-b">
            <div class="chips" id="tripChips">
              <button type="button" class="chip on" data-r="y">เมื่อวาน</button>
              <button type="button" class="chip" data-r="y7">7 วันย้อนหลัง</button>
              <button type="button" class="chip" data-r="y30">30 วันย้อนหลัง</button>
              <button type="button" class="chip" data-r="custom">กำหนดเอง</button>
            </div>
            <div class="range" id="tripBox">
              <div class="rr"><span>จาก</span><input id="tFrom" type="date"></div>
              <div class="rr"><span>ถึง</span><input id="tTo" type="date"></div>
            </div>
            <div class="rsum" id="tripSum"></div>
            <label class="chk">
              <input type="checkbox" id="asItems" checked>
              <span>ดึงชื่อ item มาด้วย — แตกเป็นแถวละ item</span>
            </label>
            <p class="note-s">
              ข้อมูลของวันปัจจุบันยังไม่ actual — รอบข้อมูลปิดและส่งหลังเที่ยงคืน
              ค่าเริ่มต้นจึงเป็นเมื่อวาน เหมือนหน้า TMS
            </p>
          </div>
        </section>

        <section class="grp mode-pl" data-grp="filter" data-open="1">
          <button class="grp-h" title="ตัวกรอง">
            <svg viewBox="0 0 24 24"><path d="M3 4h18l-7 8v7l-4 2v-9z"/></svg>
            <span class="lb">ตัวกรอง</span>
            <span class="badge hide" id="fCnt">0</span>
            <span class="dot"></span>
            <svg class="cv" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="grp-b">
            <div class="g2">
              <div class="f"><label for="fSt">Status</label>
                <select id="fSt"><option value="">ทั้งหมด</option>
                  <option>New</option><option>AssignTrip</option>
                  <option>OnTruck</option><option>Completed</option></select></div>
              <div class="f"><label for="fAr">Area</label>
                <select id="fAr"><option value="">ทั้งหมด</option>
                  <option>BKK1</option><option>BKK2</option><option>BKK3</option>
                  <option>UPC1</option><option>UPC2</option><option>UPC3</option><option>UPC4</option>
                  <option>UPC5</option><option>UPC6</option><option>UPC7</option>
                  <option>NONE</option></select></div>
            </div>
            <div class="f"><label for="fKw">Keyword</label>
              <input id="fKw" placeholder="PL No / ลูกค้า / item"></div>
            <div class="f">
              <label>ช่วง Plan Delivery</label>
              <div class="chips" id="rangeChips">
                <button type="button" class="chip on" data-r="">ทั้งหมด</button>
                <button type="button" class="chip" data-r="today">วันนี้</button>
                <button type="button" class="chip" data-r="7">7 วัน</button>
                <button type="button" class="chip" data-r="30">30 วัน</button>
                <button type="button" class="chip" data-r="month">เดือนนี้</button>
                <button type="button" class="chip" data-r="custom">กำหนดเอง</button>
              </div>
              <div class="range hide" id="rangeBox">
                <div class="rr"><span>จาก</span><input id="fFr" type="date"></div>
                <div class="rr"><span>ถึง</span><input id="fTo" type="date"></div>
              </div>
              <div class="rsum hide" id="rangeSum"></div>
            </div>
          </div>
        </section>

        <section class="grp mode-pl" data-grp="opt" data-open="0">
          <button class="grp-h" title="ตัวเลือกการดึง">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>
            <span class="lb">ตัวเลือกการดึง</span>
            <svg class="cv" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="grp-b">
            <div class="g2">
              <div class="f"><label for="oPs">Page size</label>
                <input id="oPs" type="number" value="500" min="10" max="2000"></div>
              <div class="f"><label for="oMx">จำกัดหน้า (0=หมด)</label>
                <input id="oMx" type="number" value="0" min="0"></div>
            </div>
          </div>
        </section>

      </div>

      <div class="side-foot">
        <button class="btn" id="run" title="ดึงข้อมูล">
          <span class="lbl">ดึงข้อมูล</span>
          <svg class="ic" viewBox="0 0 24 24" width="18" height="18" fill="none"
               stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>
        </button>
        <button class="btn danger hide" id="stop" style="margin-top:8px">หยุด</button>
        <div class="prog"><i id="bar"></i></div>
        <div class="plog" id="plog">พร้อมใช้งาน</div>
      </div>
    </aside>

    <section class="content">
      <div class="stats" id="stats"></div>
      <div class="tabs">
        <button data-tab="rows" class="on mode-pl">รายการ (1 แถว = 1 item)</button>
        <button data-tab="pl" class="mode-pl">สรุปราย PL</button>
        <button data-tab="item" class="mode-pl">สรุปราย Item</button>
        <button data-tab="as" class="mode-as hide">รายงาน Actual Shipment</button>
        <div class="sp">
          <input id="q" placeholder="ค้นในผลลัพธ์...">
          <button id="exCsv" disabled>CSV</button>
          <button id="exXls" disabled>Excel</button>
          <button id="exJson" disabled>JSON</button>
        </div>
      </div>
      <div class="pane" id="pane">
        <div class="empty">ยังไม่มีข้อมูล<br>ตั้งค่าตัวกรองทางซ้ายแล้วกด <b>ดึงข้อมูล</b></div>
      </div>
      <div class="foot">
        <span id="cnt">&mdash;</span>
        <div class="sp2">
          <button id="prev" disabled>ก่อนหน้า</button>
          <span id="pg">&ndash;</span>
          <button id="next" disabled>ถัดไป</button>
          <select id="pp"><option>50</option><option selected>100</option>
            <option>250</option><option>500</option></select>
        </div>
      </div>
    </section>
  </div>
</div>`;

  const $ = s => root.querySelector(s);
  const $$ = s => [...root.querySelectorAll(s)];
  const plog = (m, c) => { $('#plog').innerHTML = c ? `<${c}>${m}</${c}>` : m; };

  $('#lx').onclick = $('#close').onclick = () => host.remove();

  /* ---------- sidebar: หุบ/ขยาย + กลุ่มพับได้ ---------- */
  const side = $('#side'), scrim = $('#scrim'), tglBtn = $('#tgl');
  const narrow = () => host.getBoundingClientRect().width <= 900;

  function setRail(on) {
    side.classList.toggle('rail', on);
    tglBtn.setAttribute('aria-expanded', String(!on));
    scrim.classList.toggle('on', narrow() && !on);
    try { localStorage.setItem('tmsx-rail', on ? '1' : '0'); } catch (e) {}
  }
  const isRail = () => side.classList.contains('rail');

  tglBtn.onclick = () => setRail(!isRail());
  scrim.onclick = () => setRail(true);

  // จอแคบเปิดมาให้หุบไว้ก่อน จอกว้างจำค่าที่ผู้ใช้เลือกไว้
  let startRail = narrow();
  try {
    const saved = localStorage.getItem('tmsx-rail');
    if (!narrow() && saved !== null) startRail = saved === '1';
  } catch (e) {}
  setRail(startRail);

  $$('.grp-h').forEach(h => {
    h.onclick = () => {
      const g = h.parentElement;
      if (isRail()) {                    // อยู่โหมดไอคอน: คลิกแล้วกางออกพร้อมเปิดกลุ่มนั้น
        setRail(false);
        g.dataset.open = '1';
        return;
      }
      g.dataset.open = g.dataset.open === '1' ? '0' : '1';
    };
  });

  /* ---------- ช่วงวันที่: preset + กำหนดเอง ---------- */
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
    if (kind !== 'custom') { $('#fFr').value = from; $('#fTo').value = to; }
    $('#rangeBox').classList.toggle('hide', kind !== 'custom');
    refreshRangeSummary();
    refreshFilterCount();
  }

  function refreshRangeSummary() {
    const f = $('#fFr').value, t = $('#fTo').value, box = $('#rangeSum');
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
  ['#fFr', '#fTo'].forEach(s => $(s).addEventListener('change', () => {
    refreshRangeSummary(); refreshFilterCount();
  }));

  // นับตัวกรองที่ตั้งไว้ แสดงเป็น badge (และจุดเขียวตอนหุบ)
  function refreshFilterCount() {
    let n = ['#fSt', '#fAr', '#fKw'].filter(s => $(s).value.trim()).length;
    if ($('#fFr').value || $('#fTo').value) n++;   // ช่วงวันที่นับเป็น 1
    const b = $('#fCnt');
    b.textContent = n;
    b.classList.toggle('hide', n === 0);
    side.querySelector('[data-grp="filter"] .grp-h').classList.toggle('has-dot', n > 0);
  }
  ['#fSt', '#fAr', '#fKw'].forEach(s => {
    $(s).addEventListener('change', refreshFilterCount);
    $(s).addEventListener('input', refreshFilterCount);
  });
  refreshFilterCount();

  // คีย์ลัด: [ หุบ/ขยาย · Esc ปิด drawer ตอนจอแคบ
  host.addEventListener('keydown', e => {
    const t = e.target;
    const typing = t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
    if (e.key === '[' && !typing) { e.preventDefault(); setRail(!isRail()); }
    if (e.key === 'Escape' && narrow() && !isRail()) setRail(true);
  });

  window.addEventListener('resize', () => {
    scrim.classList.toggle('on', narrow() && !isRail());
  });
  $('#out').onclick = () => {
    S.token = null; S.rows = [];
    $('#login').classList.remove('hide');
    render(); renderStats(); setExport(false);
  };

  /* ---------------- login ---------------- */
  $('#lform').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#lbtn'), errb = $('#lerr');
    errb.classList.add('hide');
    btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ...';

    const u = $('#u').value.trim(), p = $('#p').value, t = $('#t').value.trim() || 'root';
    // ยืนยันจาก validation error ของ API แล้วว่าใช้ UserName + Password
    const shapes = [{ userName: u, password: p }, { email: u, password: p }];

    let ok = false, last = null;
    for (const body of shapes) {
      try {
        const r = await api('/tokens', { method: 'POST', headers: { tenant: t }, body: JSON.stringify(body) });
        S.token = r.token; ok = true; break;
      } catch (err) { last = err; if (err.status === 401) break; }
    }

    btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
    if (!ok) {
      errb.textContent = (last && last.status === 401)
        ? 'เข้าสู่ระบบไม่สำเร็จ — ตรวจ username, password และ tenant'
        : 'ผิดพลาด: ' + (last ? last.message : 'unknown');
      errb.classList.remove('hide');
      return;
    }

    $('#p').value = '';
    $('#login').classList.add('hide');
    await boot();
  });

  async function boot() {
    try {
      const pr = await api('/personal/profile');
      $('#wn').textContent = [pr.firstName, pr.lastName].filter(Boolean).join(' ') || pr.userName || 'user';
      $('#wm').textContent = pr.email || '';
    } catch (e) { $('#wn').textContent = 'user'; }

    try {
      const w = await api('/personal/warehouses');
      const list = Array.isArray(w) ? w : (w && w.data) || [];
      const sel = $('#wh'); sel.innerHTML = '';
      list.forEach(x => {
        const n = x.name || x.warehouse || x;
        const o = document.createElement('option');
        o.value = n;
        // reports/actualshipment อ้าง warehouse ด้วย GUID ไม่ใช่รหัส
        const id = x.id || x.warehouseId || x.warehouseID || '';
        if (id) o.dataset.id = id;
        o.textContent = x.description ? `${n} — ${x.description}` : n;
        sel.appendChild(o);
      });
      if (!sel.options.length) sel.innerHTML = '<option>KM23-CW-01</option>';
    } catch (e) {
      $('#wh').innerHTML = '<option>KM23-CW-01</option>';
      plog('ดึงรายชื่อ warehouse ไม่ได้ ใช้ค่าเริ่มต้น', 'em');
    }
    renderStats();
  }

  /* ---------------- fetch ---------------- */
  const flatten = h => {
    const ds = (h.details && h.details.length) ? h.details : [{}];
    return ds.map(d => ({
      pickingListNo: h.pickingListNo || '', status: h.status || '',
      planDeliveryDate: (h.planDeliveryDate || '').slice(0, 10),
      area: h.area || '', plType: h.pickingListTypeName || '',
      company: h.company || '', warehouse: h.warehouse || '',
      customerCode: h.customerCode || '', customerName: h.customerName || '',
      customerProvince: h.customerProvince || '',
      shipToName: h.shipToName || '', shipToProvince: h.shipToProvince || '',
      shipToPostCode: h.shipToPostCode || '',
      totalQty: h.totalQty ?? '',
      isManual: h.isManual === true ? 'Y' : (h.isManual === false ? 'N' : ''),
      reason: h.reason || '', tripNo: h.tripNo || '', tripStatus: h.tripStatus || '',
      orderDate: (h.orderDate || '').slice(0, 10),
      pickupDate: (h.pickupDate || '').slice(0, 19).replace('T', ' '),
      deliveryDate: (h.deliveryDate || '').slice(0, 19).replace('T', ' '),
      itemNo: d.itemNo || '', itemName: d.description || '',
      itemQty: d.qty ?? '', itemSplitQty: d.splitQty ?? ''
    }));
  };

  $('#run').onclick = () => (S.mode === 'as' ? runActual() : runPL());

  /* ---------- Actual Shipment ----------
     POST /v1/reports/actualshipment { planDeliveryDate:[iso,iso], warehouseId }
     คืน array แบน 1 แถว = 1 บรรทัดรายงาน ไม่มีการแบ่งหน้า                   */
  let whIdCache = null;
  async function warehouseId(code) {
    const opt = $('#wh').selectedOptions[0];
    if (opt && opt.dataset.id) return opt.dataset.id;
    if (!whIdCache) {
      const r = await api('/v1/warehouses/search', {
        method: 'POST', body: JSON.stringify({ pageNumber: 1, pageSize: 200 })
      });
      whIdCache = new Map((r.data || r.items || []).map(w => [w.name || w.warehouse, w.id]));
    }
    const id = whIdCache.get(code);
    if (!id) throw new Error(`หา warehouse id ของ ${code} ไม่เจอ`);
    return id;
  }

  /* ---------- เติมชื่อ item ให้รายงาน Actual Shipment ----------
     รายงานมีแต่ pickingListNo ไม่มี item — ไปดึงจาก pickinglistheaders ที่ส่ง
     details[] มาอยู่แล้ว แล้ว join ด้วยเลข PL

     ไล่หน้าทีเดียวจบ ไม่ยิงทีละใบ แล้วหยุดทันทีที่เจอครบ                      */
  function plKeyVariants(no) {
    // เลข PL ในรายงานบางใบมีหาง -C-04 ต่อท้าย ลองทั้งแบบเต็มและตัดหาง
    const s = String(no || '').trim();
    const base = s.replace(/-[A-Za-z]+-\d+$/, '');
    return base !== s ? [s, base] : [s];
  }

  async function attachItems() {
    const wh = $('#wh').value;
    const want = new Set();
    for (const r of S.as) plKeyVariants(r.pickingListNo).forEach(k => want.add(k));

    const found = new Map();
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
          if (want.has(h.pickingListNo)) { found.set(h.pickingListNo, h.details || []); want.delete(h.pickingListNo); }
        }
        plog(`หาชื่อ item... สแกน PL <b>${num(scanned)}</b> · เจอแล้ว <b>${num(found.size)}</b>`);
        if (data.length < ps) break;
        page++;
      }
    } catch (e) {
      plog('ดึงชื่อ item ไม่สำเร็จ: ' + e.message, 'em');
      return ['ดึงชื่อ item ไม่ครบ: ' + e.message];
    }

    const out = [];
    let missing = 0, mismatch = 0;
    for (const r of S.as) {
      let det = null;
      for (const k of plKeyVariants(r.pickingListNo)) if (found.has(k)) { det = found.get(k); break; }
      if (!det || !det.length) {
        missing++;
        out.push(Object.assign({}, r, { itemNo: '', itemName: '', itemQty: '', itemSplitQty: '', qtyCheck: '' }));
        continue;
      }

      // เลข PL ที่มีหาง -C-04 คือ "ส่วนที่ 4" ของใบนั้น = PL ถูกแบ่งส่งหลายเที่ยว
      // details[] ที่ดึงมาเป็นของทั้งใบ ยอดจึงไม่เท่ากับ unit ของเที่ยวนี้
      // splitQty น่าจะเป็นจำนวนที่ยกไปจริง เลยแสดงคู่กับ qty ให้เทียบเอง
      const sumQty   = det.reduce((s, d) => s + (Number(d.qty) || 0), 0);
      const sumSplit = det.reduce((s, d) => s + (Number(d.splitQty) || 0), 0);
      const u = Number(r.unit) || 0;
      const match = sumQty === u ? 'qty' : (sumSplit === u ? 'split' : '');
      if (!match) mismatch++;

      // ค่า unit/actualCost ที่ซ้ำ ถูกเว้นว่างทีหลังใน dedupAs()
      det.forEach(d => out.push(Object.assign({}, r, {
        itemNo: d.itemNo || '', itemName: d.description || '',
        itemQty: d.qty ?? '', itemSplitQty: d.splitQty ?? '',
        qtyCheck: match === 'qty' ? 'ตรง (qty)'
                : match === 'split' ? 'ตรง (split)'
                : `ไม่ตรง (qty ${sumQty} / split ${sumSplit} / unit ${u})`
      })));
    }

    S.as = out;
    S.asItems = true;
    S.asMismatch = mismatch;

    // ส่งกลับให้ runActual ต่อท้ายข้อความ "เสร็จ" ไม่งั้นโดนเขียนทับหาย
    const warn = [];
    if (missing) warn.push(`หา item ไม่เจอ ${num(missing)} PL (ช่อง item ว่างไว้)`);
    if (mismatch) warn.push(`ยอด item ไม่ตรง unit ${num(mismatch)} PL — ดูคอลัมน์ "ตรวจยอด"`);
    return warn;
  }

  async function runActual() {
    if (S.running) return;
    if (!S.token) { plog('ยังไม่ได้ล็อคอิน', 'em'); return; }

    const from = $('#tFrom').value, to = $('#tTo').value;
    if (!from || !to) { plog('เลือกช่วง Trip Date ก่อน', 'em'); return; }

    S.running = true; S.as = []; S.rows = []; S.page = 1;
    $('#run').disabled = true;
    setExport(false);
    $('#bar').style.width = '15%';
    plog('กำลังดึงรายงาน...');

    try {
      const id = await warehouseId($('#wh').value);
      $('#bar').style.width = '45%';

      const r = await api('/v1/reports/actualshipment', {
        method: 'POST',
        body: JSON.stringify({
          planDeliveryDate: [from + 'T00:00:00.000Z', to + 'T00:00:00.000Z'],
          warehouseId: id
        })
      });

      S.as = (Array.isArray(r) ? r : (r && (r.data || r.items)) || []).map(a => ({
        orderDate: fmtD(a.orderDate), tripNo: a.tripNo || '',
        pickingListNo: a.pickingListNo || '', pickingListTypeName: a.pickingListTypeName || '',
        dealerCode: a.dealerCode || '', dealerName: a.dealerName || '',
        branch: a.branch || '', province: a.province || '', unit: a.unit ?? '',
        licensePlate: a.licensePlate || '', driver: a.driver || '',
        planPickupDate: fmtD(a.planPickupDate), pickupDate: fmtD(a.pickupDate),
        onDeliveryDate: fmtD(a.onDeliveryDate), deliveryDate: fmtD(a.deliveryDate),
        statusDelivery: a.statusDelivery || '', sla: a.sla || '',
        outsource: a.outsource || '', type: a.type || '', area: a.area || '',
        actualCost: a.actualCost ?? '', tripReason: a.tripReason || '',
        pickingListReason: a.pickingListReason || ''
      }));

      const plCount = new Set(S.as.map(x => x.pickingListNo)).size;
      S.asItems = false;
      let warn = [];
      if (S.as.length && $('#asItems').checked) {
        $('#bar').style.width = '55%';
        warn = await attachItems();
      }

      $('#bar').style.width = '100%';
      const trips = new Set(S.as.map(x => x.tripNo)).size;
      plog(S.as.length
        ? `เสร็จ — <b>${num(S.as.length)}</b> แถว · <b>${num(plCount)}</b> PL · <b>${num(trips)}</b> trip`
          + (warn.length ? '<br>' + warn.join('<br>') : '')
        : 'ไม่พบข้อมูลในช่วงที่เลือก');
    } catch (e) {
      plog(e.status === 401 ? 'session หมดอายุ — ออกจากระบบแล้วเข้าใหม่'
                            : 'error: ' + e.message, 'em');
    }

    S.running = false;
    $('#run').disabled = false;
    setExport(S.as.length > 0);
    render(); renderStats();
  }

  async function runPL() {
    if (S.running) return;
    if (!S.token) { plog('ยังไม่ได้ล็อคอิน', 'em'); return; }

    const wh = $('#wh').value;
    const ps = Math.max(10, +$('#oPs').value || 500);
    const mx = +$('#oMx').value || 0;

    const base = { orderBy: ['planDeliveryDate Descending'], pageSize: ps, keyword: null };
    const kw = $('#fKw').value.trim(); if (kw) base.keyword = kw;
    const st = $('#fSt').value; if (st) base.status = st;
    const ar = $('#fAr').value; if (ar) base.area = ar;

    // ช่วงวันที่ "ไม่" ส่งไป API — ทดสอบแล้วว่า API ไม่มี field รับช่วงวันที่
    // จึงกรองฝั่ง client แทน แม่นยำแน่นอน (status/area กรองซ้ำอีกชั้นกันพลาด)
    const fr = $('#fFr').value, to = $('#fTo').value;
    const keep = h => {
      if (st && h.status !== st) return false;
      if (ar && h.area !== ar) return false;
      if (!fr && !to) return true;
      const d = (h.planDeliveryDate || '').slice(0, 10);
      if (!d) return false;                 // ไม่มีวันที่ = ไม่เข้าช่วงที่เลือก
      if (fr && d < fr) return false;
      if (to && d > to) return false;
      return true;
    };

    S.rows = []; S.abort = false; S.page = 1; S.running = true;
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
        if (fr && oldest !== '9999-99-99' && oldest < fr) { stoppedEarly = true; }

        const pct = total ? Math.min(100, Math.round(scanned / total * 100)) : Math.min(95, page * 5);
        $('#bar').style.width = pct + '%';
        plog(`หน้า ${page} · สแกน <b>${num(scanned)}</b>${total ? '/' + num(total) : ''}`
           + ` · เข้าเงื่อนไข <b>${num(kept)}</b> PL · แถว <b>${num(S.rows.length)}</b>`);

        render(); renderStats();
        if (stoppedEarly) break;
        if (data.length < ps) break;
        if (mx && page >= mx) break;
      }
      $('#bar').style.width = '100%';
      plog(`${S.abort ? 'หยุดแล้ว' : 'เสร็จ'} — สแกน <b>${num(scanned)}</b>`
         + ` · เข้าเงื่อนไข <b>${num(kept)}</b> PL · แถว <b>${num(S.rows.length)}</b>`
         + (stoppedEarly ? '\nหยุดเร็วเพราะเจอข้อมูลเก่ากว่าช่วงที่เลือกแล้ว' : ''));
    } catch (e) {
      plog(e.status === 401 ? 'session หมดอายุ — ออกจากระบบแล้วเข้าใหม่' : 'error: ' + e.message, 'em');
    }

    S.running = false;
    $('#run').disabled = false;
    $('#stop').classList.add('hide');
    setExport(S.rows.length > 0);
    render(); renderStats();
  }

  $('#stop').onclick = () => { S.abort = true; plog('กำลังหยุด...'); };

  /* ---------------- views ---------------- */
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

  /* ค่าที่ไม่ได้อยู่ระดับแถว เขียนครั้งเดียวแล้วเว้นว่างที่เหลือ
       unit       — ระดับ PL
       actualCost — ระดับ trip
     ทำที่เดียวหลังเรียง/กรอง ทุกทางออก (ตาราง CSV Excel JSON) จึงตรงกัน
     ถ้าปล่อยให้ซ้ำ ลาก sum ใน Excel ยอดจะบวมตามจำนวน item/PL */
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

  // รวมยอดต่อ trip — unit บวกกัน ส่วน actualCost เป็นค่าของทั้ง trip ไม่ใช่ของแต่ละแถว
  // จึงหยิบค่าแรกที่เจอ ไม่บวกซ้ำ (ตรงกับวิธีของ TMS)
  function tripTotals(data) {
    const m = new Map();
    for (const r of data) {
      let o = m.get(r.tripNo);
      if (!o) { o = { unit: 0, cost: Number(r.actualCost) || 0 }; m.set(r.tripNo, o); }
      o.unit += Number(r.unit) || 0;
    }
    return m;
  }

  function aggPL() {
    const m = new Map();
    for (const r of S.rows) {
      let o = m.get(r.pickingListNo);
      if (!o) { o = Object.assign({}, r, { itemCount: 0, itemQty: 0, items: [] }); m.set(r.pickingListNo, o); }
      if (r.itemNo) { o.itemCount++; o.itemQty += Number(r.itemQty) || 0; o.items.push(r.itemNo); }
    }
    return [...m.values()].map(o => Object.assign(o, { items: Array.isArray(o.items) ? o.items.join(', ') : o.items }));
  }

  function aggItem() {
    const m = new Map(); let grand = 0;
    for (const r of S.rows) {
      if (!r.itemNo) continue;
      let o = m.get(r.itemNo);
      if (!o) { o = { itemNo: r.itemNo, itemName: r.itemName, itemQty: 0, pls: new Set() }; m.set(r.itemNo, o); }
      const q = Number(r.itemQty) || 0;
      o.itemQty += q; grand += q; o.pls.add(r.pickingListNo);
    }
    return [...m.values()].map(o => ({
      itemNo: o.itemNo, itemName: o.itemName, itemQty: o.itemQty,
      plCount: o.pls.size, share: grand ? +(o.itemQty / grand * 100).toFixed(2) : 0
    })).sort((a, b) => b.itemQty - a.itemQty);
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
        const x = a[k], y = b[k], nx = Number(x), ny = Number(y);
        if (x !== '' && y !== '' && !isNaN(nx) && !isNaN(ny)) return (nx - ny) * dir;
        return String(x).localeCompare(String(y), 'th') * dir;
      });
    }
    return d;
  }

  function render() {
    const cols = colsFor(S.view), data = currentData(), pane = $('#pane');
    if (!data.length) {
      pane.innerHTML = (S.view === 'as' ? S.as.length : S.rows.length)
        ? '<div class="empty"><div>ไม่พบรายการที่ตรงกับคำค้น</div></div>'
        : '<div class="empty"><div>ยังไม่มีข้อมูล<br>ตั้งค่าตัวกรองทางซ้ายแล้วกด <b>ดึงข้อมูล</b></div></div>';
      $('#cnt').textContent = '—'; $('#pg').textContent = '–';
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
          h += `<td class="${String(v || '').startsWith('ไม่ตรง') ? 'warn' : ''}" title="${esc(v)}">${esc(v)}</td>`;
          continue;
        }
        if (k === 'status' || k === 'tripStatus') v = v ? `<span class="pill p-${esc(v)}">${esc(v)}</span>` : '';
        else if (k === 'share') {
          const w = maxQty ? Math.round(r.itemQty / maxQty * 60) : 0;
          v = `<span class="barm" style="width:${w}px"></span> ${v}%`;
        } else if (isNum) v = num(v);
        else v = esc(v);
        h += `<td class="${isNum ? 'num' : ''}" title="${esc(r[k])}">${v}</td>`;
      }
      h += '</tr>';
    }
    pane.innerHTML = h + '</tbody></table>';

    pane.querySelectorAll('th').forEach(th => {
      th.onclick = () => {
        const k = th.dataset.k;
        S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 };
        render();
      };
    });

    $('#cnt').textContent = num(data.length) + ' แถว';
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
      // นับสถานะที่ระดับ PL — แตกแถวตาม item แล้วนับแถวจะบวมตามจำนวน item
      const byPL = new Map();
      for (const r of d) if (!byPL.has(r.pickingListNo)) byPL.set(r.pickingListNo, r);
      const pls = [...byPL.values()];

      $('#stats').innerHTML = [
        ['Trip', num(trips)], ['Picking List', num(pls.length)],
        [S.asItems ? 'แถว (PL × Item)' : 'แถว', num(d.length)],
        ['Unit รวม', num(units)], ['Actual Cost รวม', num(cost)],
        ['Completed', num(pls.filter(r => r.statusDelivery === 'Completed').length)],
        ['OnTime / Late', `${num(pls.filter(r => r.sla === 'OnTime').length)} / ${num(pls.filter(r => r.sla === 'Late').length)}`]
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
      ['Picking List', num(pls)], ['แถว (PL × Item)', num(rows.length)],
      ['Item ไม่ซ้ำ', num(items)], ['Qty รวม', num(qty)],
      ['ลูกค้า', num(cust)], ['PL ไม่มี item', num(noItem)]
    ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  }

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

    S.view = m === 'as' ? 'as' : 'rows';
    S.page = 1; S.q = ''; S.sort = { key: null, dir: 1 };
    $('#q').value = '';
    $$('.tabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === S.view));

    setExport(m === 'as' ? S.as.length > 0 : S.rows.length > 0);
    render(); renderStats();
  }
  $$('#modes .mode').forEach(b => {
    b.onclick = () => { if (isRail()) setRail(false); setMode(b.dataset.m); };
  });

  /* ---------------- Trip Date (Actual Shipment) ----------------
     ค่าเริ่มต้น = เมื่อวาน เพราะข้อมูลของวันปัจจุบันยังไม่ actual
     รอบข้อมูลปิดและส่งหลังเที่ยงคืน — หน้า TMS ก็ตั้งค่าเริ่มต้นแบบเดียวกัน   */
  function tripPreset(kind) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    let from = iso(y);
    if (kind === 'y7' || kind === 'y30') {
      const d = new Date(y); d.setDate(d.getDate() - (kind === 'y7' ? 6 : 29));
      from = iso(d);
    }
    if (kind !== 'custom') { $('#tFrom').value = from; $('#tTo').value = iso(y); }
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

  /* ---------------- controls ---------------- */
  $$('.tabs button[data-tab]').forEach(b => {
    b.onclick = () => {
      $$('.tabs button[data-tab]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      S.view = b.dataset.tab; S.page = 1; S.sort = { key: null, dir: 1 };
      render();
    };
  });

  let qt;
  $('#q').oninput = e => {
    clearTimeout(qt);
    const v = e.target.value.trim();
    qt = setTimeout(() => { S.q = v; S.page = 1; render(); }, 200);
  };
  $('#prev').onclick = () => { S.page--; render(); };
  $('#next').onclick = () => { S.page++; render(); };
  $('#pp').onchange = e => { S.perPage = +e.target.value; S.page = 1; render(); };

  /* ---------------- export ---------------- */
  const setExport = on => ['#exCsv', '#exXls', '#exJson'].forEach(s => { $(s).disabled = !on; });

  function download(content, name, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  const exportRows = () => ({ data: currentData(), cols: colsFor(S.view) });

  $('#exCsv').onclick = () => {
    const { data, cols } = exportRows();
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = '﻿' + [cols.map(c => q(c[1])).join(',')]
      .concat(data.map(r => cols.map(c => q(r[c[0]])).join(','))).join('\r\n');
    download(csv, `tms-${S.view}-${stamp()}.csv`, 'text/csv;charset=utf-8;');
  };

  $('#exJson').onclick = () => {
    download(JSON.stringify(exportRows().data, null, 2), `tms-${S.view}-${stamp()}.json`, 'application/json');
  };

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // .xlsx จริง — ไม่ใช่ SpreadsheetML เปลี่ยนนามสกุล Excel จึงไม่เตือนเรื่องฟอร์แมต
  $('#exXls').onclick = () => {
    const { data, cols } = exportRows();
    const val = v => {
      const n = Number(v);
      return (v !== '' && v != null && String(v).trim() !== '' && !isNaN(n)) ? n : (v ?? '');
    };
    const last = colName(cols.length);

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

      const f = ($('#tFrom').value || '').replace(/-/g, ''), t = ($('#tTo').value || '').replace(/-/g, '');
      downloadBlob(buildXlsx({
        sheet: 'ActualShipment', rows,
        cols: cols.map(c => ({ w: (c[0] === 'dealerName' || c[0] === 'branch') ? 34 : 16 })),
        autoFilter: `A1:${last}1`
      }), `ActualShipment_${f}_${t}.xlsx`);
      return;
    }

    downloadBlob(buildXlsx({
      sheet: S.view === 'rows' ? 'Rows' : S.view === 'pl' ? 'ByPL' : 'ByItem',
      rows: [cols.map(c => ({ v: c[1], s: 'head' }))]
        .concat(data.map(r => cols.map(c => ({ v: val(r[c[0]]) })))),
      cols: cols.map(c => ({ w: (c[0] === 'itemName' || c[0] === 'items') ? 34 : 16 })),
      autoFilter: `A1:${last}1`
    }), `tms-${S.view}-${stamp()}.xlsx`);
  };

  /* ---------------- go ---------------- */
  renderStats();
  render();
  setTimeout(() => $('#u').focus(), 60);

  // เผื่อ debug: window.__tmsx.rows
  window.__tmsx = S;
})();
