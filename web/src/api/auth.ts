import { supabase, unwrap, toDataError, DataError } from './supabase.js'
import type { UserRow } from '../types/database.js'

/**
 * ตัวตนและสิทธิ์ — แทน server/src/modules/auth + middleware/auth.ts
 *
 * ต่างจากของเดิมตรงที่ session ไม่ใช่ JWT ที่เราออกเอง แต่เป็นของ Supabase Auth
 * ซึ่ง refresh ให้อัตโนมัติและเก็บใน localStorage ให้เอง — ไม่ต้องมี TOKEN_KEY อีกแล้ว
 *
 * สิ่งที่ยังเหมือนเดิมเป๊ะคือ "สิทธิ์ที่ใช้จริง = preset ของบทบาท ∪ เปิดเพิ่ม − ปิดไว้"
 * แต่ตัวที่บังคับใช้จริงคือ RLS ในฐานข้อมูล ไม่ใช่โค้ดตรงนี้
 * รายการสิทธิ์ที่โหลดมานี่ **ใช้ซ่อน/แสดงปุ่มเท่านั้น** ห้ามเอาไปใช้แทนการป้องกัน
 */

export interface Profile {
  id: number
  username: string
  name: string
  role: UserRow['role']
  permissions: ReadonlySet<string>
}

export async function signIn(username: string, password: string): Promise<void> {
  /* ระบบเดิมล็อกอินด้วย username ไม่ใช่อีเมล — Supabase Auth ต้องการอีเมล
     จึงแปลงเป็นอีเมลภายในโดเมนสมมติ ตอนสร้างผู้ใช้ก็ใช้กติกาเดียวกัน (ดู scripts/link-auth-users.mjs) */
  const email = username.includes('@') ? username : `${username}@${AUTH_DOMAIN}`
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    /* ไม่บอกว่า "ไม่มีผู้ใช้นี้" หรือ "รหัสผิด" แยกกัน — บอกแยกคือการยืนยันให้คนเดาว่า username ไหนมีจริง */
    throw new DataError('AUTH_FAILED', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
  }
}

export const AUTH_DOMAIN = 'tms.local'

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

/** บัญชีที่ล็อกอินได้แต่ยังไม่ถูกอนุมัติ — ต่างจาก "ล็อกอินไม่ผ่าน" คนละเรื่องกัน
 *  ต้องแยกให้ออก ไม่งั้นพนักงานใหม่จะเจอ "รหัสผิด" ทั้งที่รหัสถูก แล้วลองใหม่ทั้งวัน */
export class PendingApprovalError extends DataError {
  constructor(public readonly accountName: string) {
    super('PENDING_APPROVAL', 'บัญชีนี้รอผู้ดูแลอนุมัติ — แจ้งหัวหน้าให้เปิดสิทธิ์ให้')
  }
}

/** โหลดโปรไฟล์ + สิทธิ์ของคนที่ล็อกอินอยู่ — คืน null ถ้ายังไม่ได้ล็อกอิน */
export async function loadProfile(): Promise<Profile | null> {
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) return null

  /* RLS users_self_select ทำให้ query นี้คืนได้แค่แถวของตัวเองอยู่แล้ว
     ไม่ต้องใส่ .eq('auth_id', ...) ให้ซ้ำซ้อน แต่ใส่ .maybeSingle() เผื่อ auth_id ยังไม่ถูกผูก

     ไม่ผ่าน unwrapMaybe() ตรงนี้เพราะ .maybeSingle() คืน union ที่ทำให้ TypeScript
     infer generic ไม่ออก (ได้ never) — เขียนเช็ค error เองชัดกว่าไปฝืน type helper */
  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, name, role')
    .maybeSingle()
  if (error) throw toDataError(error)

  if (!user) {
    /* users_self_select ใช้ current_user_id() ซึ่งกรอง is_active อยู่ — แถวจึงหายไป
       ได้สองสาเหตุที่ต่างกันมาก: (ก) รออนุมัติ/ถูกระงับ (ข) ยังไม่ผูก auth_id
       ถามผ่าน my_account() ที่อ่านจาก auth.uid() ตรง ๆ เพื่อแยกให้ออก
       ถ้าไม่แยก พนักงานใหม่จะเห็นข้อความชวนให้เข้าใจผิดว่าบัญชีพัง */
    const { data: acct } = await supabase.rpc('my_account')
    if (acct && acct.found && !acct.is_active) throw new PendingApprovalError(acct.name)

    await signOut()
    throw new DataError('NO_PROFILE', 'บัญชีนี้ยังไม่ได้ผูกกับผู้ใช้ในระบบ ติดต่อผู้ดูแล')
  }

  return { ...user, permissions: await loadPermissions(user.id, user.role) }
}

async function loadPermissions(userId: number, role: UserRow['role']): Promise<ReadonlySet<string>> {
  const [preset, overrides] = await Promise.all([
    unwrap(supabase.from('role_permissions').select('permission').eq('role', role)),
    unwrap(supabase.from('user_permissions').select('permission, allowed').eq('user_id', userId)),
  ])

  const set = new Set(preset.map((p) => p.permission))
  for (const o of overrides) {
    if (o.allowed) set.add(o.permission)
    else set.delete(o.permission)
  }
  return set
}

/** ฟังการเปลี่ยนสถานะล็อกอิน (หมดอายุ, ล็อกเอาต์จากแท็บอื่น) — ใช้ใน AuthContext */
export function onAuthChange(fn: (signedIn: boolean) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => fn(!!session))
  return () => data.subscription.unsubscribe()
}

export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw toDataError(error)
}
