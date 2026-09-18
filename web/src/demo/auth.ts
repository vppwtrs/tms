/**
 * ตัวตนปลอมสำหรับโหมดสาธิต — แทน api/auth
 *
 * สองบัญชี รหัสเดียวกันหมด (1234) บัญชีเหล่านี้ไม่มีอยู่จริงที่ไหนทั้งสิ้น และไฟล์นี้
 * ไม่เคยถูกรวมเข้า build ปกติ (ดู vite.config.ts — alias เปิดเฉพาะ mode demo)
 *
 * บัญชี dispatcher ล็อกอินได้จริงและเห็นเมนูฝั่งออฟฟิศ แต่กดเข้าหน้า Dispatch/
 * Orders/Customers/Drivers/Vehicles แล้วจะพัง — หน้าพวกนั้นยิง api/* ตัวจริงซึ่ง
 * vite alias ของโหมดสาธิตไม่ได้แตะ (ดูรายชื่อ demoAliases ใน vite.config.ts)
 * ยังไม่มี mock data ให้ฝั่งนี้ ตั้งใจทำแค่ login/routing ตามที่ขอ
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

const DEMO_ACCOUNTS: Record<string, Profile> = {
  driver: {
    id: 9001,
    username: 'driver',
    name: 'คนขับ (สาธิต)',
    role: 'driver',
    mustChangePassword: false,
    authSource: 'local',
    /* ต้องตรงกับคีย์จริงใน utils/permissions.ts ไม่ใช่ชื่อที่เดาเอง
       ครั้งแรกใส่ 'pod.create' ซึ่งไม่มีอยู่จริง ปุ่มรับงานรายร้านจึงไม่ขึ้นเลย
       เพราะจอเช็ค can('myjobs.progress') */
    permissions: new Set(['myjobs.view', 'myjobs.progress', 'myjobs.pod']),
  },
  /* สิทธิ์ตามคำอธิบาย role ใน utils/permissions.ts ("ดูและจัดการงานขนส่งประจำวัน")
     ไม่รวม myjobs.* — คนวางแผนไม่ควรกดรับงาน/ปิดจุดส่งแทนคนขับ (เหตุผลเดียวกับที่
     migration driver_progress_perms ไม่แจก myjobs.progress ให้ dispatcher) และไม่รวม
     users.manage ซึ่งสงวนให้ admin เท่านั้น */
  dispatcher: {
    id: 9002,
    username: 'dispatcher',
    name: 'ผู้วางแผนงาน (สาธิต)',
    role: 'dispatcher',
    mustChangePassword: false,
    authSource: 'local',
    permissions: new Set([
      'dashboard.view',
      'customers.view', 'customers.write',
      'orders.view', 'orders.write',
      'dispatch.view', 'dispatch.write',
      'drivers.view', 'drivers.write',
      'vehicles.view', 'vehicles.write',
      'pod.view', 'pod.write', 'pod.verify',
    ]),
  },
}

export class PendingApprovalError extends Error {
  constructor(public readonly accountName: string) {
    super('บัญชีรออนุมัติ')
  }
}

const KEY = 'demo-signed-in'
/* จำบัญชีที่เพิ่งเข้าไว้ในตัวแปรแยก — โปรไฟล์ผูกกับ "ใครล็อกอิน" ไม่ใช่ค่าคงที่
   ตัวเดียวเหมือนตอนมีบัญชีเดียว */
const USER_KEY = 'demo-signed-in-user'

/* ถ่ายรูปหน้าจอบน iOS Simulator ใน CI พิมพ์รหัสเองไม่ได้ ตั้งค่านี้ตอน build
   แล้วแอปเปิดมาอยู่หลังล็อกอินเลย — อยู่ในไฟล์ของโหมดสาธิตซึ่ง vite ต่อให้
   เฉพาะ mode demo build ปกติจึงไม่มีไฟล์นี้ ไม่มีทางหลุดไปอยู่ในของจริง */
if (import.meta.env.VITE_DEMO_AUTOLOGIN === '1') {
  try {
    sessionStorage.setItem(KEY, '1')
    sessionStorage.setItem(USER_KEY, DEMO_USERNAME)
  } catch { /* jsdom ไม่มี sessionStorage */ }
}
const listeners = new Set<(signedIn: boolean) => void>()

function emit(signedIn: boolean): void {
  for (const fn of listeners) fn(signedIn)
}

export async function signIn(username: string, password: string): Promise<void> {
  const key = username.trim().toLowerCase()
  const account = DEMO_ACCOUNTS[key]
  if (!account || password !== '1234') {
    throw new Error(`โหมดสาธิต — เข้าด้วย driver / 1234 หรือ dispatcher / 1234`)
  }
  sessionStorage.setItem(KEY, '1')
  sessionStorage.setItem(USER_KEY, key)
  emit(true)
}

export async function signOut(): Promise<void> {
  sessionStorage.removeItem(KEY)
  sessionStorage.removeItem(USER_KEY)
  emit(false)
}

export async function loadProfile(): Promise<Profile | null> {
  if (!sessionStorage.getItem(KEY)) return null
  const key = sessionStorage.getItem(USER_KEY) ?? DEMO_USERNAME
  return DEMO_ACCOUNTS[key] ?? DEMO_ACCOUNTS[DEMO_USERNAME]!
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
