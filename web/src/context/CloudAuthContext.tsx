import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  loadProfile, signIn, signOut, onAuthChange,
  PendingApprovalError, type Profile,
} from '../api/auth'
import { signInWithTms, clearTmsToken, TMS_EXPIRED_EVENT } from '../api/tmsAuth'

/**
 * ตัวตนฝั่ง Supabase — ตัวแทนของ AuthContext เดิมที่คุยกับ Express
 *
 * ยังไม่ถูกเรียกจากหน้าจอ ตั้งใจให้เป็นแบบนั้นระหว่างย้าย
 * (ดู CLAUDE.md — ระบบเดิมยังต้องรันได้ปกติจนกว่าจะย้ายครบ)
 *
 * ต่างจากของเดิมสามเรื่อง:
 *   1. มีสองทางเข้า — พนักงานออฟฟิศใช้บัญชี TMS บริษัท คนขับใช้อีเมล/รหัสผ่านของเรา
 *   2. ไม่มี TOKEN_KEY ให้จัดการเอง supabase-js เก็บและต่ออายุ session ให้
 *   3. มีสถานะ "รออนุมัติ" ซึ่งไม่ใช่ทั้งเข้าได้และเข้าไม่ได้ — ต้องบอกผู้ใช้ให้ถูก
 */

interface CloudAuthValue {
  user: Profile | null
  loading: boolean
  /** ชื่อคนที่ล็อกอินผ่านแต่ยังไม่ถูกอนุมัติ — null เมื่อไม่ได้อยู่ในสถานะนั้น */
  pendingName: string | null
  loginDriver: (email: string, password: string) => Promise<void>
  loginOffice: (username: string, password: string, tenant?: string) => Promise<void>
  logout: () => Promise<void>
  /** โหลดโปรไฟล์ใหม่ — ใช้หลังเปลี่ยนสิ่งที่อยู่ในแถว users เช่นธงบังคับตั้งรหัสใหม่ */
  refreshProfile: () => Promise<void>
  /** ซ่อน/แสดงปุ่มเท่านั้น — ตัวบังคับสิทธิ์จริงคือ RLS ในฐานข้อมูล */
  can: (perm: string) => boolean
}

const Ctx = createContext<CloudAuthValue | null>(null)

export function CloudAuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<Profile | null>(null)
  const [pendingName, setPendingName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async (): Promise<void> => {
    try {
      setUser(await loadProfile())
      setPendingName(null)
    } catch (err) {
      setUser(null)
      setPendingName(err instanceof PendingApprovalError ? err.accountName : null)
      /* PendingApprovalError จงใจไม่ signOut — ต้องคง session ไว้ให้หน้าจอ
         ถามซ้ำได้หลัง admin กดอนุมัติ โดยผู้ใช้ไม่ต้องพิมพ์รหัสใหม่ */
    } finally {
      setLoading(false)
    }
  }

  /* token ของ TMS หมดอายุ = ตัวตนฝั่งบริษัทหมดอายุ ซึ่งเป็นสิ่งเดียวที่รับรองบัญชีออฟฟิศ
     ต้องพาออกไปหน้าล็อกอินทันที ไม่ใช่ปล่อยให้เห็นข้อมูลค้างบนจอแล้วกดอะไรก็ error
     คนขับไม่โดน — เขาไม่มี token ของ TMS ตั้งแต่แรก */
  useEffect(() => {
    const onExpired = (): void => { void logout() }
    window.addEventListener(TMS_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(TMS_EXPIRED_EVENT, onExpired)
  }, [])

  useEffect(() => {
    void refresh()
    /* session หมดอายุ หรือล็อกเอาต์จากแท็บอื่น — โหลดโปรไฟล์ใหม่เสมอ
       ไม่ใช่แค่ setUser(null) เพราะเหตุการณ์นี้เกิดตอน refresh token สำเร็จด้วย */
    return onAuthChange(() => void refresh())
  }, [])

  const loginDriver = async (email: string, password: string): Promise<void> => {
    await signIn(email, password)
    await refresh()
  }

  const loginOffice = async (username: string, password: string, tenant?: string): Promise<void> => {
    const { pending, account } = await signInWithTms(username, password, tenant)
    if (pending) {
      setUser(null)
      setPendingName(account?.name ?? username)
      setLoading(false)
      return
    }
    await refresh()
  }

  const logout = async (): Promise<void> => {
    clearTmsToken()
    await signOut()
    setUser(null)
    setPendingName(null)
  }

  /* users.manage เป็นสิทธิ์สงวน ไม่ใช่ permission ที่แจกให้คนขับ/ผู้วางแผนงานได้
     ต่อให้มีแถว override หลุดมา ก็ห้ามเปิดหน้าจัดการผู้ใช้หรือเรียก workflow admin */
  const can = (perm: string): boolean => {
    if (perm === 'users.manage' && user?.role !== 'admin') return false
    return user?.permissions.has(perm) ?? false
  }

  return (
    <Ctx.Provider value={{ user, loading, pendingName, loginDriver, loginOffice, logout, refreshProfile: refresh, can }}>
      {children}
    </Ctx.Provider>
  )
}

export function useCloudAuth(): CloudAuthValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCloudAuth ต้องใช้ภายใน CloudAuthProvider')
  return ctx
}
