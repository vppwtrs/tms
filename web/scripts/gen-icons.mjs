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
/* รถบรรทุกตู้เขียว หัวเก๋งครีม — โลโก้ที่เจ้าของระบบเลือก
   วาดด้วย SDF ล้วนเหมือนเดิม ไม่พึ่ง dependency ภายนอก จึงรันได้ทุกเครื่องที่มี Node */

const CREAM = [238, 232, 214]
const CREAM_DARK = [206, 197, 176]
const GREEN = [47, 122, 47]
const GREEN_DARK = [28, 84, 30]
const GLASS = [176, 210, 226]
const TIRE = [38, 38, 40]
const HUB = [150, 150, 152]
const INK = [32, 30, 28]
const BG = [246, 242, 254]

/** ทับสีทีละชั้นจากหลังไปหน้า — ชั้นหน้าชนะตามค่า alpha ของมันเอง */
function over(dst, src, alpha) {
  if (alpha <= 0) return
  for (let i = 0; i < 3; i++) dst[i] = Math.round(dst[i] * (1 - alpha) + src[i] * alpha)
  dst[3] = Math.max(dst[3], alpha)
}

function drawIcon(size, { bleed = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / size
      const fy = (y + 0.5) / size

      /* maskable ต้องเต็มกรอบ ระบบปฏิบัติการเป็นคนตัดมุมเอง
         ส่วนไอคอนธรรมดาตัดมุมเองเพื่อไม่ให้เป็นสี่เหลี่ยมทื่อบนจอโฮม */
      const bgA = bleed ? 1 : aa(sdRoundRect(fx, fy, 0.5, 0.5, 0.5, 0.5, 0.22) * size)
      const c = [BG[0], BG[1], BG[2], 0]
      over(c, BG, bgA)

      /* แชสซี — เส้นเข้มใต้ท้องรถ ผูกหัวเก๋งกับตู้ให้เป็นคันเดียวกัน */
      over(c, INK, aa(sdRoundRect(fx, fy, 0.5, 0.665, 0.35, 0.028, 0.012) * size))

      /* ตู้สินค้า */
      const boxA = aa(sdRoundRect(fx, fy, 0.635, 0.475, 0.225, 0.185, 0.022) * size)
      over(c, GREEN_DARK, boxA)
      over(c, GREEN, aa(sdRoundRect(fx, fy, 0.635, 0.475, 0.211, 0.171, 0.018) * size))
      /* ร่องแนวนอนบนตู้ — เส้นที่ทำให้อ่านออกว่าเป็นตู้บรรทุก ไม่ใช่กล่องเปล่า */
      for (const gy of [0.345, 0.41, 0.475, 0.54, 0.605]) {
        const inBox = aa(sdRoundRect(fx, fy, 0.635, 0.475, 0.205, 0.165, 0.016) * size)
        over(c, GREEN_DARK, Math.min(inBox, aa((Math.abs(fy - gy) - 0.008) * size)))
      }

      /* หัวเก๋ง */
      const cabA = aa(sdRoundRect(fx, fy, 0.255, 0.545, 0.145, 0.115, 0.035) * size)
      over(c, CREAM_DARK, cabA)
      over(c, CREAM, aa(sdRoundRect(fx, fy, 0.255, 0.545, 0.133, 0.103, 0.03) * size))
      /* กระจกหน้า */
      over(c, GLASS, aa(sdRoundRect(fx, fy, 0.245, 0.5, 0.1, 0.05, 0.022) * size))

      /* ล้อ — หน้าหนึ่ง หลังคู่ ตามรถหกล้อที่กองรถใช้จริง */
      for (const wx of [0.285, 0.62, 0.79]) {
        over(c, TIRE, aa(sdCircle(fx, fy, wx, 0.72, 0.082) * size))
        over(c, HUB, aa(sdCircle(fx, fy, wx, 0.72, 0.034) * size))
      }

      const idx = (y * size + x) * 4
      rgba[idx] = c[0]
      rgba[idx + 1] = c[1]
      rgba[idx + 2] = c[2]
      rgba[idx + 3] = Math.round(Math.min(1, c[3]) * 255)
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
  /* maskable = เต็มกรอบ ไม่ตัดมุมเอง — Android ครอบรูปทรงของเครื่องทับอีกที
     ถ้าตัดมุมมาให้แล้ว จะโดนตัดซ้ำจนขอบรถแหว่ง */
  const png = encodePNG(size, size, drawIcon(size, { bleed: file.includes('maskable') }))
  writeFileSync(join(outDir, file), png)
  console.log(`✔ ${file} (${size}x${size}, ${png.length.toLocaleString()} bytes)`)
}
console.log('เสร็จ — ไอคอนอยู่ใน web/public/icons/')
