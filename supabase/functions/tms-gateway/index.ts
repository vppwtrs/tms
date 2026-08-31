/**
 * tms-gateway — ประตูเดียวระหว่างเว็บของเรากับ TMS บริษัท
 *
 * ทำสองอย่าง:
 *   POST /tms-gateway/auth   ยืนยันตัวกับ TMS แล้วออก session ของ Supabase ให้
 *   POST /tms-gateway/call   ส่งต่อคำขออ่านข้อมูลไปยัง TMS (แก้ CORS)
 *   POST /tms-gateway/disconnect  ลบการเชื่อมต่อ TMS ของคนที่ล็อกอินอยู่ (ตอนล็อกเอาต์)
 *
 * ทำไมต้องมีตัวนี้:
 * เบราว์เซอร์ยิงหา TMS จากโดเมนอื่นไม่ได้ (CORS) เดิมแก้ด้วย server.js
 * บนเครื่องออฟฟิศ ซึ่งบังคับให้ตัวดึงเป็นโปรแกรมแยกตลอดกาล ย้ายตัวกลางมาไว้ตรงนี้
 * แอปจึงเหลือตัวเดียว เปิดจากที่ไหนก็ได้
 *
 * ===== ข้อจำกัดที่ตั้งใจใส่ ห้ามถอด =====
 *
 * 1. อ่านอย่างเดียว — OPS คือรายการงานที่ยิงได้ทั้งหมด ไม่มีตัวไหน
 *    ที่เขียนกลับเข้า TMS บริษัท ข้อตกลงกับบริษัทคือ "ไม่แก้ข้อมูลภายใน"
 *    เติมงานใหม่ได้ แต่ต้องเป็น search/report/profile เท่านั้น
 *
 * 2. ไม่เก็บ ไม่ log รหัสผ่าน — รหัสถูกใช้แลก token ครั้งเดียวแล้วหลุดจากหน่วยความจำ
 *    ห้ามใส่ console.log(body) เด็ดขาด log ของ Edge Function เก็บไว้อ่านย้อนหลังได้
 *
 * 3. ยิงได้ที่เดียวคือ TMS_BASE_URL — ไม่รับ URL จาก client
 *    ถ้ารับ ตัวนี้จะกลายเป็น open proxy ให้คนทั้งอินเทอร์เน็ตยิงอะไรก็ได้ผ่านเรา
 *
 * 4. ไม่มี "รหัสผ่าน" ของบริษัทเก็บไว้เลยสักตัว ต่างจากแผนเดิม (tms-sync)
 *    ที่ต้องเก็บ service account ไว้ใน secret — คนที่ยึด secret ไปได้ ก็ยังล็อกอิน TMS ไม่ได้
 *
 *    ข้อนี้เคยเขียนว่า "ไม่มีรหัสของบริษัทเก็บไว้เลย" แล้วแก้ถ้อยคำวันที่ 27 ส.ค. 69
 *    ตอนย้าย token ไปเก็บใน public.tms_sessions (ดูข้อ 7) — เหตุผลเต็มอยู่ในไฟล์
 *    migration 20260827020000 สรุปสั้น ๆ คือ token อายุสั้นรายคนไม่ใช่บัญชีกลาง
 *
 * 5. เส้น call ต้องมีตัวตนฝั่งเราที่ยังใช้งานอยู่ (27 ส.ค. 69)
 *    เดิมเช็คแค่ "มี token ของ TMS" ผลคือคนที่ admin กดปิดบัญชีไปแล้ว หรือบัญชีใหม่
 *    ที่ยังไม่ถูกอนุมัติ ยังดูดข้อมูลคลัง/เที่ยว/ใบสั่งของบริษัทได้ต่อจนกว่า token
 *    จะหมดอายุไปเอง ทั้งที่คอมเมนต์ในไฟล์นี้เองเขียนว่าบัญชีใหม่ "ยังไม่มีสิทธิ์อะไร"
 *
 * 6. client ไม่รู้จัก path ของ TMS (27 ส.ค. 69)
 *    เดิม client ส่ง path มาเอง แปลว่า '/v1/tripheaders/{guid}/search' และเพื่อน ๆ
 *    ถูกคอมไพล์ติดไปใน bundle ที่ใครเปิด devtools ก็อ่านได้ว่า API ภายในบริษัท
 *    หน้าตายังไง ตอนนี้ client ส่งแค่ชื่องาน (op) ตัวแปลงอยู่ที่นี่ที่เดียว
 *    ผลพลอยได้: pageSize ย้ายมาฝั่งนี้ client จึงขอเกินโควตาไม่ได้อีก
 *
 * 7. token ของ TMS ไม่เคยเดินทางถึงเบราว์เซอร์ (27 ส.ค. 69)
 *    เดิม /auth คืน token ลงไปให้หน้าเว็บเก็บใน sessionStorage — XSS จุดเดียวในเว็บเรา
 *    เท่ากับ token ที่อ่านข้อมูลภายในบริษัทได้หลุดออกไป ความเสียหายไม่จบที่ระบบเรา
 *    ตอนนี้เก็บใน public.tms_sessions ผูกกับ auth_id เส้น call หยิบเองจากคนที่
 *    ยืนยันตัวแล้ว หน้าเว็บได้รู้แค่ "เชื่อมอยู่ เหลืออีกกี่วินาที"
 *
 * 8. token ในฐานถูกเข้ารหัสไว้ คีย์ไม่ได้อยู่ในฐาน (27 ส.ค. 69)
 *    คีย์คือ secret TMS_TOKEN_KEY ของฟังก์ชันนี้ ผลคือใครที่อ่านตาราง tms_sessions
 *    ได้ — ฐานรั่ว, backup หลุด, คนที่มี service_role — ได้ไปแต่ข้อความที่ถอดไม่ออก
 *    ต้องไปหยิบคีย์จากอีกระบบหนึ่งมาประกอบด้วยถึงจะใช้ได้
 *
 *    กันเจ้าของโครงสร้างเองไม่ได้ 100% เพราะ secret ก็ฝากไว้กับเขาอีกที
 *    แต่ยกระดับจาก "query ตารางเดียวจบ" เป็น "ต้องตั้งใจประกอบจากสองระบบ"
 *
 *    ไม่ตั้ง TMS_TOKEN_KEY = ฟังก์ชันไม่ยอมเริ่มทำงาน ตั้งใจให้พังดังกว่าเก็บ
 *    token เปล่า ๆ ต่อไปเงียบ ๆ โดยไม่มีใครรู้ว่าเกราะหลุดไปตั้งแต่เมื่อไหร่
 *
 * secret ที่ต้องตั้ง: TMS_BASE_URL  (เช่น https://host.example/tms-api/api)
 *                     TMS_TOKEN_KEY สุ่ม 32 ไบต์ base64 — ไม่มีมนุษย์ต้องจำค่านี้
 *                     WEB_ORIGINS   โดเมนเว็บเราคั่นด้วย comma (ไม่ตั้ง = ใช้ค่าเริ่มต้นล่าง)
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ระบบใส่ให้เองอยู่แล้ว
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const TMS_BASE = Deno.env.get('TMS_BASE_URL') ?? ''

/* tenant ตรึงไว้ ไม่รับจาก client — เดิมรับมาแล้วยัดใส่ header ตรง ๆ
   ซึ่งเปิดให้คนนอกไล่ยิงหา tenant อื่นของบริษัทผ่านเรา */
const TENANT = Deno.env.get('TMS_TENANT') ?? 'root'

/* ---------- CORS: เฉพาะโดเมนของเรา ----------
   เดิมเป็น '*' ซึ่งแปลว่าเว็บอะไรก็ได้ที่พนักงานเปิดค้างไว้ ยิงเส้น auth ของเรา
   จากเบราว์เซอร์ของเขาเองได้เงียบ ๆ */
const ORIGINS = (Deno.env.get('WEB_ORIGINS') ?? 'https://vppwtrs.github.io')
  .split(',').map(o => o.trim()).filter(Boolean)

/* แอปเนทีฟ (Capacitor) ไม่มีโดเมนจริง ส่ง origin เป็น capacitor:// มา
   ส่วน localhost คือตอน dev */
const originOk = (o: string): boolean =>
  ORIGINS.includes(o) ||
  /^https?:\/\/localhost(:\d+)?$/.test(o) ||
  /^(capacitor|ionic):\/\//.test(o)

const corsFor = (req: Request): Record<string, string> => {
  const o = req.headers.get('origin') ?? ''
  /* ไม่ใช่โดเมนเรา = ไม่ใส่ header ให้เลย เบราว์เซอร์บล็อกเอง
     ไม่ตอบ 403 เพราะคำขอจาก curl ไม่มี origin และไม่ควรถูกกันด้วยเหตุนี้ —
     ตัวกันจริงคือการยืนยันตัวตนข้างล่าง CORS แค่กันเว็บอื่นเรียกแทนผู้ใช้ */
  return {
    ...(originOk(o) ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    /* ให้เบราว์เซอร์จำผลตรวจสิทธิ์ข้ามโดเมนไว้หนึ่งวัน
       ไม่มีบรรทัดนี้ = ทุก POST ต้องยิง OPTIONS นำหน้าเสมอ ซึ่งวัดได้จาก log จริงว่า
       160-190ms ต่อครั้ง หน้าที่ยิง 8 คำขอจึงเสียเวลาไปกับการถามซ้ำเรื่องเดิม ~1.5 วินาที
       ค่านี้ไม่ผ่อนความปลอดภัย — allowlist ของ origin ยังตรวจทุกคำขอเหมือนเดิม
       ที่ถูกจำคือ "โดเมนนี้ยิงได้" ไม่ใช่ "คนนี้เป็นใคร" */
    'Access-Control-Max-Age': '86400',
  }
}

/* ---------- รายการงานที่ยิงได้ ----------
   client ส่งชื่อ op กับพารามิเตอร์เท่าที่จำเป็น ตัวสร้าง path กับ body อยู่ที่นี่
   จำนวนต่อหน้าอยู่ที่นี่ด้วย — เดิม client ส่ง pageSize มาเอง ใส่เลขเท่าไหร่ก็ได้ */
interface Op { path: string; method: 'GET' | 'POST'; body?: unknown }

const pageNo = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 1 && n <= 200 ? Math.floor(n) : 1
}

/* กัน path traversal: รหัสคลังกับ GUID มาจาก TMS ก็จริง แต่เดินผ่าน client มาแล้ว
   จึงต้องถือว่าเป็นของที่คนยิงกำหนดได้ '../' อันเดียวพาไปได้ทั้ง API */
const seg = (v: unknown): string => {
  const s = String(v ?? '')
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) throw new Error('bad segment')
  return encodeURIComponent(s)
}

/** วันที่ล้วน — ค่าที่ไม่ใช่รูปแบบ YYYY-MM-DD ถูกปฏิเสธ ไม่ใช่ตัดให้พอผ่าน
 *  ค่าที่เพี้ยนแล้วยังยิงต่อ = ได้ลิสต์ว่างกลับมาโดยไม่มีใครรู้ว่าเพราะวันที่ผิด */
const dateOnly = (v: unknown): string => {
  const s = String(v ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('bad date')
  return s
}

const OPS: Record<string, (p: Record<string, unknown>) => Op> = {
  /** คลังทั้งหมดที่บัญชีนี้เห็น
   *  ชื่อพารามิเตอร์ต้องเป็น pageNumber/pageSize — เคยส่ง page/keyword ตามที่เดาเอง
   *  แล้วได้ผลว่างแบบไม่มี error ชื่อที่ถูกมาจาก extractor ที่ยิงกับของจริงมาก่อน */
  warehouses: () => ({
    path: '/v1/warehouses/search',
    method: 'POST',
    body: { pageNumber: 1, pageSize: 200 },
  }),

  /** คลังที่ผูกกับตัวบุคคล — หลายบัญชีเป็นค่าว่างทั้งที่เปิดดูได้จริงในหน้า TMS */
  myWarehouses: () => ({ path: '/personal/warehouses', method: 'GET' }),

  /** ใบสั่งของคลังหนึ่ง ทีละหน้า */
  pickingLists: p => ({
    path: `/v1/pickinglistheaders/${seg(p.warehouse)}/search`,
    method: 'POST',
    body: {
      orderBy: ['planDeliveryDate Descending'],
      pageNumber: pageNo(p.page),
      pageSize: 500,
      keyword: null,
    },
  }),

  /** ค้นใบเดียวด้วยเลขใบ — ใช้ตอนต้องการรายการสินค้าของใบที่ไม่อยู่ในช่วงที่ไล่มา
   *
   *  ต่างจาก pickingLists ตรงที่ส่ง keyword ไปด้วย TMS รับเลขที่มีหาง -C-04 ได้ตรง ๆ
   *  (ทดสอบกับของจริงมาแล้วสมัยใช้ actualshipment เป็นแหล่งหลัก)
   *
   *  keyword ยาวจำกัดไว้ 64 ตัว และตัดอักขระที่ไม่ใช่เลขใบทิ้ง — ช่องค้นหาที่ส่ง
   *  อะไรก็ได้เข้าไปในระบบบริษัทคือของที่ไม่ควรเปิดให้ client กำหนดอิสระ
   *  pageSize เล็กเพราะคำตอบที่ต้องการคือใบเดียว ไม่ใช่รายการ */
  pickingListByNo: p => ({
    path: `/v1/pickinglistheaders/${seg(p.warehouse)}/search`,
    method: 'POST',
    body: {
      orderBy: ['planDeliveryDate Descending'],
      pageNumber: 1,
      pageSize: 20,
      keyword: seg(p.no),
    },
  }),

  /** ใบเดียวเต็มใบพร้อมรายการสินค้า — เส้นที่หน้า "Picking List Detail" ของ TMS ใช้
   *  (จับมาจากหน้าจริง 31 ส.ค. 2569: GET /v1/pickinglistheaders/{คลัง}/{guid})
   *
   *  ต้องมีเพราะเส้น search บางใบส่ง header มาโดยไม่มี details ติดมาด้วย
   *  รายการสินค้าของใบพวกนั้นอยู่ที่เส้นนี้เท่านั้น */
  pickingListById: p => ({
    path: `/v1/pickinglistheaders/${seg(p.warehouse)}/${seg(p.id)}`,
    method: 'GET',
  }),

  /** เที่ยวของคลังหนึ่ง — อ้างคลังด้วย GUID ไม่ใช่รหัส ต่างจาก pickingLists ข้างบน */
  trips: p => ({
    path: `/v1/tripheaders/${seg(p.guid)}/search`,
    method: 'POST',
    body: {
      orderBy: ['orderDate Descending'],
      pageNumber: pageNo(p.page),
      pageSize: 200,
      keyword: null,
    },
  }),

  /** ใบของเที่ยวหนึ่งพร้อมรายการสินค้า — เส้น search ส่ง pickingLists มาแบบไม่มี
   *  details จำนวนต่อรุ่นจึงหายทั้งระบบ ต้องถามเส้นนี้ทีละเที่ยวถึงจะได้มา */
  tripPickingList: p => ({
    path: '/v1/tripheaders/pickingList',
    method: 'POST',
    body: { Id: seg(p.id) },
  }),

  /** รายงาน Actual Shipment ของช่วงวัน — เคยใช้เป็นแหล่งข้อมูลหลักแล้วเลิกไป
   *  (ดู tmsPull.ts) แต่ในฐานะ **รายงาน** มันยังเป็นเส้นเดียวที่ TMS ให้ยอดส่งจริง
   *  ต่อบรรทัดมาเป็นก้อนเดียว
   *
   *  อ้างคลังด้วย GUID ไม่ใช่รหัส ส่งรหัสไปได้ลิสต์ว่างแบบไม่มี error
   *  วันส่งเป็น UTC เที่ยงคืนเสมอ ส่ง local time แล้วคนที่ +07 จะได้ข้อมูลเหลื่อมวัน */
  actualShipment: p => ({
    path: '/v1/reports/actualshipment',
    method: 'POST',
    body: {
      planDeliveryDate: [`${dateOnly(p.from)}T00:00:00.000Z`, `${dateOnly(p.to)}T00:00:00.000Z`],
      warehouseId: seg(p.warehouseId),
    },
  }),

  /** รายงาน Plan Simulate — แผนที่ระบบ TMS จำลองไว้ ก่อนที่เที่ยวจริงจะถูกยืนยัน
   *  เส้นทางและ body จับมาจากหน้า TMS จริง (Report > Plan Simulate > Search)
   *  รูปแบบเดียวกับ actualshipment เป๊ะ ทั้งช่วงวันและการอ้างคลังด้วย GUID */
  planSimulate: p => ({
    path: '/v1/reports/plansimulate',
    method: 'POST',
    body: {
      planDeliveryDate: [`${dateOnly(p.from)}T00:00:00.000Z`, `${dateOnly(p.to)}T00:00:00.000Z`],
      warehouseId: seg(p.warehouseId),
    },
  }),
}



/* ---------- งานแบบวนหลายรอบ ----------
 *
 * ทำไมต้องอยู่ฝั่งนี้: หน้าเว็บเคยวนเองแล้วยิงผ่าน /call ทีละหน้า วัดจาก log จริงได้
 * 8 คำขอเรียงต่อกัน ใบละ 600–1300ms รวมหกวินาที เพราะทุกใบเดินทาง
 * เบราว์เซอร์ → โซล → TMS ที่ไทย → กลับ
 *
 * ย้ายลูปมาไว้ตรงนี้ ขาที่ยาวที่สุด (โซล ↔ ไทย) ยังอยู่ แต่วิ่งอยู่ในฝั่งเซิร์ฟเวอร์
 * และเบราว์เซอร์เหลือคำขอเดียว
 *
 * **กฎกรองยังอยู่ฝั่งหน้าเว็บทั้งหมด** ที่นี่ทำแค่ "วนจนกว่าจะพอ" — เกณฑ์ว่าใบไหน
 * เข้าเงื่อนไข คลังไหนเป็นของกองรถเรา ยังตัดสินที่เดิมที่เดียว ไม่ให้กฎธุรกิจ
 * แตกเป็นสองชุดที่ต้องแก้พร้อมกัน
 */

/** เพดานที่ยอมให้ขอได้ต่อหนึ่งคำขอ — กันไม่ให้ใครสั่งให้เรายิงหา TMS รัวไม่จำกัด */
const SCAN_MAX_PAGES = 60
const SCAN_MAX_IDS = 60
/** ไล่ค้นข้ามคลังได้ไม่เกินเท่านี้ต่อหนึ่งเลขใบ — กันไม่ให้รายชื่อคลังยาว ๆ
    กลายเป็นตัวคูณจำนวนคำขอที่ยิงไปหา TMS */
const SCAN_MAX_WAREHOUSES = 4
/** ยิงพร้อมกันได้เท่านี้ตอนถามรายละเอียดทีละเที่ยว — มากกว่านี้คือกดดัน TMS
    โดยไม่ได้อะไรเพิ่ม เพราะคอขวดคือฝั่งเขา ไม่ใช่ฝั่งเรา */
const SCAN_CONCURRENCY = 4

/** วันของค่าอะไรก็ตามที่ TMS ส่งมา — ตรงกับ day() ใน web/src/api/tmsPull.ts */
const dayOf = (v: unknown): string => String(v ?? '').slice(0, 10)

interface ScanResult {
  items: unknown[]
  pages: number
  /** อ่านครบทั้งช่วงที่ขอแล้ว (ไม่ได้หยุดเพราะชนเพดานหน้า) */
  complete: boolean
}

/** วนอ่านทีละหน้าจนเจอของที่เก่ากว่าช่วงที่ขอ หรือหน้าไม่เต็ม
 *  เรียงจากใหม่ไปเก่าเสมอ — หน้าที่เก่ากว่าวันเริ่มต้นแล้ว ที่เหลือก็เก่ากว่าทั้งหมด */
async function scanPages(
  token: string,
  build: (page: number) => Op,
  opts: { from: string; dateField: string; pageSize: number; maxPages: number },
): Promise<ScanResult> {
  const items: unknown[] = []
  let complete = false
  let page = 1

  for (; page <= opts.maxPages; page++) {
    const spec = build(page)
    const r = await fetch(TMS_BASE + spec.path, {
      method: spec.method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: spec.method === 'GET' ? undefined : JSON.stringify(spec.body ?? {}),
    })
    /* หน้าไหนพัง หยุดตรงนั้นแล้วคืนของที่ได้มาแล้ว พร้อมบอกว่ายังไม่ครบ
       ดีกว่าโยนทิ้งทั้งรอบเพราะหน้าที่เจ็ดตอบไม่ดี */
    if (!r.ok) return { items, pages: page - 1, complete: false }

    const body = await r.json().catch(() => null)
    const batch: unknown[] = Array.isArray(body) ? body
      : Array.isArray(body?.data) ? body.data
      : Array.isArray(body?.items) ? body.items
      : []

    items.push(...batch)

    let oldest = '9999-99-99'
    for (const row of batch) {
      const d = dayOf((row as Record<string, unknown>)?.[opts.dateField])
      if (d && d < oldest) oldest = d
    }

    if (oldest !== '9999-99-99' && oldest < opts.from) { complete = true; break }
    if (batch.length < opts.pageSize) { complete = true; break }
  }

  return { items, pages: Math.min(page, opts.maxPages), complete }
}

const SCANS: Record<
  string,
  (p: Record<string, unknown>, token: string) => Promise<unknown>
> = {
  /** ใบสั่งของคลังหนึ่ง ทุกหน้าที่ต้องอ่าน ในคำขอเดียว */
  scanPickingLists: (p, token) => scanPages(
    token,
    page => OPS.pickingLists({ warehouse: p.warehouse, page }),
    {
      from: String(p.from ?? ''),
      dateField: 'planDeliveryDate',
      pageSize: 500,
      maxPages: Math.min(Number(p.maxPages) || SCAN_MAX_PAGES, SCAN_MAX_PAGES),
    },
  ),

  /** เที่ยวของคลังหนึ่ง ทุกหน้าที่ต้องอ่าน ในคำขอเดียว */
  scanTrips: (p, token) => scanPages(
    token,
    page => OPS.trips({ guid: p.guid, page }),
    {
      from: String(p.from ?? ''),
      dateField: 'orderDate',
      pageSize: 200,
      maxPages: Math.min(Number(p.maxPages) || 2, SCAN_MAX_PAGES),
    },
  ),

  /** ใบพร้อมรายการสินค้าของหลายเที่ยวพร้อมกัน
   *  เที่ยวเดียวที่ถามไม่ผ่านต้องไม่ทำให้ทั้งรอบล้ม — คืน items ว่างของเที่ยวนั้นแทน */
  scanTripPickingLists: async (p, token) => {
    const ids = Array.isArray(p.ids) ? p.ids.slice(0, SCAN_MAX_IDS).map(String) : []
    const out: Array<{ id: string; items: unknown[] }> = []

    for (let i = 0; i < ids.length; i += SCAN_CONCURRENCY) {
      const chunk = ids.slice(i, i + SCAN_CONCURRENCY)
      const done = await Promise.all(chunk.map(async (id) => {
        try {
          const spec = OPS.tripPickingList({ id })
          const r = await fetch(TMS_BASE + spec.path, {
            method: spec.method,
            headers: {
              authorization: `Bearer ${token}`,
              accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(spec.body ?? {}),
          })
          if (!r.ok) return { id, items: [] as unknown[] }
          const body = await r.json().catch(() => null)
          const items: unknown[] = Array.isArray(body) ? body
            : Array.isArray(body?.data) ? body.data
            : Array.isArray(body?.items) ? body.items
            : []
          return { id, items }
        } catch {
          return { id, items: [] as unknown[] }
        }
      }))
      out.push(...done)
    }

    return { lists: out }
  },

  /** ค้นใบทีละเลข หลายเลขในคำขอเดียว — ใช้เติมรายการสินค้าของใบที่ไล่ตามช่วงวันไม่เจอ
   *
   *  ทำไมต้องวนฝั่งนี้: หน้ารายงานหนึ่งรอบมีใบที่หาไม่เจอเป็นสิบถึงร้อยใบ ถ้าปล่อยให้
   *  เบราว์เซอร์ยิงทีละใบ ทุกใบต้องเดินทาง เบราว์เซอร์ → โซล → ไทย → กลับ ครบรอบ
   *  เหตุผลเดียวกับ scanTripPickingLists ข้างบน
   *
   *  เพดานและการยิงทีละ 4 คู่ขนานเหมือนกัน — นี่คือ TMS ที่คนทั้งบริษัทใช้อยู่
   *  ใบที่ค้นไม่ผ่านคืนลิสต์ว่างของใบนั้น ไม่ล้มทั้งรอบ */
  scanPickingListsByNo: async (p, token) => {
    /* คลังที่จะไล่ค้น: คลังที่เลือกก่อน แล้วค่อยคลังอื่นที่บัญชีนี้เห็น
       ใบที่ปรากฏในรายงานของคลังหนึ่ง ไม่ได้แปลว่าทะเบียนใบอยู่ที่คลังนั้น
       ค้นแค่คลังเดียวจึงได้ "ไม่เจอ" ทั้งที่ใบมีอยู่จริงอีกคลัง */
    const whs = [
      ...new Set(
        [String(p.warehouse ?? ''), ...(Array.isArray(p.warehouses) ? p.warehouses.map(String) : [])]
          .map(w => w.trim())
          .filter(Boolean),
      ),
    ].slice(0, SCAN_MAX_WAREHOUSES)
    const nos = Array.isArray(p.nos) ? p.nos.slice(0, SCAN_MAX_IDS).map(String) : []
    /* found = จำนวนใบที่ตรงกับเลขที่ถาม · 0 แปลว่า "ไม่มีใบนี้ในระบบ" ซึ่งต่างจาก
       "มีใบแต่ไม่มีรายการสินค้า" — หน้าจอต้องเขียนสองอย่างนี้ต่างกัน
       via บอกว่าเจอที่คลังไหนด้วยคีย์เวิร์ดอะไร ไว้ไล่ตอนตัวเลขไม่ตรงกับที่คาด */
    const out: Array<{ no: string; found: number; items: unknown[]; via?: string }> = []

    /** เลขใบแบบตัดหางท้าย (-C-04) — ทะเบียนใบบางใบเก็บเลขต้นทางไว้ ไม่ได้เก็บเลขที่ถูกแบ่งแล้ว */
    const baseNo = (no: string): string => no.replace(/-[A-Za-z]+-\d+$/, '')

    /** header ใบนี้คือใบที่ถามหรือเปล่า — เส้น search เป็นการค้นแบบ "มีคำนี้อยู่"
        ไม่ใช่ค้นตรงตัว คำตอบจึงมีใบอื่นปนมาได้ ถ้าไม่กรองคือเอาสินค้าใบอื่นมาแปะ */
    const isSame = (h: Record<string, unknown>, no: string): boolean => {
      const v = String(h.pickingListNo ?? h.no ?? h.documentNo ?? '').trim()
      return v !== '' && (v === no || baseNo(v) === baseNo(no))
    }

    const search = async (wh: string, keyword: string): Promise<Record<string, unknown>[]> => {
      const spec = OPS.pickingListByNo({ warehouse: wh, no: keyword })
      const r = await fetch(TMS_BASE + spec.path, {
        method: spec.method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(spec.body ?? {}),
      })
      if (!r.ok) return []
      const body = await r.json().catch(() => null)
      const rows: unknown[] = Array.isArray(body) ? body
        : Array.isArray(body?.data) ? body.data
        : Array.isArray(body?.items) ? body.items
        : []
      return rows.map(x => (x ?? {}) as Record<string, unknown>)
    }

    /* เส้น search บางใบส่ง header มาโดยไม่มี details ติดมา รายการสินค้าของใบ
       พวกนั้นอยู่ที่เส้นรายใบ (เส้นเดียวกับหน้า Picking List Detail ของ TMS)
       ถามต่อเฉพาะใบที่ยังไม่มีรายการ ไม่ใช่ถามทุกใบ — ใบที่ search ส่งครบมาแล้ว
       การถามซ้ำคือคำขอที่ไม่ได้อะไรเพิ่ม */
    const withDetails = async (wh: string, heads: Record<string, unknown>[]): Promise<unknown[]> => {
      const items: unknown[] = []
      for (const head of heads) {
        const det = head.details
        if (Array.isArray(det) && det.length) { items.push(head); continue }

        const id = head.id ?? head.pickingListHeaderId
        if (!id) { items.push(head); continue }
        try {
          const one = OPS.pickingListById({ warehouse: wh, id })
          const rr = await fetch(TMS_BASE + one.path, {
            method: one.method,
            headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          })
          if (!rr.ok) { items.push(head); continue }
          const full = await rr.json().catch(() => null)
          items.push(full ?? head)
        } catch {
          items.push(head)
        }
      }
      return items
    }

    for (let i = 0; i < nos.length; i += SCAN_CONCURRENCY) {
      const chunk = nos.slice(i, i + SCAN_CONCURRENCY)
      const done = await Promise.all(chunk.map(async (no) => {
        /* ไล่คีย์เวิร์ดจากตรงตัวไปหาหลวม และคลังที่เลือกไปหาคลังอื่น
           หยุดทันทีที่เจอ — ทางที่เหลือเป็นคำขอที่ไม่ได้อะไรเพิ่ม */
        const keys = [...new Set([no.trim(), baseNo(no.trim())].filter(Boolean))]
        try {
          for (const wh of whs) {
            for (const key of keys) {
              const hits = (await search(wh, key)).filter(h => isSame(h, no))
              if (!hits.length) continue
              return { no, found: hits.length, items: await withDetails(wh, hits), via: `${wh}/${key}` }
            }
          }
          return { no, found: 0, items: [] as unknown[] }
        } catch {
          return { no, found: 0, items: [] as unknown[] }
        }
      }))
      out.push(...done)
    }

    return { lists: out }
  },
}

const admin = () =>
  createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

/* อีเมลปลอมที่ผูกกับ username ของ TMS — Supabase Auth บังคับให้มีอีเมล
   ใช้โดเมน .invalid ตาม RFC 2606 เพื่อให้ชัดว่าส่งเมลไปไม่ถึงแน่นอน
   ไม่ใช้อีเมลจริงจาก TMS เพราะถ้าวันหนึ่งเขาเปลี่ยนอีเมลพนักงาน บัญชีเราจะหลุดจากกัน

   แปลงอักขระนอกชุดเป็นรหัสฐานสิบหก ไม่ใช่ยุบเป็นขีดล่างรวด — เดิม 'a-b' กับ 'a_b'
   ได้อีเมลเดียวกัน สองคนจึงใช้บัญชีฝั่งเราร่วมกันโดยไม่มีใครรู้ */
const authEmail = (username: string) =>
  `${username.toLowerCase().replace(/[^a-z0-9._-]/g, c => `-${c.charCodeAt(0).toString(16)}-`)}@tms.invalid`

/* รหัสผ่านฝั่ง Supabase ไม่มีใครต้องรู้ รวมทั้งเจ้าตัว — ตั้งใหม่ทุกครั้งที่ล็อกอิน
   แล้วใช้ทันทีในฟังก์ชันนี้ ไม่เคยถูกส่งออกไปไหน
   ผลคือใครขโมยฐาน auth ไปก็ crack ไม่ได้ประโยชน์ เพราะรหัสเปลี่ยนทุกครั้งอยู่แล้ว */
const throwaway = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')

/* ---------- เข้ารหัส token ก่อนลงฐาน ----------
   AES-GCM 256 บิต IV สุ่มใหม่ทุกครั้ง เก็บเป็น "iv.ciphertext" ฐาน base64 ทั้งคู่
   GCM ให้ทั้งความลับและตัวตรวจว่าถูกแก้ไข — ถอดไม่ผ่านคือถอดไม่ผ่าน ไม่มีการ
   คืนขยะที่หน้าตาเหมือนของจริงออกมา

   คีย์มาจาก secret ไม่ได้อยู่ในฐาน ดูเหตุผลข้อ 8 ที่หัวไฟล์ */
const RAW_KEY = Deno.env.get('TMS_TOKEN_KEY') ?? ''

/* อ่านคีย์ครั้งเดียวตอนเรียกใช้ครั้งแรก แล้วเก็บไว้ — ไม่ทำตอนโหลดไฟล์
   เพราะ importKey เป็น async และเราอยากให้ error โผล่ตอนมีคนใช้จริง ไม่ใช่ตอน deploy */
let keyPromise: Promise<CryptoKey> | null = null
const cryptoKey = (): Promise<CryptoKey> => {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(RAW_KEY), c => c.charCodeAt(0)),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    )
  }
  return keyPromise
}

const b64 = (b: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(b)))

async function sealToken(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const out = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await cryptoKey(),
    new TextEncoder().encode(plain),
  )
  return `${b64(iv)}.${b64(out)}`
}

/** คืน null เมื่อถอดไม่ออก — ตัวเรียกต้องถือว่า "ไม่มี session" แล้วให้ล็อกอินใหม่
 *  เกิดได้จริงตอนเปลี่ยนคีย์ ซึ่งต้องไม่ทำให้ระบบล่ม แค่ทุกคนเข้าใหม่หนึ่งครั้ง */
async function openToken(sealed: string): Promise<string | null> {
  const [ivPart, dataPart] = sealed.split('.')
  if (!ivPart || !dataPart) return null
  try {
    const bytes = (v: string) => Uint8Array.from(atob(v), c => c.charCodeAt(0))
    const out = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(ivPart) },
      await cryptoKey(),
      bytes(dataPart),
    )
    return new TextDecoder().decode(out)
  } catch {
    return null
  }
}

/* ---------- ที่เก็บ token ของ TMS ----------
   อ่านวันหมดอายุจาก payload ของ JWT ตรง ๆ ไม่ตรวจลายเซ็น — ตรงนี้ไม่ได้ใช้ตัดสิน
   สิทธิ์อะไร แค่อ่านวันหมดอายุที่ TMS ประกาศมาเอง ตัวตัดสินจริงคือ TMS ที่ตอบ 401 */
function tokenExpiry(token: string): Date | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    /* base64url ไม่ใช่ base64 — ต้องแปลง - _ กลับก่อน ไม่งั้น atob โยน error
       กับ token ที่มีอักขระสองตัวนี้ ซึ่งเจอเมื่อไหร่ก็ไม่รู้ */
    const exp = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).exp
    return typeof exp === 'number' ? new Date(exp * 1000) : null
  } catch {
    return null
  }
}

/* ---------- ตัวจำกัดรอบเดารหัส ----------
   นับสองชั้น: ต่อ IP กันคนเดียวไล่ยิงหลายบัญชี ต่อ username กันหลายเครื่องรุมบัญชีเดียว
   โควตาต่อ username ตั้งต่ำกว่า เพราะคนพิมพ์รหัสผิดจริงไม่เกินไม่กี่ครั้ง */
const IP_LIMIT = 30
const USER_LIMIT = 8
const WINDOW = '15 minutes'

async function throttle(sb: ReturnType<typeof admin>, key: string, limit: number): Promise<boolean> {
  const { data, error } = await sb.rpc('tms_login_gate', {
    p_key: key, p_limit: limit, p_window: WINDOW,
  })
  /* ตัวนับล่ม = ปล่อยผ่าน ไม่ใช่ปิดประตู — ถ้าปิด คนทั้งออฟฟิศเข้าระบบไม่ได้เพราะ
     ตารางนับมีปัญหา ซึ่งแลกไม่คุ้มกับการกันคนเดารหัสไม่กี่นาที */
  if (error) return true
  return data !== false
}

const clientIp = (req: Request): string =>
  (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'

const reply = (cors: Record<string, string>) =>
  (body: unknown, status = 200, timing?: Record<string, number>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        ...(timing
          ? { 'Server-Timing': Object.entries(timing).map(([k, v]) => `${k};dur=${v}`).join(', ') }
          : {}),
      },
    })

async function handleAuth(req: Request, cors: Record<string, string>): Promise<Response> {
  const json = reply(cors)

  const { username, password } = await req.json().catch(() => ({}))
  if (!username || !password) return json({ error: 'ต้องมี username และ password' }, 400)
  if (typeof username !== 'string' || username.length > 128) {
    return json({ error: 'username ไม่ถูกต้อง' }, 400)
  }

  const sb = admin()

  /* นับทั้งสองชั้นเสมอ ไม่ลัดออกตอนชั้นแรกเต็ม — ไม่งั้นคนร้ายอ่านได้จากพฤติกรรม
     ว่าโดนกันด้วยชั้นไหน และตัวนับต่อ username ก็จะหยุดเดินตอนที่ต้องการมันที่สุด */
  const okIp = await throttle(sb, `ip:${clientIp(req)}`, IP_LIMIT)
  const okUser = await throttle(sb, `user:${username.toLowerCase()}`, USER_LIMIT)
  if (!okIp || !okUser) {
    return json({ error: 'พยายามเข้าสู่ระบบบ่อยเกินไป — รอสัก 15 นาทีแล้วลองใหม่' }, 429)
  }
  /* เก็บกวาดแถวเก่าแบบสุ่มเจอ ไม่ต้องตั้ง cron ให้มีของต้องคอยดูแลเพิ่มอีกตัว */
  /* ไม่ await — งานบ้านไม่ควรถ่วงคนที่กำลังรอเข้าระบบ ล้มก็ล้มไปเงียบ ๆ
     แล้วรอบหน้ามีคนสุ่มเจอใหม่อยู่ดี */
  if (Math.random() < 0.01) sb.rpc('tms_login_sweep').then(() => {}, () => {})

  /* ---- 1. ถาม TMS ว่าคนนี้เป็นพนักงานจริงมั้ย ----
     ยิงรูปแบบเดียว — เดิมลอง userName แล้วต่อด้วย email ซึ่งคูณโหลดที่ยิงไปหา
     บริษัทเป็นสองเท่าทุกครั้งที่รหัสผิด ยืนยันแล้วว่า build นี้ใช้ userName */
  let tmsToken: string | null = null
  /* จับเวลาที่ใช้คุยกับบริษัท แล้วส่งกลับเป็น Server-Timing — เวลาผู้ใช้บ่นว่าช้า
     จะได้ตอบได้ว่าช้าที่ฝั่งไหน โดยไม่ต้องเดาและไม่ต้องเปิด log
     ตัวเลขนี้ไม่ใช่ความลับ มันคือ "เขาตอบเราช้าแค่ไหน" ไม่ได้บอกอะไรเกี่ยวกับบัญชี */
  const t0 = performance.now()
  const r = await fetch(`${TMS_BASE}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json', tenant: TENANT },
    body: JSON.stringify({ userName: username, password }),
  })
  const tmsMs = Math.round(performance.now() - t0)
  if (r.ok) tmsToken = (await r.json()).token
  if (!tmsToken) return json({ error: 'เข้าสู่ระบบ TMS ไม่สำเร็จ' }, 401)

  /* ---- 2. หา/สร้างบัญชีฝั่งเรา ---- */

  const email = authEmail(username)
  const pw = throwaway()

  /* หาแถวผู้ใช้ กับถามชื่อจริงจาก TMS ไม่ต้องรอกัน — สองอย่างนี้ไม่เกี่ยวข้องกันเลย
     เดิมเรียงต่อกันทำให้เวลาล็อกอินเท่ากับผลบวกของทั้งคู่ ทั้งที่ควรเป็นตัวที่ช้ากว่า */
  const existingP = sb.from('users').select('id, auth_id, is_active, role, name')
    .eq('username', username).maybeSingle()

  // ชื่อจริงเอาจาก TMS ไม่ให้ผู้ใช้พิมพ์เอง — จะได้ตรงกับที่ออฟฟิศเรียกกันจริง
  const profileP = fetch(`${TMS_BASE}/personal/profile`, {
    headers: { authorization: `Bearer ${tmsToken}`, accept: 'application/json' },
  }).then(async (p) => {
    if (!p.ok) return null
    const d = await p.json()
    return [d.firstName, d.lastName].filter(Boolean).join(' ') || d.userName || null
  }).catch(() => null)   /* ชื่อไม่ใช่เรื่องคอขาดบาดตาย */

  const { data: existing } = await existingP

  /* คนที่มีชื่ออยู่แล้วไม่ต้องรอผลโปรไฟล์ — ปล่อยให้คำขอนั้นวิ่งจบไปเงียบ ๆ
     ชื่อที่เปลี่ยนใน TMS จะตามมาในรอบถัดไปที่ระบบต้องสร้างบัญชีอยู่ดี
     แลกความสดของชื่อกับการตัดคำขอข้ามอินเทอร์เน็ตหนึ่งรอบออกจากทุกการล็อกอิน */
  const displayName = existing?.name
    ? existing.name
    : (await profileP) ?? username

  let authId = existing?.auth_id ?? null

  /* public.users อาจยังมี auth_id เก่าหลัง Auth ถูกลบจากหน้า Dashboard
     ต้องตรวจตัวจริงก่อน update ไม่เช่นนั้นผู้ใช้บริษัทจะได้ "ออก session ไม่สำเร็จ"
     และค้างอยู่ในคลังเก็บถาวรตลอดไป */
  /* อีเมลที่ใช้ signIn ต้องเป็นของ "บัญชีที่มีอยู่จริง" ไม่ใช่ของที่เพิ่งคำนวณใหม่
     กฎแปลงชื่อผู้ใช้เป็นอีเมลปลอมเคยถูกแก้ (@ เคยกลายเป็น _ ตอนนี้เป็น -40-)
     บัญชีที่สร้างไว้ก่อนหน้านั้นจึงมีอีเมลคนละแบบกับที่ authEmail() คืนวันนี้
     ถ้ายืนยันตัวด้วยอีเมลใหม่ จะไม่เจอบัญชี แล้วผู้ใช้จะได้ "ออก session ไม่สำเร็จ"
     ทั้งที่รหัส TMS ถูกและบัญชีก็ยังอยู่ครบ */
  let signInEmail = email

  if (authId) {
    const { data: linkedAuth } = await sb.auth.admin.getUserById(authId)
    if (!linkedAuth.user) authId = null
    else if (linkedAuth.user.email) signInEmail = linkedAuth.user.email
  }

  if (authId) {
    // ตั้งรหัสใหม่ทุกครั้ง เพื่อจะ signIn ต่อได้โดยไม่ต้องจำรหัสเดิมไว้ที่ไหน
    const { error } = await sb.auth.admin.updateUserById(authId, { password: pw })
    if (error) return json({ error: 'ออก session ไม่สำเร็จ' }, 500)
  } else {
    const { data: created, error } = await sb.auth.admin.createUser({
      email, password: pw, email_confirm: true,
    })
    if (error || !created.user) return json({ error: 'สร้างบัญชีไม่สำเร็จ' }, 500)
    authId = created.user.id

    if (existing) {
      await sb.from('users').update({ auth_id: authId, auth_source: 'tms' }).eq('id', existing.id)
    } else {
      /* เกิดใหม่แบบยังไม่มีสิทธิ์อะไรเลย — is_active = false ทำให้
         app.current_user_id() คืน null ทุก policy จึงมองไม่เห็นคนนี้
         admin ต้องกดอนุมัติก่อน (approve_user) */
      await sb.from('users').insert({
        auth_id: authId, username, name: displayName,
        role: 'viewer', is_active: false, auth_source: 'tms',
      })
    }
  }

  /* ยืนยันตัวบน client คนละตัวกับที่ใช้เขียนฐาน — สำคัญกว่าที่เห็น
     supabase-js เก็บ session ไว้ในตัว client เมื่อ signInWithPassword สำเร็จ
     แล้วเปลี่ยน Authorization ของ "ทุกคำสั่งถัดไป" จาก service_role เป็น JWT
     ของผู้ใช้คนนั้น ผลคือ upsert ลง tms_sessions ข้างล่างวิ่งเป็น authenticated
     ซึ่งไม่มีสิทธิ์แตะตารางนั้นเลย (ตั้งใจ) แล้วผู้ใช้ได้ "เก็บการเชื่อมต่อ TMS ไม่สำเร็จ"
     ทั้งที่ทุกอย่างก่อนหน้าถูกหมด */
  const signer = admin()
  const { data: session, error: signErr } =
    await signer.auth.signInWithPassword({ email: signInEmail, password: pw })
  if (signErr || !session.session) return json({ error: 'ออก session ไม่สำเร็จ' }, 500)

  /* สามอย่างสุดท้ายไม่ขึ้นต่อกัน ทำพร้อมกัน — และ update ที่ต่อ .select() ไว้
     คืนแถวกลับมาในคำขอเดียว ไม่ต้องอ่านซ้ำอีกรอบ

     token ของบริษัทจบการเดินทางตรงนี้ ไม่ถูกส่งลงไปที่เบราว์เซอร์ (ข้อ 7)
     เขียนทับของเดิมเสมอ — คนหนึ่งคนมีได้ session เดียว ล็อกอินใหม่ = ของเก่าใช้ไม่ได้ */
  const expiresAt = tokenExpiry(tmsToken)
  const [{ data: me }, { error: keepErr }] = await Promise.all([
    sb.from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('auth_id', authId)
      .select('id, name, role, is_active')
      .maybeSingle(),
    sb.from('tms_sessions').upsert({
      auth_id: authId,
      token: await sealToken(tmsToken),
      expires_at: expiresAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    }),
  ])
  if (keepErr) return json({ error: 'เก็บการเชื่อมต่อ TMS ไม่สำเร็จ' }, 500)

  return json({
    session: {
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
    },
    /* บอกแค่วันหมดอายุ ไม่ใช่ตัว token — หน้าเว็บใช้ค่านี้ขึ้นป้ายเตือนก่อนหมดเวลา */
    tms_expires_at: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null,
    account: me ?? null,
    pending: !me?.is_active,
  }, 200, { tms: tmsMs, total: Math.round(performance.now() - t0) })
}

/* ---- ตัวตนฝั่งเราต้องมาก่อนทุกเส้นที่ไม่ใช่ auth ----
   header Authorization ต้องเป็น session ของคนที่ล็อกอินอยู่จริง ไม่ใช่ anon key —
   anon key ถูกคอมไพล์ติดไปกับ bundle ใครเปิดหน้าเว็บก็หยิบไปได้ */
async function identify(
  req: Request,
  sb: ReturnType<typeof admin>,
): Promise<{ authId: string } | { error: string; status: number }> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '')
  if (!jwt) return { error: 'ต้องเข้าสู่ระบบก่อน', status: 401 }

  const { data: who } = await sb.auth.getUser(jwt)
  if (!who.user) return { error: 'ต้องเข้าสู่ระบบก่อน', status: 401 }

  return { authId: who.user.id }
}

async function handleCall(req: Request, cors: Record<string, string>): Promise<Response> {
  const json = reply(cors)

  const sb = admin()
  const id = await identify(req, sb)
  if ('error' in id) return json({ error: id.error }, id.status)

  /* บัญชีที่ยังไม่ถูกอนุมัติ หรือถูก admin ปิดไปแล้ว ต้องหมดสิทธิ์ดึงข้อมูลทันที
     ไม่ใช่รอจนกว่า token ของ TMS จะหมดอายุไปเอง */
  const { data: me } = await sb.from('users')
    .select('is_active').eq('auth_id', id.authId).maybeSingle()
  if (!me?.is_active) return json({ error: 'บัญชีนี้ยังไม่ได้รับอนุมัติให้ดึงข้อมูล' }, 403)

  /* หยิบ token ของบริษัทจากฝั่งเซิร์ฟเวอร์ ไม่ใช่รับมาจากคำขอ (ข้อ 7)
     เจ้าตัวเองก็อ่านตารางนี้ไม่ได้ — RLS เปิดแล้วไม่มี policy สักอัน */
  const { data: link } = await sb.from('tms_sessions')
    .select('token, expires_at').eq('auth_id', id.authId).maybeSingle()
  if (!link) {
    return json({ error: 'ยังไม่ได้เชื่อมกับ TMS — เข้าสู่ระบบใหม่หนึ่งครั้ง', code: 'NO_TMS_SESSION' }, 409)
  }
  /* ตัดจบก่อนยิง ถ้า exp บอกว่าหมดแล้ว — ประหยัดคำขอที่รู้ผลอยู่แล้วว่า 401
     เผื่อ 30 วินาทีให้นาฬิกาที่เดินคลาดกัน ไม่ให้ตัดก่อนเวลาจริง */
  if (link.expires_at && Date.parse(link.expires_at) < Date.now() - 30_000) {
    await sb.from('tms_sessions').delete().eq('auth_id', id.authId)
    return json({ error: 'การเข้าระบบ TMS หมดอายุ' }, 401)
  }
  const token = await openToken(link.token)
  if (!token) {
    /* ถอดไม่ออก = คีย์เปลี่ยนไปแล้ว (หรือแถวถูกแก้) แถวนี้ใช้ไม่ได้อีก ลบทิ้งแล้วให้เข้าใหม่
       ตอบ 409 เหมือนกรณีไม่เคยเชื่อม เพราะสำหรับผู้ใช้มันคือเรื่องเดียวกัน */
    await sb.from('tms_sessions').delete().eq('auth_id', id.authId)
    return json({ error: 'ยังไม่ได้เชื่อมกับ TMS — เข้าสู่ระบบใหม่หนึ่งครั้ง', code: 'NO_TMS_SESSION' }, 409)
  }

  const { op, params } = await req.json().catch(() => ({}))

  /* งานแบบวนหลายรอบมาก่อน — ตัวเดียวกันนี้เคยเป็นลูปฝั่งเบราว์เซอร์ที่ยิงเข้ามาสิบรอบ */
  const scan = typeof op === 'string' ? SCANS[op] : undefined
  if (scan) {
    try {
      const result = await scan((params ?? {}) as Record<string, unknown>, token)
      return json(result)
    } catch {
      return json({ error: 'ดึงข้อมูลจาก TMS ไม่สำเร็จ' }, 502)
    }
  }

  const build = typeof op === 'string' ? OPS[op] : undefined
  if (!build) return json({ error: 'ไม่รู้จักงานนี้' }, 403)

  let spec: Op
  try {
    spec = build((params ?? {}) as Record<string, unknown>)
  } catch {
    return json({ error: 'พารามิเตอร์ไม่ถูกต้อง' }, 400)
  }

  const r = await fetch(TMS_BASE + spec.path, {
    method: spec.method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: spec.method === 'GET' ? undefined : JSON.stringify(spec.body ?? {}),
  })

  /* TMS ปฏิเสธ token = ตัวตนฝั่งบริษัทหมดอายุจริง ไม่ใช่แค่ค่า exp ที่เราเดา
     ลบทิ้งเลย ไม่ให้ทุกคำขอถัดไปวิ่งไปเก้อที่บริษัทซ้ำ ๆ */
  if (r.status === 401) await sb.from('tms_sessions').delete().eq('auth_id', id.authId)

  const text = await r.text()
  return new Response(text, {
    status: r.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/** ตัดการเชื่อมต่อ TMS — หน้าเว็บเรียกตอนล็อกเอาต์
 *  เดิมแค่ลบ sessionStorage ฝั่งเบราว์เซอร์ก็จบ ตอนนี้ของจริงอยู่ฝั่งนี้ */
async function handleDisconnect(req: Request, cors: Record<string, string>): Promise<Response> {
  const json = reply(cors)
  const sb = admin()
  const id = await identify(req, sb)
  /* ล็อกเอาต์ตอน session หมดอายุไปแล้วเป็นเรื่องปกติ ตอบ ok ไปเลย ไม่ต้องให้หน้าเว็บ
     ขึ้น error ระหว่างพาผู้ใช้ออก — แถวที่ค้างถูกกวาดทิ้งตามอายุอยู่แล้ว */
  if ('error' in id) return json({ ok: true })
  await sb.from('tms_sessions').delete().eq('auth_id', id.authId)
  return json({ ok: true })
}

Deno.serve(async req => {
  const cors = corsFor(req)
  const json = reply(cors)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!TMS_BASE) return json({ error: 'ยังไม่ได้ตั้ง TMS_BASE_URL' }, 500)
  /* ไม่มีคีย์ = ไม่ทำงานเลย ดีกว่าเก็บ token ของบริษัทเปล่า ๆ ต่อไปแบบไม่มีใครรู้ตัว */
  if (!RAW_KEY) return json({ error: 'ยังไม่ได้ตั้ง TMS_TOKEN_KEY' }, 500)

  const route = new URL(req.url).pathname.split('/').pop()
  try {
    if (route === 'auth') return await handleAuth(req, cors)
    if (route === 'call') return await handleCall(req, cors)
    if (route === 'disconnect') return await handleDisconnect(req, cors)
    return json({ error: 'ไม่รู้จัก route นี้' }, 404)
  } catch (e) {
    // ข้อความ error เท่านั้น ห้าม log request body — มีรหัสผ่านอยู่ในนั้น
    console.error(route, e instanceof Error ? e.message : 'unknown')
    return json({ error: 'เกิดข้อผิดพลาดภายใน' }, 500)
  }
})
