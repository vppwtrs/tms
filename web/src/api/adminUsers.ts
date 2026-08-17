import { supabase, toDataError, DataError } from './supabase.js'
import type { UserRole } from '../types/database.js'

/**
 * สร้างบัญชีผู้ใช้ / ตั้งรหัสใหม่ — คุยกับ Edge Function `admin-users`
 *
 * ทำไมไม่ยิงตารางตรงเหมือน api ตัวอื่น: การสร้างบัญชีใน `auth.users` ต้องใช้ `service_role`
 * ซึ่ง **ห้ามอยู่ใน frontend เด็ดขาด** (ข้าม RLS ทั้งหมด) ที่ของมันคือ secret ของฟังก์ชัน
 *
 * ต่างจาก users.ts ที่จัดการ "สิทธิ์ของบัญชีที่มีอยู่แล้ว" ไฟล์นี้จัดการ "การมีอยู่ของบัญชี"
 *
 * **รหัสที่ได้กลับมาโชว์ได้ครั้งเดียว** ไม่มีที่ไหนเก็บไว้ ปิดหน้าไปแล้วต้องกดตั้งใหม่
 * เจตนาคือไม่ให้มีรหัสของคนอื่นค้างอยู่ในระบบหรือในแชทของใคร
 */

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/admin-users`

async function call<T>(route: 'create' | 'reset-password', body: unknown): Promise<T> {
  /* ต้องส่ง token ของคนที่กดจริง ไม่ใช่ anon key — ฟังก์ชันเอา token นี้ไปถาม
     i_can('users.manage') ด้วยสิทธิ์ของคนนั้น ถ้าส่ง anon ไปจะถูกปฏิเสธที่ด่านแรก */
  const { data: s } = await supabase.auth.getSession()
  const token = s.session?.access_token
  if (!token) throw new DataError('401', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')

  const res = await fetch(`${FUNCTIONS_BASE}/${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* ไม่ใช่ json — ตกไปที่ข้อความด้านล่าง */
  }

  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error
    throw new DataError(String(res.status), msg ?? 'ทำรายการไม่สำเร็จ')
  }
  return data as T
}

export interface NewAccount {
  user: { user_id: number; driver_id: number | null }
  email: string
  /** โชว์ครั้งเดียว ไม่ถูกเก็บที่ไหนเลย */
  password: string
}

export async function createUser(input: {
  username: string
  name: string
  role: UserRole
  as_driver?: boolean
  phone?: string
  /** ผูกกับคนขับที่มีชื่อในระบบแล้ว (เช่นคนที่ถูกสร้างจากชื่อใน TMS) */
  driver_id?: number
}): Promise<NewAccount> {
  return call<NewAccount>('create', input)
}

export async function resetPassword(userId: number): Promise<{ username: string; password: string }> {
  return call<{ username: string; password: string }>('reset-password', { user_id: userId })
}

/** คนขับที่มีชื่อในระบบแต่ยังไม่มีบัญชีเข้าแอป — ถ้าไม่แสดงตรงนี้ เขาจะค้างแบบ
 *  "มีชื่ออยู่แต่เปิดแอปไม่ได้" โดยไม่มีใครเห็นว่ามีอยู่ */
export async function driversWithoutAccount(): Promise<
  { driver_id: number; name: string; phone: string | null }[]
> {
  const { data, error } = await supabase.rpc('drivers_without_account')
  if (error) throw toDataError(error)
  return (data ?? []) as { driver_id: number; name: string; phone: string | null }[]
}
