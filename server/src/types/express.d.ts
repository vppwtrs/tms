import type { Role } from '../core/constants.js'

declare global {
  namespace Express {
    interface Request {
      /** ผู้ใช้ที่ผ่านการยืนยันตัวตนแล้ว (set โดย middleware auth) */
      user?: {
        id: number
        username: string
        name: string
        role: Role
      }
    }
  }
}

export {}
