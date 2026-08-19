/**
 * สร้างไอคอนแอป (PNG) ด้วย Node ล้วน — ไม่พึ่ง dependency ภายนอก
 * ใช้สำหรับ: PWA manifest (192/512/maskable) + apple-touch-icon (180)
 *
 * **ใช้รูปจริงได้** วางไฟล์ต้นฉบับไว้ที่ web/assets-src/logo.png (PNG, ยิ่งใหญ่ยิ่งดี — 512px ขึ้นไป)
 * แล้วสคริปต์จะย่อ/ขยายเป็นทุกขนาดให้เอง ถ้าไม่มีไฟล์นั้นจะถอยไปวาดรถบรรทุกด้วยโค้ดแทน
 * (ของเดิม) เพื่อให้ repo สร้างไอคอนได้เสมอ ไม่ว่าจะมีไฟล์ต้นฉบับติดมาหรือไม่
 *
 * รัน: node scripts/gen-icons.mjs  (หรือ npm run icons -w web)
 */
import { deflateSync, inflateSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

const CREAM = [240, 233, 214]
const CREAM_SHADE = [214, 204, 181]
const CREAM_LINE = [178, 168, 146]
const GREEN = [47, 122, 47]
const GREEN_DARK = [26, 78, 28]
const GREEN_LINE = [20, 60, 22]
const GLASS = [176, 210, 226]
const GLASS_DARK = [138, 180, 202]
const TIRE = [30, 30, 32]
const RIM = [168, 168, 172]
const RIM_DARK = [120, 120, 126]
const INK = [26, 25, 24]
const LAMP = [246, 226, 150]
const BG = [255, 255, 255]

/** ทับสีทีละชั้นจากหลังไปหน้า — ชั้นหน้าชนะตามค่า alpha ของมันเอง */
function over(dst, src, alpha) {
  if (alpha <= 0) return
  for (let i = 0; i < 3; i++) dst[i] = Math.round(dst[i] * (1 - alpha) + src[i] * alpha)
  dst[3] = Math.max(dst[3], alpha)
}

/* รถบรรทุกตู้เขียว หัวเก๋งครีม — โลโก้ที่เจ้าของระบบเลือก
   วาดด้วย SDF ล้วน ไม่พึ่ง dependency ภายนอก จึงรันได้ทุกเครื่องที่มี Node
   ถ้าต้องการรูปต้นฉบับเป๊ะ ๆ ให้วางไฟล์ที่ assets-src/logo.png แล้วสคริปต์จะใช้ไฟล์นั้นแทน */
function drawIcon(size, { bleed = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4)
  /* maskable ถูกครอบทีหลัง จึงต้องย่อรถลงมาให้มีขอบเหลือ ไม่งั้นหัวรถกับท้ายตู้โดนตัด */
  const k = bleed ? 0.78 : 1
  const at = (v) => 0.5 + (v - 0.5) * k

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / size
      const fy = (y + 0.5) / size
      /* พิกัดในระบบของรถ — ย้อนสเกลกลับ เพื่อให้สูตรทุกบรรทัดเขียนด้วยพิกัดชุดเดียว */
      const px = 0.5 + (fx - 0.5) / k
      const py = 0.5 + (fy - 0.5) / k

      const bgA = bleed ? 1 : aa(sdRoundRect(fx, fy, 0.5, 0.5, 0.5, 0.5, 0.22) * size)
      const c = [BG[0], BG[1], BG[2], 0]
      over(c, BG, bgA)

      /* เงาใต้ท้องรถ — บาง ๆ พอให้รถไม่ลอย */
      over(c, [232, 232, 236], aa((sdRoundRect(px, py, 0.52, 0.79, 0.33, 0.022, 0.022)) * size) * 0.7)

      /* ตู้สินค้า: ขอบเข้ม ตัวตู้เขียว ร่องแนวนอนห้าเส้นตามต้นฉบับ */
      over(c, GREEN_DARK, aa(sdRoundRect(px, py, 0.645, 0.455, 0.235, 0.205, 0.026) * size))
      over(c, GREEN, aa(sdRoundRect(px, py, 0.645, 0.455, 0.221, 0.191, 0.02) * size))
      for (const gy of [0.315, 0.385, 0.455, 0.525, 0.595]) {
        const inBox = aa(sdRoundRect(px, py, 0.645, 0.455, 0.214, 0.184, 0.018) * size)
        over(c, GREEN_LINE, Math.min(inBox, aa((Math.abs(py - gy) - 0.0075) * size)))
      }

      /* หัวเก๋ง: หลังคาแคบกว่าฐานเล็กน้อยเหมือนรูปต้นฉบับ */
      over(c, CREAM_LINE, aa(sdRoundRect(px, py, 0.255, 0.53, 0.155, 0.135, 0.04) * size))
      over(c, CREAM, aa(sdRoundRect(px, py, 0.255, 0.53, 0.143, 0.123, 0.034) * size))
      /* เงาใต้แนวประตู ทำให้หัวเก๋งไม่แบน */
      over(c, CREAM_SHADE, aa(sdRoundRect(px, py, 0.255, 0.625, 0.143, 0.028, 0.02) * size) * 0.9)
      /* กระจกหน้าและกระจกข้าง */
      over(c, GLASS_DARK, aa(sdRoundRect(px, py, 0.238, 0.474, 0.108, 0.062, 0.026) * size))
      over(c, GLASS, aa(sdRoundRect(px, py, 0.238, 0.47, 0.1, 0.054, 0.022) * size))
      /* ไฟหน้า */
      over(c, LAMP, aa(sdRoundRect(px, py, 0.126, 0.6, 0.022, 0.016, 0.008) * size))

      /* แชสซี — เส้นเข้มใต้ท้องรถ ผูกหัวเก๋งกับตู้ให้เป็นคันเดียวกัน */
      over(c, INK, aa(sdRoundRect(px, py, 0.5, 0.672, 0.36, 0.026, 0.012) * size))

      /* ล้อ — หน้าหนึ่ง หลังคู่ ตามรถหกล้อที่กองรถใช้จริง */
      for (const wx of [0.263, 0.612, 0.782]) {
        over(c, TIRE, aa(sdCircle(px, py, wx, 0.712, 0.088) * size))
        over(c, RIM_DARK, aa(sdCircle(px, py, wx, 0.712, 0.042) * size))
        over(c, RIM, aa(sdCircle(px, py, wx, 0.708, 0.034) * size))
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

/* ---------- อ่าน PNG (สำหรับโหมด "ใช้รูปจริง") ---------- */
/* รองรับ bit depth 8 ทุก color type ที่โปรแกรมแต่งรูปทั่วไปบันทึกออกมา
   (0 เทา, 2 RGB, 3 palette, 4 เทา+alpha, 6 RGBA) พอสำหรับไฟล์โลโก้ */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('ไม่ใช่ไฟล์ PNG')
  let pos = 8
  let w = 0, h = 0, depth = 0, type = 0
  let palette = null
  let trns = null
  const idat = []

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const tag = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (tag === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      type = data[9]
      if (data[12] !== 0) throw new Error('PNG แบบ interlace ยังไม่รองรับ — บันทึกใหม่แบบไม่ interlace')
    } else if (tag === 'PLTE') palette = Buffer.from(data)
    else if (tag === 'tRNS') trns = Buffer.from(data)
    else if (tag === 'IDAT') idat.push(Buffer.from(data))
    else if (tag === 'IEND') break
    pos += 12 + len
  }
  if (depth !== 8) throw new Error(`PNG ต้องเป็น 8 บิตต่อช่อง (ไฟล์นี้ ${depth}) — บันทึกใหม่เป็น 8 บิต`)

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]
  if (!channels) throw new Error(`PNG color type ${type} ไม่รองรับ`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * channels
  const out = Buffer.alloc(w * h * 4)
  const line = Buffer.alloc(stride)
  const prev = Buffer.alloc(stride)
  let rp = 0

  for (let y = 0; y < h; y++) {
    const filter = raw[rp++]
    raw.copy(line, 0, rp, rp + stride)
    rp += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v & 0xff
    }
    line.copy(prev)

    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const i = x * channels
      if (type === 0) { out[o] = out[o + 1] = out[o + 2] = line[i]; out[o + 3] = 255 }
      else if (type === 2) { out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = 255 }
      else if (type === 3) {
        const idx = line[i]
        out[o] = palette[idx * 3]; out[o + 1] = palette[idx * 3 + 1]; out[o + 2] = palette[idx * 3 + 2]
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255
      } else if (type === 4) { out[o] = out[o + 1] = out[o + 2] = line[i]; out[o + 3] = line[i + 1] }
      else { out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = line[i + 3] }
    }
  }
  return { width: w, height: h, data: out }
}

/** ย่อ/ขยายแบบ bilinear แล้ววางกลางกรอบสี่เหลี่ยมจัตุรัส
 *  รูปต้นฉบับมักไม่ใช่จัตุรัส การยืดให้เต็มกรอบทำให้รถผอมหรืออ้วนผิดส่วน */
function fitSquare(src, size, { bleed, pad }) {
  const bg = [246, 242, 254]
  const rgba = Buffer.alloc(size * size * 4)
  const inner = size * (1 - pad * 2)
  const scale = Math.min(inner / src.width, inner / src.height)
  const dw = src.width * scale
  const dh = src.height * scale
  const ox = (size - dw) / 2
  const oy = (size - dh) / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / size
      const fy = (y + 0.5) / size
      const bgA = bleed ? 1 : aa(sdRoundRect(fx, fy, 0.5, 0.5, 0.5, 0.5, 0.22) * size)
      const c = [bg[0], bg[1], bg[2], 0]
      over(c, bg, bgA)

      const sx = (x + 0.5 - ox) / scale
      const sy = (y + 0.5 - oy) / scale
      if (sx >= 0 && sy >= 0 && sx < src.width && sy < src.height) {
        const x0 = Math.min(src.width - 1, Math.max(0, Math.floor(sx - 0.5)))
        const y0 = Math.min(src.height - 1, Math.max(0, Math.floor(sy - 0.5)))
        const x1 = Math.min(src.width - 1, x0 + 1)
        const y1 = Math.min(src.height - 1, y0 + 1)
        const tx = Math.min(1, Math.max(0, sx - 0.5 - x0))
        const ty = Math.min(1, Math.max(0, sy - 0.5 - y0))
        const px = []
        for (let ch = 0; ch < 4; ch++) {
          const p00 = src.data[(y0 * src.width + x0) * 4 + ch]
          const p10 = src.data[(y0 * src.width + x1) * 4 + ch]
          const p01 = src.data[(y1 * src.width + x0) * 4 + ch]
          const p11 = src.data[(y1 * src.width + x1) * 4 + ch]
          px.push(lerp(lerp(p00, p10, tx), lerp(p01, p11, tx), ty))
        }
        over(c, [px[0], px[1], px[2]], (px[3] / 255) * Math.min(1, bgA + (bleed ? 1 : 0)))
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

const SOURCE = join(root, 'assets-src', 'logo.png')
const source = existsSync(SOURCE) ? decodePNG(readFileSync(SOURCE)) : null
if (source) console.log(`ใช้รูปจริงจาก assets-src/logo.png (${source.width}x${source.height})`)
else console.log('ไม่พบ assets-src/logo.png — วาดรถบรรทุกด้วยโค้ดแทน')

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-512-maskable.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
]

for (const { file, size } of targets) {
  /* maskable = เต็มกรอบ ไม่ตัดมุมเอง — Android ครอบรูปทรงของเครื่องทับอีกที
     ถ้าตัดมุมมาให้แล้ว จะโดนตัดซ้ำจนขอบรถแหว่ง */
  const bleed = file.includes('maskable')
  const pixels = source
    /* maskable ต้องเผื่อขอบให้ระบบครอบ — ของ Android ครอบได้ลึกถึง ~10% ของด้าน
       รูปที่ชิดขอบจะโดนตัดหัวรถหรือท้ายตู้ทิ้ง */
    ? fitSquare(source, size, { bleed, pad: bleed ? 0.18 : 0.08 })
    : drawIcon(size, { bleed })
  const png = encodePNG(size, size, pixels)
  writeFileSync(join(outDir, file), png)
  console.log(`✔ ${file} (${size}x${size}, ${png.length.toLocaleString()} bytes)`)
}
console.log('เสร็จ — ไอคอนอยู่ใน web/public/icons/')
