/** ที่เก็บสิทธิ์ระดับแอป — middleware เรียกใช้ได้โดยไม่ต้องส่ง db ผ่านทุกชั้น
 *
 *  ผูก db ครั้งเดียวตอน createApp() แล้ว requirePerm() เรียก getUserPermissions()
 *  ได้ตรง ๆ · better-sqlite3 เป็น synchronous + อ่านจากไฟล์ในเครื่อง คิวรีนี้จึงถูกมาก
 *  (ดัชนี primary key ของ user_permissions) ไม่ต้องทำ cache ให้เกิดปัญหา stale
 */
import type Database from 'better-sqlite3'
import { effectivePermissions, type Permission } from '../core/permissions.js'

let db: Database.Database | null = null

export function initPermissions(database: Database.Database): void {
  db = database
}

export function getUserOverrides(userId: number): Record<string, boolean> {
  if (!db) throw new Error('ยังไม่ได้เรียก initPermissions()')
  const rows = db
    .prepare(`SELECT permission, allowed FROM user_permissions WHERE user_id = ?`)
    .all(userId) as { permission: string; allowed: number }[]
  return Object.fromEntries(rows.map((r) => [r.permission, r.allowed === 1]))
}

/** บัญชียังเปิดใช้งานอยู่ไหม — token ที่ออกไปแล้วมีอายุ 12 ชม.
 *  ต้องเช็คทุก request ไม่งั้นปิดบัญชีแล้วยังใช้ต่อได้จนกว่า token จะหมดอายุ */
export function isUserActive(userId: number): boolean {
  if (!db) throw new Error('ยังไม่ได้เรียก initPermissions()')
  const row = db.prepare(`SELECT is_active FROM users WHERE id = ?`).get(userId) as { is_active: number } | undefined
  return row?.is_active === 1
}

/** สิทธิ์ที่ใช้จริง — คืน [] ถ้าบัญชีถูกปิดใช้งานหรือไม่มีอยู่แล้ว */
export function getUserPermissions(userId: number): Permission[] {
  if (!db) throw new Error('ยังไม่ได้เรียก initPermissions()')
  const user = db.prepare(`SELECT role, is_active FROM users WHERE id = ?`).get(userId) as
    | { role: string; is_active: number }
    | undefined
  if (!user || user.is_active !== 1) return []
  return effectivePermissions(user.role, getUserOverrides(userId))
}
