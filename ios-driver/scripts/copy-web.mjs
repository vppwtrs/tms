/**
 * คัดลอกผลลัพธ์ของ web/dist มาที่ ios-driver/www
 *
 * ไม่ใช้ webDir ชี้ข้ามโฟลเดอร์ไปที่ ../web/dist ตรง ๆ เพราะ cap sync บางคำสั่ง
 * เขียนไฟล์ลงใน webDir และเราไม่อยากให้มันไปแตะผลลัพธ์ของเว็บ
 */
import { cp, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, '..', '..', 'web', 'dist')
const www = resolve(here, '..', 'www')

try {
  await stat(dist)
} catch {
  console.error('ไม่พบ web/dist — สั่ง `npm run build:cloud -w web` ก่อน')
  process.exit(1)
}

await rm(www, { recursive: true, force: true })
await cp(dist, www, { recursive: true })
console.log(`คัดลอกแล้ว: ${dist} -> ${www}`)
