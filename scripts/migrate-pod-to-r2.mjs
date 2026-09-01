#!/usr/bin/env node
/**
 * ย้ายรูปหลักฐาน POD ที่มีอยู่เดิม จาก Supabase Storage (bucket pod-photos) ไป Cloudflare R2
 *
 * ใช้ครั้งเดียวตอนสลับที่เก็บ — object key เหมือนเดิมทุกตัว (<order_id>/<uuid>.<ext>)
 * ตาราง pod_photos.path จึงไม่ต้องแตะ หลัง Edge Function ชี้ไป R2 แล้วรูปเก่าเปิดได้ทันที
 *
 * รันซ้ำได้ ข้ามไฟล์ที่ R2 มีแล้ว (เช็คด้วย HEAD) — ตกกลางคันแล้วรันใหม่ได้เลย
 * ล้มบางไฟล์ = จดไว้ ไปต่อ จบด้วย exit code ไม่ปกติ
 *
 * ตั้งค่า: scripts/backup.env ต้องมี
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (อ่านไฟล์เก่าจากถัง Supabase)
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *
 * รัน:  node scripts/migrate-pod-to-r2.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { r2Client } from './r2-sigv4.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

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

if (!URL_BASE || !KEY) {
  console.error('ยังตั้งค่าไม่ครบ — ต้องมี SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน scripts/backup.env')
  process.exit(1)
}

let r2
try {
  r2 = r2Client({
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
  })
} catch (e) {
  console.error(e.message + ' (ดู scripts/backup.env)')
  process.exit(1)
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const CONTENT_TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const typeOf = (path) => CONTENT_TYPE[(/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? 'jpg').toLowerCase()] ?? 'application/octet-stream'

/** ทุก path ที่ต้องมีอยู่ในถัง — pod_photos เป็นหลัก + photo_path เดิมของ POD รุ่นรูปเดียว */
async function allPaths() {
  const set = new Set()

  for (const table of ['pod_photos?select=path', 'pod?select=photo_path']) {
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const res = await fetch(`${URL_BASE}/rest/v1/${table}&order=id.asc`, {
        headers: { ...headers, Range: `${from}-${from + PAGE - 1}` },
      })
      if (!res.ok) throw new Error(`อ่าน ${table} ไม่สำเร็จ (${res.status}): ${await res.text()}`)
      const rows = await res.json()
      for (const r of rows) {
        const p = (r.path ?? r.photo_path ?? '').trim()
        if (p) set.add(p)
      }
      if (rows.length < PAGE) break
    }
  }
  return [...set]
}

async function download(path) {
  const res = await fetch(
    `${URL_BASE}/storage/v1/object/pod-photos/${path.split('/').map(encodeURIComponent).join('/')}`,
    { headers, signal: AbortSignal.timeout(30000) },
  )
  if (!res.ok) throw new Error(`Supabase GET ${path} -> ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  const paths = await allPaths()
  console.log(`พบรูปที่ต้องย้าย ${paths.length} ไฟล์`)
  if (paths.length) console.log(`ตัวอย่าง path แรก: ${paths[0]}`)

  let copied = 0
  let skipped = 0
  const failed = []

  for (const path of paths) {
    process.stdout.write(`  [${copied + skipped + failed.length + 1}/${paths.length}] ${path} ... `)
    try {
      if (await r2.has(path)) { skipped += 1; console.log('มีแล้ว ข้าม'); continue }
      await r2.put(path, await download(path), typeOf(path))
      copied += 1
      console.log('ย้ายแล้ว')
    } catch (e) {
      failed.push(`${path}: ${e.message}`)
      console.log(`ล้ม (${e.message})`)
    }
  }

  console.log(`เสร็จ — ย้ายใหม่ ${copied} · ข้ามของที่มีแล้ว ${skipped}`)
  if (failed.length) {
    console.error(`ล้มเหลว ${failed.length} ไฟล์:`)
    failed.forEach((f) => console.error('  ' + f))
    process.exit(2)
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
