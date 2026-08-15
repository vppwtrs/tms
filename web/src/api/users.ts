import { supabase, unwrap, toDataError } from './supabase.js'
import type { UserRow, UserRole } from '../types/database.js'

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
