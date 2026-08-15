import type { Request, Response, NextFunction } from 'express'
import type { ZodType } from 'zod'
import { err } from '../core/errors.js'

interface Schemas {
  body?: ZodType
  query?: ZodType
  params?: ZodType
}

/**
 * ตรวจสอบ payload ที่ boundary ทุกจุด — ข้อมูลที่ผิดจะถูกปฏิเสธก่อนถึง service
 * ข้อมูลที่ผ่านแล้วจะถูกแทนลง req (parsed, typed)
 *
 * หมายเหตุ: Express 5 กำหนด req.query เป็น getter-only (ESM strict mode ห้าม assign)
 * จึง mutate ค่าภายใน object เดิมแทนการ reassign
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {})
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query ?? {})
        const target = req.query as Record<string, unknown>
        for (const key of Object.keys(target)) delete target[key]
        Object.assign(target, parsed)
      }
      if (schemas.params) {
        const parsed = schemas.params.parse(req.params ?? {})
        const target = req.params as Record<string, unknown>
        for (const key of Object.keys(target)) delete target[key]
        Object.assign(target, parsed)
      }
      next()
    } catch (e) {
      const zodError = e as { issues?: { path: (string | number)[]; message: string }[] }
      const issues = zodError.issues ?? []
      const message = issues.length
        ? issues.map((i) => `${i.path.join('.') || 'ข้อมูล'}: ${i.message}`).join(', ')
        : 'ข้อมูลไม่ถูกต้อง'
      next(err.badRequest(message, 'VALIDATION_ERROR'))
    }
  }
}
