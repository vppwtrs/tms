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

/* ===== token ของ TMS ไม่อยู่ในเบราว์เซอร์อีกแล้ว (27 ส.ค. 69) =====
   เดิมเก็บใน sessionStorage โดยให้เหตุผลว่า "ปิดแท็บแล้วควรหาย" ซึ่งลดความเสี่ยง
   ได้จริงแต่ไม่ได้ปิดรูที่สำคัญกว่า: XSS จุดเดียวในเว็บเรา อ่าน sessionStorage ได้
   ทันทีระหว่างที่แท็บยังเปิดอยู่ = token ที่เข้าถึงข้อมูลภายในบริษัทหลุดออกไป

   ตอนนี้ token อยู่ในตาราง tms_sessions ฝั่งเซิร์ฟเวอร์ ที่แม้แต่เจ้าตัวก็อ่านไม่ได้
   (RLS เปิด ไม่มี policy สักอัน) gateway หยิบเองจากคนที่ยืนยันตัวแล้ว
   ที่นี่เหลือเก็บแค่ "หมดอายุเมื่อไหร่" ซึ่งไม่ใช่ความลับ ใช้ขึ้นป้ายเตือนอย่างเดียว

   ผลพลอยได้: เปิดแท็บใหม่ไม่ต้องล็อกอิน TMS ซ้ำอีกแล้ว ของจริงอยู่ฝั่งเซิร์ฟเวอร์
   จึงเก็บวันหมดอายุใน localStorage ไม่ใช่ sessionStorage เพื่อให้ทุกแท็บเห็นตรงกัน */
const TMS_EXPIRES_KEY = 'tms-expires-at'

const readExpiry = (): number | null => {
  try {
    const v = Number(localStorage.getItem(TMS_EXPIRES_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null   /* โหมดส่วนตัวของ Safari โยน error ตอนแตะที่เก็บ */
  }
}

const writeExpiry = (epochSeconds: number | null): void => {
  try {
    if (epochSeconds) localStorage.setItem(TMS_EXPIRES_KEY, String(epochSeconds))
    else localStorage.removeItem(TMS_EXPIRES_KEY)
  } catch {
    /* เขียนไม่ได้ก็ยังใช้งานได้ แค่ไม่มีป้ายเตือนก่อนหมดเวลา */
  }
}

/** ตัดการเชื่อมต่อ TMS — เรียกตอนล็อกเอาต์
 *  ลบฝั่งเบราว์เซอร์ทันที แล้วบอกเซิร์ฟเวอร์ให้ลบของจริงตามไป
 *  ไม่ await เพราะตัวเรียกกำลังพาผู้ใช้ออกจากระบบ ไม่ควรค้างรอเน็ต และถ้าคำขอนี้
 *  ล้ม แถวที่ค้างก็หมดอายุแล้วถูกกวาดทิ้งอยู่ดี */
export const clearTmsToken = (): void => {
  writeExpiry(null)
  void gateway('disconnect', {}).catch(() => {})
}

/* เหตุผลที่ถูกพาออกมา — หน้าล็อกอินอ่านค่านี้แล้วลบทิ้ง
   เก็บใน sessionStorage ไม่ใช่ state เพราะการเด้งออกทำให้ component ที่รู้เรื่องถูกถอด
   ไปแล้ว และเก็บที่นี่ไม่ใช่ที่ context เพราะฝั่งที่รู้สาเหตุจริงคือชั้น API ตัวนี้ */
const TMS_EXPIRED_REASON_KEY = 'tms-signed-out-reason'
export function takeSignedOutReason(): string | null {
  const v = sessionStorage.getItem(TMS_EXPIRED_REASON_KEY)
  if (v) sessionStorage.removeItem(TMS_EXPIRED_REASON_KEY)
  return v
}

/* token ของ TMS หมดอายุ = ตัวตนฝั่งบริษัทหมดอายุ ซึ่งเป็นสิ่งเดียวที่รับรองบัญชีออฟฟิศ
   ปล่อยให้อยู่หน้าเดิมแปลว่าเห็นข้อมูลค้างบนจอ กดอะไรก็ขึ้น error ทีละปุ่ม
   ยิงเหตุการณ์ออกไปให้ตัวจัดการ session พาออกไปหน้าล็อกอินทีเดียว

   ใช้ event ไม่ใช่ import ตรง เพราะไฟล์นี้เป็นชั้น API — ให้มันเรียก context ของ React
   คือผูกชั้นล่างเข้ากับชั้นบน แล้วเทสต์ชั้น API ต้องลาก React มาด้วยทั้งชุด */
export const TMS_EXPIRED_EVENT = 'tms-token-expired'

let expiredFired = false
export function signalTmsExpired(): void {
  /* ลบแค่วันหมดอายุฝั่งเบราว์เซอร์ ไม่ยิง disconnect — ทางที่มาถึงตรงนี้คือ
     gateway ลบแถวฝั่งเซิร์ฟเวอร์ไปแล้ว ยิงซ้ำได้แต่เปลืองคำขอเปล่า */
  writeExpiry(null)
  /* ยิงครั้งเดียวต่อการหมดอายุหนึ่งครั้ง — รอบดึงข้อมูลยิงหลายคำขอซ้อนกัน
     ทุกตัวจะเจอ 401 พร้อมกัน ถ้ายิง event ทุกตัวก็เด้งซ้ำเป็นสิบรอบ */
  if (expiredFired) return
  expiredFired = true
  sessionStorage.setItem(
    TMS_EXPIRED_REASON_KEY,
    'การเชื่อมต่อกับ TMS หมดอายุแล้ว ระบบจึงพาออกมาเพื่อความปลอดภัย — เข้าสู่ระบบใหม่ได้เลย',
  )
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
export function tmsTokenSecondsLeft(): number | null {
  const exp = readExpiry()
  return exp === null ? null : Math.floor(exp - Date.now() / 1000)
}

async function gateway<T>(route: 'auth' | 'call' | 'disconnect', body: unknown): Promise<T> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

  /* เส้น auth ยังไม่มีตัวตน ใช้ anon key ได้อย่างเดียว แต่เส้น call ต้องส่ง session
     ของคนที่ล็อกอินอยู่จริง — ฝั่ง Edge Function เอาไปเช็คว่าบัญชีนี้ถูกอนุมัติ
     และยังไม่ถูกปิด ก่อนจะยอมส่งต่อคำขอไปหา TMS
     anon key ใช้แทนไม่ได้ เพราะมันอยู่ใน bundle ที่ใครเปิดหน้าเว็บก็หยิบไปได้ */
  let bearer = anonKey
  if (route !== 'auth') {
    const { data } = await supabase.auth.getSession()
    if (!data.session) throw new DataError('SESSION', 'ต้องเข้าสู่ระบบก่อน')
    bearer = data.session.access_token
  }

  const res = await fetch(`${FUNCTIONS_BASE}/${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${bearer}`,
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
    /* 409 = ยังไม่เคยเชื่อมกับ TMS ในรอบนี้ ต่างจากหมดอายุ ไม่ใช่เหตุให้เด้งออกทั้งระบบ
       เกิดกับบัญชีคนขับที่บังเอิญเปิดหน้าฝั่งออฟฟิศ หรือคนที่เพิ่งล็อกเอาต์ TMS
       ปล่อยให้เป็น error ของหน้านั้นหน้าเดียว ตามเหตุผลเดียวกับ NO_TMS_TOKEN เดิม */
    if (route === 'call' && res.status === 409) {
      throw new DataError(
        'NO_TMS_TOKEN',
        msg ?? 'หน้านี้ต้องต่อกับ TMS แต่ยังไม่ได้เชื่อม — ออกจากระบบแล้วเข้าใหม่หนึ่งครั้ง',
      )
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
/* tenant ไม่รับจากที่นี่แล้ว — ตรึงไว้ฝั่ง Edge Function เพราะค่าที่ client
   กำหนดได้ ถูกยัดใส่ header ที่ยิงไปหาบริษัทตรง ๆ เปิดให้ไล่หา tenant อื่นได้ */
export async function signInWithTms(
  username: string,
  password: string,
): Promise<{ pending: boolean; account: TmsAccount | null }> {
  const r = await gateway<{
    session: { access_token: string; refresh_token: string }
    tms_expires_at: number | null
    account: TmsAccount | null
    pending: boolean
  }>('auth', { username, password })

  /* ยัด session ที่ gateway ออกให้เข้า supabase-js เพื่อให้ทุก query หลังจากนี้
     มีตัวตนและ refresh ต่ออายุเองอัตโนมัติ เหมือนล็อกอินด้วยอีเมลปกติทุกประการ */
  const { error } = await supabase.auth.setSession({
    access_token: r.session.access_token,
    refresh_token: r.session.refresh_token,
  })
  if (error) throw new DataError('SESSION', 'รับ session ไม่สำเร็จ')

  writeExpiry(r.tms_expires_at)
  armTmsExpiry()
  return { pending: r.pending, account: r.account }
}

/** ชื่องานที่ยิงไปหา TMS ได้ — ตัวจริงที่แปลงเป็น path อยู่ใน Edge Function
 *
 *  ที่นี่ไม่มี path ของบริษัทอยู่เลยโดยตั้งใจ ของเดิมส่ง path มาจากหน้าเว็บ
 *  ซึ่งแปลว่าโครงสร้าง API ภายในบริษัททั้งชุดถูกคอมไพล์ติดไปกับ bundle
 *  ใครเปิด devtools ก็อ่านได้ว่ามี endpoint อะไร รับ body หน้าตายังไง */
export type TmsOp =
  | 'warehouses'
  | 'myWarehouses'
  | 'pickingLists'
  | 'trips'
  | 'tripPickingList'
  /* งานแบบวนหลายรอบ — ลูปอยู่ใน Edge Function ไม่ใช่ที่นี่
     วัดจาก log จริง: ลูปฝั่งเบราว์เซอร์ยิง 8 คำขอเรียงกัน ใบละ 600-1300ms
     เพราะทุกใบเดินทาง เบราว์เซอร์ → โซล → TMS ที่ไทย → กลับ
     ย้ายลูปไปฝั่งโน้นแล้วขาที่ยาวที่สุดวิ่งอยู่ในเซิร์ฟเวอร์ เหลือคำขอเดียวจากจอ */
  | 'scanPickingLists'
  | 'scanTrips'
  | 'scanTripPickingLists'

/** ยิงคำขอ **อ่าน** ไปยัง TMS ผ่าน gateway
 *  งานที่ยิงได้ กับจำนวนต่อหน้า ถูกล็อกไว้ฝั่ง Edge Function แล้ว — ที่นี่แค่ส่งชื่องาน */
export async function tmsOp<T>(op: TmsOp, params?: Record<string, unknown>): Promise<T> {
  /* ไม่มี token ให้ตรวจที่นี่แล้ว — ของจริงอยู่ฝั่งเซิร์ฟเวอร์ ตัวที่รู้ว่ามีหรือไม่มี
     คือ gateway ซึ่งตอบ 409 NO_TMS_SESSION มาให้ (ดูการแปลงเป็น error ใน gateway())

     ค่าที่อ่านได้ที่นี่เป็นแค่วันหมดอายุที่จำไว้ ใช้ตัดจบก่อนยิงคำขอที่รู้ผลอยู่แล้ว
     ว่าจะโดนปฏิเสธ เผื่อ 30 วินาทีให้นาฬิกาที่เดินคลาดกัน ไม่ให้ตัดก่อนเวลาจริง
     อ่านไม่ได้ (เปิดแท็บใหม่ ล้างที่เก็บ) ก็ยิงไปเลย ให้เซิร์ฟเวอร์เป็นคนตัดสิน */
  const left = tmsTokenSecondsLeft()
  if (left !== null && left <= -30) {
    signalTmsExpired()
    throw new DataError('TMS_TOKEN_EXPIRED', 'การเข้าระบบ TMS หมดอายุ — เข้าสู่ระบบใหม่')
  }

  return gateway<T>('call', { op, params })
}
