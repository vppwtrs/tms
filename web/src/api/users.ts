import { supabase, unwrap, toDataError } from './supabase.js'
import type { PermissionAuditRow, PermissionMode, UserPermissionRow, UserRow, UserRole } from '../types/database.js'

/**
 * จัดการผู้ใช้ + อนุมัติพนักงานที่ล็อกอินเข้ามาผ่าน TMS
 *
 * ต่างจากระบบเดิมตรงที่ **ไม่มีการสร้างบัญชีพนักงานออฟฟิศจากหน้านี้แล้ว**
 * บัญชีเกิดเองตอนคนนั้นล็อกอิน TMS ครั้งแรก (ดู tms-gateway) หน้าที่ของ admin
 * เหลือแค่ตัดสินว่าจะให้สิทธิ์ระดับไหน หรือไม่ให้เลย
 *
 * ทำไมถึงดีกว่าเดิม: ไม่มีใครต้องตั้งรหัสผ่านให้คนอื่น ซึ่งเป็นวิธีที่รหัสรั่วบ่อยที่สุด
 * (พิมพ์ในแชท ส่งไลน์ จดใส่กระดาษ) และพนักงานที่ลาออกแล้วถูกปิดบัญชีที่ TMS
 * ก็ล็อกอินระบบเราไม่ได้ทันที โดยไม่มีใครต้องจำไปกดปิดซ้ำ
 */

export async function listUsers(): Promise<UserRow[]> {
  /* RLS users_manage_select ปล่อยให้เห็นทุกแถวเฉพาะคนที่มี users.manage
     คนอื่นจะได้แค่แถวตัวเอง — ไม่ต้องกรองซ้ำตรงนี้ */
  return unwrap(supabase.from('users').select('*').order('is_active').order('name'))
}

/** คนที่ล็อกอินเข้ามาแล้วแต่ยังไม่มีใครตัดสินใจ — จอ admin ควรเด้งเตือนเมื่อมีคนค้าง */
export async function listPending(): Promise<UserRow[]> {
  return unwrap(
    supabase.from('users').select('*').eq('is_active', false).order('last_login_at', { ascending: false }),
  )
}

/** อนุมัติ + กำหนดบทบาทในคำสั่งเดียว — 0010 อธิบายว่าทำไมแยกทำสองขั้นไม่ได้ */
export async function approveUser(userId: number, role: UserRole): Promise<void> {
  const { error } = await supabase.rpc('approve_user', { p_user_id: userId, p_role: role })
  if (error) throw toDataError(error)
}

/** ระงับ — ไม่ลบแถว เพราะออเดอร์/เที่ยวเก่าอ้างถึงคนนี้อยู่ */
export async function revokeUser(userId: number): Promise<void> {
  const { error } = await supabase.rpc('revoke_user', { p_user_id: userId })
  if (error) throw toDataError(error)
}

export async function updateUserRole(userId: number, role: UserRole): Promise<void> {
  const { data: s } = await supabase.auth.getSession()
  const token = s.session?.access_token
  if (!token) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/admin-change-role`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: userId, role }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? 'เปลี่ยนกลุ่มสิทธิ์ไม่สำเร็จ')
  }
}

export async function listPermissionCatalog(): Promise<{ permission: string; label: string }[]> {
  return unwrap(supabase.from('permissions').select('permission, label').order('permission'))
}

export async function listUserPermissions(userId: number): Promise<UserPermissionRow[]> {
  return unwrap(supabase.rpc('effective_permissions', { p_user_id: userId }))
}

export async function listUserPermissionOverrides(userId: number): Promise<UserPermissionRow[]> {
  return unwrap(supabase.from('user_permissions').select('user_id, permission, allowed, mode').eq('user_id', userId))
}

/** สิทธิ์รายคน override บทบาท — admin เท่านั้นตาม RLS user_permissions */
export async function saveUserPermission(userId: number, permission: string, mode: PermissionMode): Promise<void> {
  const { error } = await supabase.rpc('admin_save_user_permission', { p_user_id: userId, p_permission: permission, p_mode: mode })
  if (error) throw toDataError(error)
}

export async function resetUserPermissions(userId: number): Promise<void> {
  const { error } = await supabase.rpc('admin_reset_user_permissions', { p_user_id: userId })
  if (error) throw toDataError(error)
}

export async function listRolePermissions(role: UserRole): Promise<string[]> {
  const rows = await unwrap(supabase.from('role_permissions').select('permission').eq('role', role))
  return rows.map((row) => row.permission)
}

export async function saveRolePermission(role: UserRole, permission: string, allowed: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_role_permission', { p_role: role, p_permission: permission, p_allowed: allowed })
  if (error) throw toDataError(error)
}

export async function listPermissionAudit(): Promise<PermissionAuditRow[]> {
  return unwrap(supabase.from('permission_audit_log').select('*').order('created_at', { ascending: false }).limit(30))
}

export async function seedRolePermissionPresets(): Promise<Record<string, number>> {
  const { data: s } = await supabase.auth.getSession()
  const token = s.session?.access_token
  if (!token) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/admin-seed-role-presets`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string, Authorization: `Bearer ${token}` },
  })
  const body = await res.json().catch(() => ({})) as { error?: string; groups?: Record<string, number> }
  if (!res.ok) throw new Error(body.error ?? 'ตั้งค่ากลุ่มสิทธิ์ไม่สำเร็จ')
  return body.groups ?? {}
}
