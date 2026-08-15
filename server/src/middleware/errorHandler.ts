import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../core/errors.js'

/** จุดเดียวที่แปลง error ทุกชนิดเป็น JSON ที่สม่ำเสมอ — ไม่มี try/catch กระจัดกระจาย */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } })
    return
  }

  // SQLite constraint violations → 409 ที่อ่านเข้าใจได้
  if (err instanceof Error && 'code' in err) {
    const code = (err as { code?: string }).code
    if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: { code: 'DUPLICATE', message: 'ข้อมูลซ้ำกันในระบบ (เช่น เลขทะเบียน เลขที่เอกสาร)' } })
      return
    }
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      res.status(409).json({ error: { code: 'IN_USE', message: 'ข้อมูลนี้ถูกใช้งานอยู่ ไม่สามารถลบได้' } })
      return
    }
  }

  console.error('[server-error]', err)
  res.status(500).json({ error: { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่' } })
}
