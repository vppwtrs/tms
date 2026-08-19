import { supabase, DataError } from './supabase.js'

/**
 * ล็อกอินฝั่งออฟฟิศด้วยบัญชี TMS บริษัท + ดึงข้อมูลจาก TMS
 *
 * ทั้งสองอย่างวิ่งผ่าน Edge Function `tms-gateway` ตัวเดียว
 * (supabase/functions/tms-gateway/index.ts — อ่านที่นั่นก่อนแก้อะไรตรงนี้)
 *
 * ทำไมไม่ยิงหา pdi.vespiario.net ตรง ๆ จากหน้าเว็บ:
 * CORS ของ TMS บล็อกทุกโดเมนที่ไม่ใช่ของเขา นี่คือเหตุผลเดียวที่ต้องมีตัวกลาง
 * ไม่ใช่เรื่องความปลอดภัยที่เราเลือกเอง
 *
 * ทำไมล็อกอิน TMS ถึงนับเป็นการยืนยันตัวตนของระบบเรา:
 * ล็อกอิน TMS ผ่าน = บริษัทรับรองแล้วว่าเป็นพนักงาน เราจึงไม่ต้องสร้างบัญชีอีกชุด
 * ให้คนจำสองรหัส แต่ "เป็นพนักงาน" ยังไม่เท่ากับ "ควรเห็นข้อมูลลูกค้า" —
 * บัญชีที่เกิดครั้งแรกจึงยังไม่มีสิทธิ์อะไรจนกว่า admin จะอนุมัติ (ดู 0010)
 *
 * คนขับไม่แตะไฟล์นี้เลย เขาใช้ signIn() ใน auth.ts ตามปกติ
 */

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/tms-gateway`

/* token ของ TMS อยู่ใน sessionStorage ไม่ใช่ localStorage — ต่างจาก session ของเราเอง
   เพราะนี่คือ token ของระบบบริษัท ปิดแท็บแล้วควรหาย ไม่ควรค้างในเครื่องข้ามวัน
   ผลที่ยอมรับ: เปิดแท็บใหม่ต้องล็อกอิน TMS ใหม่ถึงจะกดดึงข้อมูลได้
   แต่ session ของระบบเรายังอยู่ ใช้งานหน้าอื่นได้ตามปกติ */
const TMS_TOKEN_KEY = 'tmsToken'

export const getTmsToken = (): string | null => sessionStorage.getItem(TMS_TOKEN_KEY)
export const clearTmsToken = (): void => sessionStorage.removeItem(TMS_TOKEN_KEY)

/* token ของ TMS หมดอายุ = ตัวตนฝั่งบริษัทหมดอายุ ซึ่งเป็นสิ่งเดียวที่รับรองบัญชีออฟฟิศ
   ปล่อยให้อยู่หน้าเดิมแปลว่าเห็นข้อมูลค้างบนจอ กดอะไรก็ขึ้น error ทีละปุ่ม
   ยิงเหตุการณ์ออกไปให้ตัวจัดการ session พาออกไปหน้าล็อกอินทีเดียว

   ใช้ event ไม่ใช่ import ตรง เพราะไฟล์นี้เป็นชั้น API — ให้มันเรียก context ของ React
   คือผูกชั้นล่างเข้ากับชั้นบน แล้วเทสต์ชั้น API ต้องลาก React มาด้วยทั้งชุด */
export const TMS_EXPIRED_EVENT = 'tms-token-expired'

let expiredFired = false
export function signalTmsExpired(): void {
  clearTmsToken()
  /* ยิงครั้งเดียวต่อการหมดอายุหนึ่งครั้ง — รอบดึงข้อมูลยิงหลายคำขอซ้อนกัน
     ทุกตัวจะเจอ 401 พร้อมกัน ถ้ายิง event ทุกตัวก็เด้งซ้ำเป็นสิบรอบ */
  if (expiredFired) return
  expiredFired = true
  window.dispatchEvent(new CustomEvent(TMS_EXPIRED_EVENT))
}

/** เรียกหลังล็อกอินสำเร็จ — เปิดให้เตือนหมดอายุได้อีกครั้งในรอบถัดไป */
const armTmsExpiry = (): void => { expiredFired = false }

/** อายุที่เหลือของ token TMS เป็นวินาที — null = อ่านไม่ออกหรือไม่มี token
 *
 *  ใช้ตอบคำถามเดียว: ย้ายรอบซิงก์ไปฝั่งเซิร์ฟเวอร์แบบเก็บ token แทนรหัสผ่านได้ไหม
 *  token อายุสั้นแปลว่าต้องมีคนล็อกอินใหม่บ่อยจนไม่ต่างจากเปิดแท็บค้าง
 *  token อายุยาวแปลว่าคุ้มที่จะทำ และไม่ต้องเก็บรหัสผ่านของใครเลย
 *
 *  อ่านจาก payload ของ JWT ตรง ๆ ไม่ตรวจลายเซ็น — ตรงนี้ไม่ได้ใช้ตัดสินสิทธิ์อะไร
 *  แค่อ่านวันหมดอายุที่ TMS ประกาศมาเอง ตัวตัดสินจริงคือ TMS ที่ปฏิเสธ 401 */
export function tmsTokenSecondsLeft(token = getTmsToken()): number | null {
  if (!token) return null
  const part = token.split('.')[1]
  if (!part) return null
  try {
    /* base64url ไม่ใช่ base64 — ต้องแปลง - _ กลับก่อน ไม่งั้น atob โยน error
       กับ token ที่มีอักขระสองตัวนี้ ซึ่งเจอเมื่อไหร่ก็ไม่รู้ */
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = (JSON.parse(json) as { exp?: number }).exp
    if (typeof exp !== 'number') return null
    return Math.floor(exp - Date.now() / 1000)
  } catch {
    return null
  }
}

async function gateway<T>(route: 'auth' | 'call', body: unknown): Promise<T> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const res = await fetch(`${FUNCTIONS_BASE}/${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* ไม่ใช่ json — ปล่อยให้ตกไปที่ข้อความ error ด้านล่าง */
  }

  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error
    /* 401 จากเส้น call = TMS ปฏิเสธ token ไม่ใช่ปฏิเสธรหัสผ่าน (เส้น auth ต่างหาก)
       เป็นตัวตัดสินจริงว่าหมดอายุแล้ว ค่า exp ที่อ่านเองเป็นแค่การคาดการณ์ */
    if (route === 'call' && res.status === 401) {
      signalTmsExpired()
      throw new DataError('TMS_TOKEN_EXPIRED', 'การเข้าระบบ TMS หมดอายุ — เข้าสู่ระบบใหม่')
    }
    throw new DataError(String(res.status), msg ?? 'ติดต่อระบบ TMS ไม่ได้')
  }
  return data as T
}

export interface TmsAccount {
  id: number
  name: string
  role: string
  is_active: boolean
}

/** ล็อกอินด้วยบัญชี TMS — สำเร็จแล้วจะได้ session ของ Supabase ทันที
 *  คืน pending = true เมื่อบัญชียังไม่ถูก admin อนุมัติ (ล็อกอินได้แต่ยังไม่มีสิทธิ์อะไร) */
export async function signInWithTms(
  username: string,
  password: string,
  tenant = 'root',
): Promise<{ pending: boolean; account: TmsAccount | null }> {
  const r = await gateway<{
    session: { access_token: string; refresh_token: string }
    tms_token: string
    account: TmsAccount | null
    pending: boolean
  }>('auth', { username, password, tenant })

  /* ยัด session ที่ gateway ออกให้เข้า supabase-js เพื่อให้ทุก query หลังจากนี้
     มีตัวตนและ refresh ต่ออายุเองอัตโนมัติ เหมือนล็อกอินด้วยอีเมลปกติทุกประการ */
  const { error } = await supabase.auth.setSession({
    access_token: r.session.access_token,
    refresh_token: r.session.refresh_token,
  })
  if (error) throw new DataError('SESSION', 'รับ session ไม่สำเร็จ')

  sessionStorage.setItem(TMS_TOKEN_KEY, r.tms_token)
  armTmsExpiry()
  return { pending: r.pending, account: r.account }
}

/** ยิงคำขอ **อ่าน** ไปยัง TMS ผ่าน gateway
 *  path ที่ยิงได้ถูกล็อกไว้ในฝั่ง Edge Function แล้ว — ที่นี่แค่ส่งต่อ */
export async function tmsCall<T>(
  path: string,
  body?: unknown,
  method: 'GET' | 'POST' = 'POST',
): Promise<T> {
  const token = getTmsToken()
  if (!token) {
    signalTmsExpired()
    throw new DataError('NO_TMS_TOKEN', 'ยังไม่ได้เข้าสู่ระบบ TMS — ออกแล้วเข้าใหม่')
  }

  /* ตัดจบก่อนยิง ถ้า exp บอกว่าหมดแล้ว — ประหยัดคำขอที่รู้ผลอยู่แล้วว่า 401
     เผื่อ 30 วินาทีให้นาฬิกาเครื่องที่เดินคลาดจาก server ไม่ให้ตัดก่อนเวลาจริง */
  const left = tmsTokenSecondsLeft(token)
  if (left !== null && left <= -30) {
    signalTmsExpired()
    throw new DataError('TMS_TOKEN_EXPIRED', 'การเข้าระบบ TMS หมดอายุ — เข้าสู่ระบบใหม่')
  }

  return gateway<T>('call', { path, method, body, token })
}
