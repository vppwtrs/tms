import type { Request, Response, NextFunction } from 'express'
import { jwtVerify } from 'jose'
import { config } from '../config.js'
import { err } from '../core/errors.js'
import { ROLES, type Role } from '../core/constants.js'
import { PERMISSION_LABEL, type Permission } from '../core/permissions.js'
import { getUserPermissions, isUserActive } from '../db/permissions.js'

const secret = new TextEncoder().encode(config.jwtSecret)

interface TokenPayload {
  sub: string
  username: string
  name: string
  role: Role
}

export function extractToken(req: Request): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice(7)
}

/** ต้องล็อกอิน — ตรวจ JWT และ attach req.user */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req)
    if (!token) throw err.unauthorized()
    const { payload } = await jwtVerify(token, secret)
    const role = payload.role as Role
    /* อ่านจาก ROLES เสมอ — รายชื่อที่พิมพ์ซ้ำตรงนี้เคยทำให้บทบาทใหม่ล็อกอินไม่ได้ */
    if (!role || !(ROLES as readonly string[]).includes(role)) throw err.unauthorized()
    if (!isUserActive(Number(payload.sub))) {
      throw err.unauthorized('บัญชีนี้ถูกปิดการใช้งาน ติดต่อผู้ดูแลระบบ', 'ACCOUNT_DISABLED')
    }
    req.user = {
      id: Number(payload.sub),
      username: payload.username as string,
      name: payload.name as string,
      role,
    }
    next()
  } catch (e) {
    if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'ERR_JWT_EXPIRED') {
      next(err.unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', 'SESSION_EXPIRED'))
    } else {
      next(e instanceof Error && 'status' in e ? e : err.unauthorized())
    }
  }
}

/** ต้องมีสิทธิ์ตามที่ระบุ (ครบทุกข้อ) — ใช้ต่อจาก requireAuth
 *  อ่านสิทธิ์จากฐานข้อมูลทุกครั้ง ไม่ฝังไว้ใน JWT เพราะ token มีอายุ 12 ชม.
 *  ถ้าฝังไว้ การถอนสิทธิ์จะไม่มีผลจนกว่าผู้ใช้จะล็อกอินใหม่ */
export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(err.unauthorized())
      return
    }
    const owned = getUserPermissions(req.user.id)
    const missing = perms.filter((p) => !owned.includes(p))
    if (missing.length > 0) {
      next(err.forbidden(`ไม่มีสิทธิ์: ${missing.map((p) => PERMISSION_LABEL[p]).join(' · ')}`))
      return
    }
    next()
  }
}

/** จำกัดบทบาท — ใช้ต่อจาก requireAuth */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(err.forbidden())
      return
    }
    next()
  }
}

/** อนุญาตเฉพาะ read — ใช้กับทุก route ที่ต้องมีสิทธิ์แก้ไข */
export function requireWrite(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(err.unauthorized())
    return
  }
  if (req.user.role === 'viewer') {
    next(err.forbidden('บัญชีผู้ใช้งานนี้เป็นโหมดดูอย่างเดียว'))
    return
  }
  next()
}
