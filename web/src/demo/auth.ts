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
  /* คนขับตัวจริงมีสิทธิ์ชุดเล็ก ๆ ชุดนี้เลียนแบบไว้เท่าที่จอคนขับใช้ */
  permissions: new Set(['myjobs.view', 'pod.create']),
}

export class PendingApprovalError extends Error {
  constructor(public readonly accountName: string) {
    super('บัญชีรออนุมัติ')
  }
}

const KEY = 'demo-signed-in'
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
