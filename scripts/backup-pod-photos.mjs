#!/usr/bin/env node
/**
 * สำเนาหลักฐานการส่งมอบลงโฟลเดอร์ในเครื่อง
 *
 * ทำไมเป็นสคริปต์ในเครื่อง ไม่ใช่ Edge Function ที่ยิงเข้า Google Drive API:
 * service account ของ Google ไม่มีโควตา Drive ของตัวเอง ไฟล์ที่มันสร้างในโฟลเดอร์
 * ที่คนแชร์ให้จึงอัปไม่ขึ้น ทางที่ใช้ได้จริงคือ Shared Drive ซึ่งมีเฉพาะ Workspace
 * หรือ OAuth refresh token ของคนจริง ซึ่งถูกเพิกถอนแล้วเงียบ ๆ ได้ตลอด
 * ตัวนี้เขียนลงโฟลเดอร์ธรรมดา แล้วให้แอป Google Drive ในเครื่อง sync เอง
 * — ของที่ต้องดูแลน้อยที่สุด และพังแบบที่คนเห็นทันที (ไฟล์ไม่ขึ้นในโฟลเดอร์)
 *
 * เขียนอย่างเดียว ไม่ลบอะไรทั้งสิ้น ทั้งในถังและในเครื่อง
 *
 * สิ่งที่ได้ต่อหนึ่งใบ:
 *   <BACKUP_DIR>/<ปี-เดือน>/<order_id>/signature.png   ลายเซ็นผู้รับ
 *   <BACKUP_DIR>/<ปี-เดือน>/<order_id>/<kind>-N.jpg    รูปหน้างานทุกมุม
 *   <BACKUP_DIR>/<ปี-เดือน>/<order_id>/info.json       ใครรับ เมื่อไหร่ ที่ไหน ใบไหน
 *
 * info.json สำคัญพอ ๆ กับรูป — โฟลเดอร์ที่มีแต่ไฟล์ภาพชื่อสุ่มตอบข้อโต้แย้งไม่ได้
 * คนที่เปิดมันในอีกสามปีข้างหน้าอาจไม่มีสิทธิ์เข้าฐานแล้ว หรือฐานอาจไม่มีแถวนั้นแล้ว
 *
 * รันซ้ำได้ ข้ามไฟล์ที่มีอยู่แล้ว จึงตั้งให้รันทุกคืนได้โดยไม่โหลดของเดิมซ้ำ
 *
 * ตั้งค่า: คัดลอก scripts/backup.env.example เป็น scripts/backup.env แล้วใส่ค่า
 * รัน:    node scripts/backup-pod-photos.mjs
 */

import { mkdir, writeFile, readdir, access } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/* อ่าน .env เอง ไม่พึ่งไลบรารี — สคริปต์นี้ต้องรันได้บนเครื่องออฟฟิศที่มีแค่ Node
   ไม่มี npm install ไม่มี node_modules ให้พัง */
function loadEnv(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (value && !process.env[m[1]]) process.env[m[1]] = value
  }
}

loadEnv(join(HERE, 'backup.env'))

const URL_BASE = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const OUT = process.env.BACKUP_DIR

if (!URL_BASE || !KEY || !OUT) {
  console.error(`ยังตั้งค่าไม่ครบ — ต้องมีทั้งสามค่าใน scripts/backup.env

  SUPABASE_URL=https://xxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=...        (Project Settings > API > service_role)
  BACKUP_DIR=G:\\My Drive\\TMS-POD      (โฟลเดอร์ที่ Google Drive sync อยู่)

service_role key ข้าม RLS ทั้งหมด เก็บไว้ในเครื่องเท่านั้น ห้าม commit
(.gitignore ครอบ .env อยู่แล้ว และไฟล์นี้ชื่อ backup.env จึงถูกครอบด้วย)`)
  process.exit(1)
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

/** ดึงหลักฐานทุกใบพร้อมรูปและข้อมูลรอบตัว — ครั้งเดียวจบ ไม่ยิงรายใบ
 *  PostgREST ฝังตารางที่เกี่ยวข้องมาให้ในคำขอเดียวได้ ซึ่งเร็วกว่าวนลูปหลายพันรอบมาก */
async function fetchPods() {
  const select = [
    'id', 'order_id', 'recipient_name', 'signature_data', 'notes', 'status',
    'lat', 'lng', 'collected_at',
    'pod_photos(path,kind)',
    'orders(order_no,tms_picking_list_no,destination,tms_trip_no,delivered_at)',
  ].join(',')

  const rows = []
  const PAGE = 200
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${URL_BASE}/rest/v1/pod?select=${encodeURIComponent(select)}&order=id.asc`, {
      headers: { ...headers, Range: `${from}-${from + PAGE - 1}` },
    })
    if (!res.ok) throw new Error(`อ่านตาราง pod ไม่สำเร็จ (${res.status}): ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

async function download(path) {
  const res = await fetch(`${URL_BASE}/storage/v1/object/pod-photos/${path.split('/').map(encodeURIComponent).join('/')}`, { headers })
  if (!res.ok) throw new Error(`โหลดรูปไม่สำเร็จ (${res.status}) ${path}`)
  return Buffer.from(await res.arrayBuffer())
}

const exists = async (p) => { try { await access(p); return true } catch { return false } }

/* แยกโฟลเดอร์ตามเดือนที่เก็บหลักฐาน ไม่ใช่กองรวมกันหมด — วันที่ต้องหาใบของเดือน
   ที่ลูกค้าทักมา คนจะเปิดหาจากเดือนก่อน ไม่ใช่จากเลขออเดอร์ที่ไม่มีใครจำได้ */
const monthOf = (iso) => (iso ?? '').slice(0, 7) || 'ไม่ทราบเดือน'

async function main() {
  const pods = await fetchPods()
  console.log(`พบหลักฐาน ${pods.length} ใบ`)

  let newFiles = 0
  let skipped = 0
  const failed = []

  for (const p of pods) {
    const dir = join(OUT, monthOf(p.collected_at), String(p.order_id))
    await mkdir(dir, { recursive: true })

    /* ลายเซ็นเป็น data URL ในฐาน ไม่ได้อยู่ในถัง — แปลงกลับเป็นไฟล์ภาพตรงนี้
       ไม่งั้นสำเนาที่ได้จะมีแต่รูปหน้างาน ซึ่งเป็นส่วนที่ตอบข้อโต้แย้งไม่ได้ */
    const sigPath = join(dir, 'signature.png')
    if (p.signature_data && !(await exists(sigPath))) {
      const b64 = p.signature_data.split(',')[1] ?? ''
      if (b64) { await writeFile(sigPath, Buffer.from(b64, 'base64')); newFiles += 1 }
    }

    const byKind = {}
    for (const ph of p.pod_photos ?? []) {
      byKind[ph.kind] = (byKind[ph.kind] ?? 0) + 1
      const name = `${ph.kind}-${byKind[ph.kind]}.jpg`
      const dest = join(dir, name)
      if (await exists(dest)) { skipped += 1; continue }
      try {
        await writeFile(dest, await download(ph.path))
        newFiles += 1
      } catch (e) {
        /* รูปเดียวโหลดไม่ได้ ไม่ควรทำให้ทั้งคืนล้ม — จดไว้แล้วไปต่อ
           แล้วรอบหน้าค่อยลองใหม่ เพราะรอบนี้ยังไม่ได้เขียนไฟล์นั้นลงไป */
        failed.push(`${p.order_id}/${ph.path}: ${e.message}`)
      }
    }

    await writeFile(join(dir, 'info.json'), JSON.stringify({
      order_id: p.order_id,
      bill_no: p.orders?.tms_picking_list_no ?? p.orders?.order_no ?? null,
      trip_no: p.orders?.tms_trip_no ?? null,
      destination: p.orders?.destination ?? null,
      recipient_name: p.recipient_name,
      collected_at: p.collected_at,
      delivered_at: p.orders?.delivered_at ?? null,
      status: p.status,
      coords: p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null,
      notes: p.notes,
      photos: (p.pod_photos ?? []).map((ph) => ph.kind),
    }, null, 2), 'utf8')
  }

  console.log(`ไฟล์ใหม่ ${newFiles} · ข้ามของเดิม ${skipped}`)
  if (failed.length > 0) {
    console.error(`โหลดไม่สำเร็จ ${failed.length} ไฟล์ (รอบหน้าจะลองใหม่ให้เอง):`)
    failed.forEach((f) => console.error('  ' + f))
    /* ออกด้วยรหัสไม่ปกติ เพื่อให้ Task Scheduler ขึ้นสถานะล้มเหลว — งานสำรอง
       ที่ล้มแบบเงียบ ๆ คือสิ่งที่คนไปรู้ตอนต้องใช้ของ ซึ่งสายเกินไปแล้ว */
    process.exit(2)
  }

  const months = await readdir(OUT).catch(() => [])
  console.log(`สำเนาอยู่ที่ ${OUT} (${months.length} เดือน)`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
