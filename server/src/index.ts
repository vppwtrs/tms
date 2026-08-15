import { createApp } from './app.js'
import { config } from './config.js'
import { openDb } from './db/connection.js'
import { migrate } from './db/schema.js'
import { seedIfEmpty } from './db/seed.js'
import { createCsvStore, startCsvSync } from './db/csv.js'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { loadOrCreateCert } from './tls.js'

// เตรียมโฟลเดอร์ data
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })

const db = openDb(config.dbPath)
migrate(db)
const seeded = seedIfEmpty(db)

// CSV data layer — ข้อมูลเว็บกับไฟล์ CSV เชื่อมกันสองทาง (auto-sync ทุก 3 วินาที)
const csv = createCsvStore(db)
startCsvSync(csv)

const app = createApp(db, csv)

/* HTTPS เป็นค่าเริ่มต้น — ไม่ใช่เรื่องความปลอดภัยอย่างเดียว แต่เป็นข้อบังคับของเบราว์เซอร์:
   กล้อง (getUserMedia) และ GPS ความละเอียดสูง ใช้ได้เฉพาะ secure context
   ปิดด้วย HTTPS=0 ได้ถ้าอยู่หลัง reverse proxy ที่ทำ TLS ให้แล้ว */
const server = config.https ? https.createServer(await loadOrCreateCert(), app) : http.createServer(app)
const scheme = config.https ? 'https' : 'http'

server.listen(config.port, () => {
  console.log(`\n  🚛 TMS API พร้อมใช้งาน: ${scheme}://localhost:${config.port}`)
  if (seeded) console.log('  ✔ เติมข้อมูลตัวอย่างเรียบร้อย (ล็อกอิน: admin / admin123)')
  console.log(`  ✔ ฐานข้อมูล: ${config.dbPath}`)
  console.log(`  ✔ CSV data layer: ${csv.dir} (auto-sync ทุก 3 วินาที)`)
  if (config.https && !config.sslCertPath) {
    console.log(`  ✔ ใบรับรอง self-signed: ${config.certDir}`)
    console.log('    เปิดจากมือถือครั้งแรกจะขึ้นเตือน "ไม่ปลอดภัย" — กดยอมรับ หรือติดตั้ง cert.pem ให้เครื่องเชื่อถือ')
  }
  console.log('')
})

// ปิด DB อย่างเป็นระเบียบ
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    db.close()
    process.exit(0)
  })
}
