/**
 * บีบรูปก่อนส่งขึ้น server
 *
 * รูปจากกล้องมือถือรุ่นปัจจุบันใบละ 3–6MB ส่งจากในรถผ่าน 4G ไม่ไหว
 * ย่อด้านยาวสุดเหลือ 1600px แล้วเหลือราวไม่กี่ร้อย KB ซึ่งยังอ่านป้ายทะเบียน
 * สภาพสินค้า และตัวหนังสือบนใบส่งของได้ชัดอยู่
 *
 * เลือก WebP ก่อน JPEG เสมอเมื่อเครื่องเข้ารหัสได้ — ที่ความคมชัดเท่ากันมันเล็กกว่า
 * ราว 30-40% ซึ่งแปลว่าคนขับอัปเร็วขึ้นเท่านั้นจากในรถ และถังโตช้าลงเท่านั้น
 * โดยไม่ต้องแลกกับความอ่านออกของรูป
 *
 * ไม่ย่อให้เล็กกว่านี้และไม่ลดคุณภาพลงอีก เพราะสิ่งที่พังก่อนเพื่อนคือตัวหนังสือ
 * บนใบเซ็นรับ ซึ่งเป็นรูปที่ต้องใช้ตอบข้อโต้แย้งมากที่สุด
 *
 * ผลพลอยได้: การวาดผ่าน canvas ทำให้ EXIF หายไปทั้งชุด (รวมพิกัดที่กล้องฝังมา)
 * เราเก็บพิกัดจาก navigator.geolocation เองแทน — ควบคุมได้ว่าเก็บอะไรบ้าง
 */
const MAX_EDGE = 1600
/* WebP ที่ 0.72 ให้ภาพใกล้เคียง JPEG 0.7 แต่ไฟล์เล็กกว่ามาก
   ตัวเลขคนละสเกลกัน ใช้ค่าเดียวกันทั้งสองรูปแบบแล้ว WebP จะดูซอฟต์กว่าที่ควร */
const QUALITY_WEBP = 0.72
const QUALITY_JPEG = 0.7

export interface CompressedImage {
  blob: Blob
  /** นามสกุลไฟล์ที่ต้องใช้ตอนอัป — ขึ้นกับว่าเครื่องเข้ารหัส WebP ได้หรือไม่
   *  เก็บ path ผิดนามสกุลแล้วเบราว์เซอร์บางตัวไม่ยอมแสดงรูปตอนเปิดดูย้อนหลัง */
  ext: 'webp' | 'jpg'
  type: 'image/webp' | 'image/jpeg'
  /** URL สำหรับ preview — ผู้เรียกต้อง revokeObjectURL เมื่อเลิกใช้ */
  url: string
  width: number
  height: number
  bytes: number
}

/**
 * ประทับข้อความมุมขวาล่างของรูป
 *
 * รูปหลักฐานที่หลุดออกจากฐานไปแล้ว (ส่งไลน์ให้ลูกค้า แนบอีเมล เปิดจากโฟลเดอร์สำรอง
 * ในอีกสามปี) ไม่มีอะไรติดไปด้วยเลยว่าเป็นของร้านไหน วันไหน ถ่ายที่พิกัดไหน
 * ข้อมูลนั้นอยู่ในแถวของฐาน ซึ่งคนที่เปิดรูปตอนมีข้อโต้แย้งมักไม่มีสิทธิ์เข้าถึง
 *
 * วาดทับตอนบีบ ไม่ใช่ตอนแสดงผล — สิ่งที่แปะทีหลังบนหน้าจอ ไม่ติดไปกับไฟล์
 */
function stampCorner(ctx: CanvasRenderingContext2D, w: number, h: number, lines: string[]): void {
  /* ขนาดตัวอักษรผูกกับความกว้างของรูป ไม่ใช่ค่าคงที่ — รูปถูกย่อมาแล้วหลายขนาด
     ค่าคงที่จะใหญ่เกินบนรูปเล็กและเล็กจนอ่านไม่ออกบนรูปใหญ่ */
  const size = Math.max(11, Math.round(w * 0.026))
  const pad = Math.round(size * 0.6)
  const lh = Math.round(size * 1.32)
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'

  const boxW = Math.max(...lines.map((t) => ctx.measureText(t).width)) + pad * 2
  const boxH = lh * lines.length + pad
  const x = w - pad
  const top = h - boxH - pad

  /* แถบดำโปร่ง — ตัวหนังสือขาวล้วนอ่านไม่ออกบนรูปหน้าร้านกลางแดด
     และเงาตัวอักษรอย่างเดียวยังแพ้พื้นหลังลายจัด */
  ctx.fillStyle = 'rgba(0, 0, 0, 0.46)'
  ctx.fillRect(w - boxW - pad, top, boxW, boxH)
  ctx.fillStyle = '#fff'
  lines.forEach((text, i) => ctx.fillText(text, x, top + lh * (i + 1) - Math.round(lh * 0.25)))
}

/** ย่อ+บีบ canvas หรือรูปที่โหลดแล้ว ให้กลายเป็น JPEG ขนาดพอดีส่ง
 *  `stamp` = บรรทัดที่จะประทับมุมขวาล่าง (ร้าน วันเวลา พิกัด) */
export async function compressToJpeg(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  stamp?: string[],
): Promise<CompressedImage> {
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH))
  const width = Math.round(srcW * scale)
  const height = Math.round(srcH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('เบราว์เซอร์นี้ไม่รองรับการประมวลผลรูป')
  ctx.drawImage(source, 0, 0, width, height)
  if (stamp && stamp.length > 0) stampCorner(ctx, width, height, stamp)

  /* ถามด้วยการลองจริง ไม่ใช่เช็ครุ่นเบราว์เซอร์ — ตัวที่เข้ารหัส WebP ไม่ได้จะคืน
     PNG กลับมาเงียบ ๆ (ไม่ error) ซึ่งใหญ่กว่า JPEG หลายเท่า ต้องดูชนิดที่ได้จริง */
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY_WEBP))
  let ext: CompressedImage['ext'] = 'webp'
  let type: CompressedImage['type'] = 'image/webp'

  if (!blob || blob.type !== 'image/webp') {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY_JPEG))
    ext = 'jpg'
    type = 'image/jpeg'
  }
  if (!blob) throw new Error('บีบรูปไม่สำเร็จ')

  return { blob, ext, type, url: URL.createObjectURL(blob), width, height, bytes: blob.size }
}

/** สำหรับรูปที่ได้จาก <input type="file"> (ทางสำรองเมื่อกล้องในหน้าเว็บใช้ไม่ได้) */
export async function compressFile(file: File, stamp?: string[]): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file)
  try {
    return await compressToJpeg(bitmap, bitmap.width, bitmap.height, stamp)
  } finally {
    bitmap.close()
  }
}
