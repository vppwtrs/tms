/**
 * tms-sync — ดึง Actual Shipment จาก TMS บริษัท แล้ว upsert ลง tms_shipments
 *
 * ทำไมต้องเป็น Edge Function ไม่ใช่ยิงจากหน้าเว็บ:
 *   1. รหัสผ่าน TMS อยู่ใน secret ฝั่ง server เท่านั้น หน้าเว็บเห็นไม่ได้แม้แต่ตัวเดียว
 *   2. tms-api ไม่ส่ง Access-Control-Allow-Origin เบราว์เซอร์ยิงตรงไม่ได้อยู่แล้ว
 *
 * secret ที่ต้องตั้งก่อนใช้ (ตั้งผ่าน dashboard หรือ `supabase secrets set`):
 *   TMS_BASE_URL   ต้องเป็น https://pdi.vespiario.net/tms-api/api  (ยืนยันจาก request จริงของหน้าเว็บ TMS)
 *                  ใส่แค่ https://pdi.vespiario.net จะ 404 ทุก endpoint — โดเมนไม่ใช่ราก API
 *   TMS_TENANT     ปกติคือ root
 *   TMS_USER       ควรเป็น service account สิทธิ์อ่านอย่างเดียว ไม่ใช่บัญชีส่วนตัว
 *   TMS_PASSWORD
 *   TMS_WAREHOUSE_ID   GUID ของคลัง — ใช้กับ /v1/reports/actualshipment
 *   TMS_WAREHOUSE_CODE รหัสคลัง เช่น KM23-CW-01 — ใช้กับ /v1/pickinglistheaders/{wh}/search
 *                      สอง endpoint นี้อ้างคลังคนละแบบ ไม่ใช่ความซ้ำซ้อน
 *   SYNC_SECRET    กันคนนอกเรียกฟังก์ชันนี้เล่น
 *
 * SUPABASE_URL กับ SUPABASE_SERVICE_ROLE_KEY แพลตฟอร์มใส่ให้เอง ไม่ต้องตั้ง
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

/* 23 คอลัมน์แบน ๆ ไม่มี details[] — รายงานไม่ส่ง item มาให้เลย
   (ยืนยันจาก extractor/tms-extractor/public/app.js:323 ที่ map ของจริงมาแล้ว) */
interface TmsRow {
  pickingListNo?: string
  tripNo?: string
  orderDate?: string
  dealerName?: string
  branch?: string
  unit?: number
  [k: string]: unknown
}

interface PlDetail {
  itemNo?: string
  description?: string
  qty?: number
  splitQty?: number
}

const env = (k: string): string => {
  const v = Deno.env.get(k)
  if (!v) throw new Error(`ยังไม่ได้ตั้ง secret: ${k}`)
  return v
}

async function login(): Promise<string> {
  const res = await fetch(`${env('TMS_BASE_URL')}/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', tenant: env('TMS_TENANT') },
    body: JSON.stringify({ UserName: env('TMS_USER'), Password: env('TMS_PASSWORD') }),
  })
  if (!res.ok) throw new Error(`ล็อกอิน TMS ไม่ผ่าน (${res.status})`)

  /* ชื่อฟิลด์ต่างกันไปตามเวอร์ชันของ FullStackHero — รับได้ทั้งสามแบบที่เจอจริง */
  const j = (await res.json()) as Record<string, string>
  const token = j.token ?? j.accessToken ?? j.jwToken
  if (!token) throw new Error('ล็อกอินผ่านแต่ไม่พบ token ใน response')
  return token
}

/** ค่าเริ่มต้นย้อนหลัง 1 วัน — ไม่ใช่บั๊ก แต่เป็นกติกาธุรกิจ:
 *  ข้อมูลของ "วันนี้" ยังไม่ actual มันจะถูกปิดและส่งหลังเที่ยงคืน */
function yesterday(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function fetchShipments(token: string, from: string, to: string): Promise<TmsRow[]> {
  const res = await fetch(`${env('TMS_BASE_URL')}/v1/reports/actualshipment`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      tenant: env('TMS_TENANT'),
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      planDeliveryDate: [`${from}T00:00:00.000Z`, `${to}T00:00:00.000Z`],
      warehouseId: env('TMS_WAREHOUSE_ID'),
    }),
  })
  if (!res.ok) throw new Error(`ดึงรายงานไม่สำเร็จ (${res.status})`)

  /* endpoint นี้คืน array แบน ๆ ไม่มี paging */
  const j = await res.json()
  return Array.isArray(j) ? j : ((j.data ?? []) as TmsRow[])
}

/* เลข PL ในรายงานบางใบมีหาง -C-04 ต่อท้าย = "ส่วนที่ 4" ของใบนั้น (ถูกแบ่งส่งหลายเที่ยว)
   ซึ่งอาจไม่ตรงกับเลขที่เก็บใน PL header — ลองทั้งแบบเต็มและแบบตัดหาง
   ตรรกะเดียวกับ plKeyVariants() ใน extractor ห้ามให้สองที่นี้ต่างกัน */
function plKeyVariants(no: string): string[] {
  const s = String(no ?? '').trim()
  const base = s.replace(/-[A-Za-z]+-\d+$/, '')
  return base !== s ? [s, base] : [s]
}

/* รายงาน actualshipment ไม่มี item — ต้องไปดึงจาก pickinglistheaders แล้ว join ด้วยเลข PL
 *
 * ค้นทีละใบด้วย keyword ไม่ใช่ไล่หน้าทั้งคลังแบบที่ extractor ทำ
 * ตอนวัดของจริง: คลังเดียวมี PL header 14,915 ใบ = 30 หน้า หน้าละ 500 ใบพร้อม details
 * ส่วนรายงานหนึ่งวันมี PL ไม่กี่สิบใบ — ค้นตรงจึงถูกกว่ามาก ทั้งจำนวน request และปริมาณข้อมูล
 * (extractor ไล่หน้าเพราะมันรันในเบราว์เซอร์ของคน กดครั้งเดียวจบ คนละสถานการณ์กับ cron ตอนตี 1)
 *
 * keyword ค้นเจอเลข PL เต็มรวมหาง -C-04 ตรง ๆ — วัดจาก 40 ใบจริง เจอครบ ไม่ต้องตัดหางเลย
 * แต่ยังลองแบบตัดหางเป็นตัวสำรอง เพราะ 0 ครั้งจากการวัดครั้งเดียวไม่ใช่ 0 ตลอดไป */
async function fetchDetails(token: string, wanted: string[]): Promise<Map<string, PlDetail[]>> {
  const found = new Map<string, PlDetail[]>()
  const base = env('TMS_BASE_URL')
  const wh = encodeURIComponent(env('TMS_WAREHOUSE_CODE'))
  const headers = {
    'content-type': 'application/json',
    tenant: env('TMS_TENANT'),
    authorization: `Bearer ${token}`,
  }

  async function lookup(plNo: string): Promise<void> {
    for (const key of plKeyVariants(plNo)) {
      const res = await fetch(`${base}/v1/pickinglistheaders/${wh}/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ orderBy: [], pageNumber: 1, pageSize: 5, keyword: key }),
      })
      if (!res.ok) throw new Error(`ดึง picking list header ไม่สำเร็จ (${res.status})`)

      const j = await res.json()
      const data = (j.data ?? j.items ?? []) as Array<{ pickingListNo?: string; details?: PlDetail[] }>
      const hit = data.find((h) => h.pickingListNo === key)
      if (hit) {
        found.set(plNo, hit.details ?? [])
        return
      }
    }
  }

  /* ยิงทีละ 5 ใบพร้อมกัน — เร็วพอโดยไม่กระแทก TMS รัวเป็นร้อย request พร้อมกัน
     ถ้าวันไหนโดน WAF ตัด ให้ลดตัวเลขนี้ก่อนอย่างอื่น */
  const CHUNK = 5
  for (let i = 0; i < wanted.length; i += CHUNK) {
    await Promise.all(wanted.slice(i, i + CHUNK).map(lookup))
  }

  return found
}

Deno.serve(async (req) => {
  /* ฟังก์ชันนี้เปิดสาธารณะตามค่าเริ่มต้นของ Edge Function
     ต้องกันเอง ไม่งั้นใครก็สั่งให้ยิง TMS รัว ๆ ได้ */
  if (req.headers.get('x-sync-secret') !== env('SYNC_SECRET')) {
    return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์' } }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const from = (body.from as string) ?? yesterday()
    const to = (body.to as string) ?? from

    const token = await login()
    const rows = (await fetchShipments(token, from, to)).filter(
      (r) => String(r.pickingListNo ?? '').trim() !== '',
    )

    /* PL เดียวโผล่ในรายงานได้หลายแถว (หลายเที่ยว) — ค้น details ครั้งเดียวพอ */
    const wanted = [...new Set(rows.map((r) => String(r.pickingListNo).trim()))]
    const details = wanted.length > 0 ? await fetchDetails(token, wanted) : new Map<string, PlDetail[]>()

    let missing = 0
    let mismatch = 0

    /* แตกเป็นแถวละ item เหมือนที่ทำใน extractor — PL หนึ่งใบส่งได้หลายรุ่น
       ใบที่หา details ไม่เจอยังเก็บไว้หนึ่งแถว item ว่าง เพื่อไม่ให้ข้อมูลหาย */
    const flat = rows.flatMap((r) => {
      const plNo = String(r.pickingListNo).trim()
      const base = {
        picking_list_no: plNo,
        trip_no_tms: r.tripNo ?? null,
        /* orderDate ไม่ใช่ planDeliveryDate — รายงานไม่มีฟิลด์หลัง ดู 0006 */
        trip_date: r.orderDate ? String(r.orderDate).slice(0, 10) : null,
        dealer_name: r.dealerName ?? null,
        /* dealer_code คือกุญแจจับคู่ลูกค้าใน 0008 — ชื่อร้านใช้แทนไม่ได้ มันเปลี่ยนได้ */
        dealer_code: (r.dealerCode as string) ?? null,
        branch: r.branch ?? null,
        unit: r.unit ?? null,
        license_plate: (r.licensePlate as string) ?? null,
        driver_name: (r.driver as string) ?? null,
        status_delivery: (r.statusDelivery as string) ?? null,
        actual_cost: (r.actualCost as number) ?? null,
        raw: r,
      }

      const det = details.get(plNo)

      if (!det || det.length === 0) {
        missing++
        return [{ ...base, item_no: '', item_name: null, item_qty: null,
                  item_split_qty: null, qty_source: null }]
      }

      /* วัดจากของจริง 40 ใบ (รวมใบมีหาง -C-0n) unit ตรงกับผลรวม qty ทั้ง 40 ใบ ไม่มีใบไหนต้องใช้ splitQty
         ยังเก็บทั้งคู่ไว้เหมือนเดิม เพราะ 40 ใบจากคลังเดียวช่วงเดียวไม่ใช่ข้อสรุปถาวร
         qty_source คือตัวเฝ้า: วันไหนมันเริ่มเป็น split หรือ null แปลว่าสมมติฐานนี้เปลี่ยนแล้ว */
      const sumQty = det.reduce((s, d) => s + (Number(d.qty) || 0), 0)
      const sumSplit = det.reduce((s, d) => s + (Number(d.splitQty) || 0), 0)
      const u = Number(r.unit) || 0
      const qtySource = sumQty === u ? 'qty' : sumSplit === u ? 'split' : null
      if (qtySource === null) mismatch++

      return det.map((d) => ({
        ...base,
        item_no: String(d.itemNo ?? ''),
        item_name: d.description ?? null,
        item_qty: d.qty ?? null,
        item_split_qty: d.splitQty ?? null,
        qty_source: qtySource,
      }))
    })

    const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

    /* upsert ด้วย natural key — ดึงซ้ำวันเดิมจึงไม่เกิดแถวซ้ำ
       ignoreDuplicates: false = ให้เขียนทับของเดิม เพราะ TMS แก้ข้อมูลย้อนหลังได้ */
    const { error } = await supabase
      .from('tms_shipments')
      .upsert(flat, { onConflict: 'picking_list_no,item_no', ignoreDuplicates: false })

    if (error) throw new Error(error.message)

    /* missing/mismatch ต้องโผล่ในคำตอบ ไม่ใช่เงียบ ๆ — sync ที่ "สำเร็จ" แต่ item หายทั้งก้อน
       คือแบบที่เจอยากที่สุด ตัวเลขสองตัวนี้คือสัญญาณว่า join พังหรือ API เปลี่ยนโครง */
    return new Response(
      JSON.stringify({
        data: { from, to, rows: rows.length, items: flat.length, missingItems: missing, qtyMismatch: mismatch },
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  } catch (e) {
    /* ข้อความ error อาจมีรายละเอียดของ TMS ติดมา — log ไว้ฝั่ง server
       แต่ตอบกลับแบบกลาง ๆ ไม่ส่งรายละเอียดออกไปให้คนเรียก */
    console.error('tms-sync ล้มเหลว:', e)
    return new Response(
      JSON.stringify({ error: { code: 'SYNC_FAILED', message: 'ดึงข้อมูลจาก TMS ไม่สำเร็จ' } }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  }
})
