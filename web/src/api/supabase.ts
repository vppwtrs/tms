import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.js'

/**
 * ตัวเชื่อม Supabase — แทนที่ Express ที่เคยอยู่ตรงกลาง
 *
 * anon key ตัวนี้ "เปิดเผย" โดยตั้งใจ มันฝังอยู่ใน bundle ที่ใครก็เปิดอ่านได้
 * และนั่นถูกต้องแล้ว — มันไม่ใช่ความลับ เป็นแค่ตัวบอกว่าเรายิงไปโปรเจ็คไหน
 * ด่านกันข้อมูลจริงคือ RLS ในฐานข้อมูล (supabase/migrations/0003_rls.sql)
 *
 * ห้ามเอา service_role key มาใส่ที่นี่เด็ดขาด — มันข้าม RLS ทั้งหมด
 * ตัวนั้นอยู่ได้แค่ใน Edge Function secret เท่านั้น
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error(
    'ไม่พบ VITE_SUPABASE_URL หรือ VITE_SUPABASE_ANON_KEY — คัดลอก .env.example เป็น .env แล้วใส่ค่าจาก Supabase dashboard',
  )
}

export const supabase: SupabaseClient<Database> = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    /* อ่าน session จาก URL เฉพาะตอนกลับมาจาก OAuth — ปิดไว้ก่อนเพราะยังใช้ email/password
       เปิดเมื่อไหร่ที่ต่อ SSO ของบริษัท */
    detectSessionInUrl: false,
  },
})

/** ข้อความ error จาก Postgres/PostgREST -> ข้อความไทยที่ผู้ใช้อ่านรู้เรื่อง
 *  รูปแบบ error ของระบบเดิมคือ { error: { code, message } } ข้อความไทย — คงรูปแบบเดิมไว้ */
export class DataError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DataError'
  }
}

const MESSAGES: Record<string, string> = {
  /* RLS ปฏิเสธ insert/update — ไม่ใช่ bug แต่คือสิทธิ์ไม่พอ */
  '42501': 'ไม่มีสิทธิ์ทำรายการนี้',
  '23505': 'ข้อมูลซ้ำกับที่มีอยู่แล้ว',
  '23503': 'ข้อมูลที่อ้างถึงไม่มีอยู่จริง',
  P0002: 'ไม่พบข้อมูลที่ต้องการ',
}

export function toDataError(err: unknown): DataError {
  const e = err as { code?: string; message?: string; details?: string } | null
  if (!e) return new DataError('UNKNOWN', 'เกิดข้อผิดพลาด กรุณาลองใหม่')

  /* ฟังก์ชันฝั่งคนขับ raise ข้อความไทยมาเอง (P0001) — ส่งต่อตรง ๆ ไม่ต้องแปล */
  if (e.code === 'P0001' && e.message) return new DataError(e.code, e.message)

  const known = e.code ? MESSAGES[e.code] : undefined
  if (!known) return new DataError(e.code ?? 'UNKNOWN', e.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่')

  /* ข้อความไทยบอกว่า "เกิดอะไร" แต่ไม่บอกว่า "ที่ไหน" — คำว่าข้อมูลซ้ำอย่างเดียว
     ทำให้ไล่หาสาเหตุไม่ได้เลย ต้องเปิด SQL Editor ไปเดาว่าซ้ำที่ตารางไหนคอลัมน์ไหน
     Postgres บอกชื่อ constraint มาอยู่แล้วใน details/message ต่อท้ายไปด้วย
     คนใช้งานอ่านข้ามได้ ส่วนคนแก้ปัญหาได้คำตอบทันทีโดยไม่ต้องรื้อฐาน */
  const detail = (e.details ?? e.message ?? '').trim()
  return new DataError(e.code ?? 'UNKNOWN', detail ? `${known} (${detail})` : known)
}

/* ผลลัพธ์ของ supabase-js เป็น union ระหว่างสำเร็จกับล้มเหลว ไม่ใช่ { data: T | null }
   ถ้าประกาศพารามิเตอร์เป็น { data: T | null } TypeScript จะ infer T ได้เป็น never
   เพราะฝั่งล้มเหลวมี data: null ล้วน — ต้องเขียนเป็น union ให้ตรงรูปเดิม */
type QueryResult<T> = { data: T; error: null } | { data: null; error: unknown }

/** ครอบ query ของ supabase-js ให้ throw เป็น DataError แทนการคืน { data, error }
 *  ทุกที่ในแอปควรเรียกผ่านตัวนี้ จะได้ไม่มีใครลืมเช็ค error แล้วใช้ data ที่เป็น null */
/* คืน NonNullable เพราะบรรทัดข้างบนตัด null ทิ้งไปแล้ว — .single() ประกาศผลเป็น Row | null
   ถ้าคืน T ตรง ๆ ทุก call site ของ .single() จะต้องเช็ค null ซ้ำทั้งที่เช็คไปแล้วตรงนี้ */
export async function unwrap<T>(q: PromiseLike<QueryResult<T>>): Promise<NonNullable<T>> {
  const { data, error } = await q
  if (error) throw toDataError(error)
  if (data === null) throw new DataError('EMPTY', 'ไม่พบข้อมูลที่ต้องการ')
  return data as NonNullable<T>
}

/** สำหรับ query ที่ผลลัพธ์ว่างได้ตามปกติ (เช่น หา POD ของออเดอร์ที่ยังไม่มี) */
export async function unwrapMaybe<T>(q: PromiseLike<QueryResult<T>>): Promise<T | null> {
  const { data, error } = await q
  if (error) throw toDataError(error)
  return data
}
