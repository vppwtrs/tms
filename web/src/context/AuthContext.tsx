import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, TOKEN_KEY } from '../api/client'
import type { User } from '../types'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  /** เช็คสิทธิ์สำหรับซ่อน/แสดงปุ่มและเมนู
   *  หมายเหตุ: นี่คือ "ความสะดวกสายตา" เท่านั้น — server บังคับสิทธิ์จริงทุก endpoint อยู่แล้ว */
  can: (perm: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // ตรวจสอบ token ที่มีอยู่ตอนเปิดแอป
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setLoading(false)
      return
    }
    api
      .get<User>('/auth/me')
      .then(setUser)
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false))
  }, [])

  // เมื่อ API คืน 401 (token หมดอายุ) → ล็อกเอาต์อัตโนมัติ
  useEffect(() => {
    setUnauthorizedHandler(() => {
      localStorage.removeItem(TOKEN_KEY)
      setUser(null)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const login = async (username: string, password: string): Promise<void> => {
    const result = await api.post<{ token: string; user: User }>('/auth/login', { username, password })
    localStorage.setItem(TOKEN_KEY, result.token)
    setUser(result.user)
  }

  const logout = (): void => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
  }

  const can = (perm: string): boolean => user?.permissions?.includes(perm) ?? false

  return <AuthContext.Provider value={{ user, loading, login, logout, can }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องใช้ภายใน AuthProvider')
  return ctx
}
