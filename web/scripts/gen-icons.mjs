/**
 * สร้างไอคอนแอป (PNG) ด้วย Node ล้วน — ไม่พึ่ง dependency ภายนอก
 * ดีไซน์: ช่องอำพันมุมมน + รถบรรทุกหมึกเข้ม (ตรงกับธีม Warm Editorial Premium)
 * ใช้สำหรับ: PWA manifest (192/512/maskable) + apple-touch-icon (180)
 *
 * รัน: node scripts/gen-icons.mjs  (หรือ npm run icons -w web)
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'icons')
mkdirSync(outDir, { recursive: true })

/* ---------- PNG encoder (RGBA8) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/* ---------- คณิตศาสตร์เรขาคณิต ---------- */
const clamp01 = (v) => Math.min(1, Math.max(0, v))
const lerp = (a, b, t) => a + (b - a) * t

/** signed distance ของสี่เหลี่ยมมุมมน (SDF) — < 0 = ด้านใน */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

/** alpha แบบ antialiased จาก SDF */
const aa = (d) => clamp01(0.5 - d)

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r

/* ---------- วาดไอคอน ---------- */
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const px = (u) => u * size // fraction → pixel

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / size
      const fy = (y + 0.5) / size

      // พื้นหลัง: ช่องอำพันมุมมน + gradient แนวตั้ง
      const bgA = aa(sdRoundRect(fx, fy, 0.5, 0.5, 0.5, 0.5, 0.21))
      const t = clamp01(fy)
      const r = Math.round(lerp(204, 158, t)) // #cc8a14 → #9e6208
      const g = Math.round(lerp(138, 98, t))
      const b = Math.round(lerp(20, 8, t))

      // รถบรรทุก (หมึกเข้ม) — ใช้ alpha สูงสุดของชิ้นส่วน
      let truckA = 0
      // ตัวตู้สินค้า
      truckA = Math.max(truckA, aa(sdRoundRect(fx, fy, 0.4, 0.475, 0.2, 0.165, 0.025)))
      // ห้องคนขับ (หลังคาลาด)
      const cabTop = 0.42 + (fx - 0.6) * 0.55
      if (fx >= 0.6 && fx <= 0.84) {
        const d = Math.max(fy - cabTop, sdRoundRect(fx, fy, 0.72, 0.545, 0.12, 0.13, 0.025))
        truckA = Math.max(truckA, aa(-Math.min(d, 0)))
      }
      // ล้อ
      truckA = Math.max(truckA, aa(sdCircle(fx, fy, 0.38, 0.72, 0.062)))
      truckA = Math.max(truckA, aa(sdCircle(fx, fy, 0.74, 0.72, 0.062)))

      const a = Math.min(1, Math.max(bgA, truckA * 0.96))
      const cr = truckA > 0.01 ? 36 : r
      const cg = truckA > 0.01 ? 31 : g
      const cb = truckA > 0.01 ? 20 : b

      const idx = (y * size + x) * 4
      rgba[idx] = cr
      rgba[idx + 1] = cg
      rgba[idx + 2] = cb
      rgba[idx + 3] = Math.round(a * 255)
    }
  }
  return rgba
}

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-512-maskable.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
]

for (const { file, size } of targets) {
  const png = encodePNG(size, size, drawIcon(size))
  writeFileSync(join(outDir, file), png)
  console.log(`✔ ${file} (${size}x${size}, ${png.length.toLocaleString()} bytes)`)
}
console.log('เสร็จ — ไอคอนอยู่ใน web/public/icons/')
