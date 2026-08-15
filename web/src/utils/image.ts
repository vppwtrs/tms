/**
 * บีบรูปก่อนส่งขึ้น server
 *
 * รูปจากกล้องมือถือรุ่นปัจจุบันใบละ 3–6MB ส่งจากในรถผ่าน 4G ไม่ไหว
 * ย่อด้านยาวสุดเหลือ 1600px + JPEG quality 0.7 แล้วเหลือราว 200–400KB
 * ซึ่งยังอ่านป้ายทะเบียน/สภาพสินค้า/ลายเซ็นบนใบส่งของได้ชัดอยู่
 *
 * ผลพลอยได้: การวาดผ่าน canvas ทำให้ EXIF หายไปทั้งชุด (รวมพิกัดที่กล้องฝังมา)
 * เราเก็บพิกัดจาก navigator.geolocation เองแทน — ควบคุมได้ว่าเก็บอะไรบ้าง
 */
const MAX_EDGE = 1600
const QUALITY = 0.7

export interface CompressedImage {
  blob: Blob
  /** URL สำหรับ preview — ผู้เรียกต้อง revokeObjectURL เมื่อเลิกใช้ */
  url: string
  width: number
  height: number
  bytes: number
}

/** ย่อ+บีบ canvas หรือรูปที่โหลดแล้ว ให้กลายเป็น JPEG ขนาดพอดีส่ง */
export async function compressToJpeg(source: CanvasImageSource, srcW: number, srcH: number): Promise<CompressedImage> {
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH))
  const width = Math.round(srcW * scale)
  const height = Math.round(srcH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('เบราว์เซอร์นี้ไม่รองรับการประมวลผลรูป')
  ctx.drawImage(source, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (!blob) throw new Error('บีบรูปไม่สำเร็จ')

  return { blob, url: URL.createObjectURL(blob), width, height, bytes: blob.size }
}

/** สำหรับรูปที่ได้จาก <input type="file"> (ทางสำรองเมื่อกล้องในหน้าเว็บใช้ไม่ได้) */
export async function compressFile(file: File): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file)
  try {
    return await compressToJpeg(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}
