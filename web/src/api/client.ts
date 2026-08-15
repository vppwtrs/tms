export const TOKEN_KEY = 'tms_token'

/**
 * ฐาน URL ของ API — ค่าเริ่มต้นชี้โดเมนเดียวกับหน้าเว็บ (relative)
 * สำหรับแอป native (Capacitor) หรือ deploy แยก server:
 *   VITE_API_BASE=https://tms.example.com  npm run build -w web
 */
// Vite แทรก import.meta.env ตอน build — กรณีรันนอก Vite (สคริปต์/เทส) ใช้ undefined → relative path
// __TMS_API_BASE__ เปิดให้สคริปต์ (static export) กำหนด base ได้ตอน runtime
const runtimeBase = typeof globalThis !== 'undefined' ? (globalThis as { __TMS_API_BASE__?: string }).__TMS_API_BASE__ : undefined
const API_BASE = ((import.meta.env as { VITE_API_BASE?: string } | undefined)?.VITE_API_BASE as string | undefined) ?? runtimeBase ?? ''

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let unauthorizedHandler: (() => void) | null = null

/** ลงทะเบียน callback เมื่อเจอ 401 (ใช้โดย AuthContext เพื่อเตะออกไปหน้า login) */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn
}

interface ApiEnvelope<T> {
  data: T
  meta?: { pagination?: { total: number; totalPages: number } }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiEnvelope<T>> {
  const token = localStorage.getItem(TOKEN_KEY)
  // FormData ต้องปล่อยให้เบราว์เซอร์ใส่ Content-Type เอง (มี boundary ต่อท้าย)
  // ถ้าเราตั้ง application/json ทับ multer จะแยกไฟล์ไม่ออก
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  })

  if (res.status === 401) {
    unauthorizedHandler?.()
  }
  if (!res.ok) {
    let message = 'เกิดข้อผิดพลาด กรุณาลองใหม่'
    try {
      const json = (await res.json()) as { error?: { message?: string } }
      message = json.error?.message ?? message
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, 'REQUEST_FAILED', message)
  }
  if (res.status === 204) return { data: undefined as T }
  return (await res.json()) as ApiEnvelope<T>
}

export const api = {
  get: async <T>(path: string): Promise<T> => (await request<T>('GET', path)).data,
  post: async <T>(path: string, body?: unknown): Promise<T> => (await request<T>('POST', path, body)).data,
  put: async <T>(path: string, body?: unknown): Promise<T> => (await request<T>('PUT', path, body)).data,
  patch: async <T>(path: string, body?: unknown): Promise<T> => (await request<T>('PATCH', path, body)).data,
  delete: async <T>(path: string): Promise<T> => (await request<T>('DELETE', path)).data,
}

/** สำหรับ list API ที่มี pagination — คืนข้อมูล + meta */
export async function apiList<T>(path: string): Promise<{ list: T[]; total: number; totalPages: number }> {
  const env = await request<T[]>('GET', path)
  return {
    list: env.data,
    total: env.meta?.pagination?.total ?? 0,
    totalPages: env.meta?.pagination?.totalPages ?? 1,
  }
}

/** อัปโหลด multipart (POD: ลายเซ็น/รูปหลักฐาน) — อย่าตั้ง Content-Type เอง (browser ใส่ boundary ให้) */
export async function apiUpload<T>(method: 'POST' | 'PUT', path: string, form: FormData): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (res.status === 401) {
    unauthorizedHandler?.()
  }
  if (!res.ok) {
    let message = 'เกิดข้อผิดพลาด กรุณาลองใหม่'
    try {
      const json = (await res.json()) as { error?: { message?: string } }
      message = json.error?.message ?? message
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, 'REQUEST_FAILED', message)
  }
  const json = (await res.json()) as { data: T }
  return json.data
}

/** ดาวน์โหลดไฟล์ (เช่น รายงาน Excel) — ผ่าน fetch พร้อม token แล้ว trigger download ในเบราว์เซอร์ */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (res.status === 401) {
    unauthorizedHandler?.()
  }
  if (!res.ok) {
    throw new Error('ดาวน์โหลดไฟล์ไม่สำเร็จ')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** โหลดรูปหลักฐาน POD (ต้องล็อกอิน — ผ่าน fetch พร้อม token แล้วแปลงเป็น blob URL) */
export async function fetchPodPhoto(id: number): Promise<string> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}/api/pod/${id}/photo`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('โหลดรูปหลักฐานไม่สำเร็จ')
  return URL.createObjectURL(await res.blob())
}
