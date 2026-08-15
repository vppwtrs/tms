import multer from 'multer'
import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../core/errors.js'

/**
 * รับรูปหลักฐาน (POD) — ใช้ร่วมกันระหว่างฝั่งออฟฟิศ (/api/pod) และฝั่งคนขับ (/api/my-jobs)
 *
 * เก็บใน memory ก่อน แล้วค่อยเขียนลงดิสก์หลัง validate ผ่าน — ถ้ากฎธุรกิจ fail
 * จะได้ไม่มีไฟล์ขยะค้างในโฟลเดอร์
 *
 * ลิมิต 5MB เผื่อรูปจากกล้องมือถือรุ่นใหม่ที่ยังไม่ได้บีบ ฝั่งเว็บบีบเหลือ ~300KB
 * ก่อนส่งอยู่แล้ว (ดู web/src/utils/image.ts)
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true)
    else cb(new Error('รองรับเฉพาะไฟล์รูป JPG/PNG/WebP'))
  },
})

/**
 * ห่อ multer ให้ error กลายเป็น 400 ที่อ่านเข้าใจได้ (แทน 500)
 *
 * ปล่อยผ่านเมื่อ request ไม่ใช่ multipart ด้วย — ฝั่งคนขับส่งได้ทั้ง JSON (ไม่มีรูป)
 * และ multipart (มีรูป) บน endpoint เดียวกัน
 */
export function uploadPhoto(field = 'photo') {
  return (req: Request, res: Response, next: NextFunction): void => {
    upload.single(field)(req, res, (e: unknown) => {
      if (!e) {
        next()
        return
      }
      const msg = e instanceof Error ? e.message : 'อัปโหลดไฟล์ไม่สำเร็จ'
      next(e instanceof AppError ? e : new AppError(400, 'UPLOAD_ERROR', msg))
    })
  }
}
