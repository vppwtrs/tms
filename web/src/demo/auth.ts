/**
 * ตัวตนปลอมสำหรับโหมดสาธิต — แทน api/auth
 *
 * รับรหัสเดียว: driver / 1234 บัญชีนี้ไม่มีอยู่จริงที่ไหนทั้งสิ้น และไฟล์นี้
 * ไม่เคยถูกรวมเข้า build ปกติ (ดู vite.config.ts — alias เปิดเฉพาะ mode demo)
 */
import type { UserRow } from '../types/database.js'

export interface Profile {
  id: number
  username: string
  name: string
  role: UserRow['role']
  mustChangePassword: boolean
  authSource: 'local' | 'tms'
  permissions: ReadonlySet<string>
}

export const AUTH_DOMAIN = 'tms.local'

export const DEMO_USERNAME = 'driver'
export const DEMO_PASSWORD = '1234'

const DEMO_PROFILE: Profile = {
  id: 9001,
  username: DEMO_USERNAME,
  name: 'คนขับ (สาธิต)',
  role: 'driver',
  mustChangePassword: false,
  authSource: 'local',
  /* ต้องตรงกับคีย์จริงใน utils/permissions.ts ไม่ใช่ชื่อที่เดาเอง
     ครั้งแรกใส่ 'pod.create' ซึ่งไม่มีอยู่จริง ปุ่มรับงานรายร้านจึงไม่ขึ้นเลย
     เพราะจอเช็ค can('myjobs.progress') */
  permissions: new Set(['myjobs.view', 'myjobs.progress', 'myjobs.pod']),
}

export class PendingApprovalError extends Error {
  constructor(public readonly accountName: string) {
    super('บัญชีรออนุมัติ')
  }
}

const KEY = 'demo-signed-in'

/* ถ่ายรูปหน้าจอบน iOS Simulator ใน CI พิมพ์รหัสเองไม่ได้ ตั้งค่านี้ตอน build
   แล้วแอปเปิดมาอยู่หลังล็อกอินเลย — อยู่ในไฟล์ของโหมดสาธิตซึ่ง vite ต่อให้
   เฉพาะ mode demo build ปกติจึงไม่มีไฟล์นี้ ไม่มีทางหลุดไปอยู่ในของจริง */
if (import.meta.env.VITE_DEMO_AUTOLOGIN === '1') {
  try { sessionStorage.setItem(KEY, '1') } catch { /* jsdom ไม่มี sessionStorage */ }
}
const listeners = new Set<(signedIn: boolean) => void>()

function emit(signedIn: boolean): void {
  for (const fn of listeners) fn(signedIn)
}

export async function signIn(username: string, password: string): Promise<void> {
  const ok = username.trim().toLowerCase() === DEMO_USERNAME && password === DEMO_PASSWORD
  if (!ok) throw new Error(`โหมดสาธิต — เข้าด้วย ${DEMO_USERNAME} / ${DEMO_PASSWORD}`)
  sessionStorage.setItem(KEY, '1')
  emit(true)
}

export async function signOut(): Promise<void> {
  sessionStorage.removeItem(KEY)
  emit(false)
}

export async function loadProfile(): Promise<Profile | null> {
  return sessionStorage.getItem(KEY) ? DEMO_PROFILE : null
}

export function onAuthChange(fn: (signedIn: boolean) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export async function changeMyPassword(): Promise<void> {
  throw new Error('เปลี่ยนรหัสผ่านไม่ได้ในโหมดสาธิต')
}

export async function changePassword(): Promise<void> {
  throw new Error('เปลี่ยนรหัสผ่านไม่ได้ในโหมดสาธิต')
}
