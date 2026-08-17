import { supabase } from './supabase.js'

export async function manageTestDataset(action: 'seed' | 'clear'): Promise<{ ok: boolean }> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/admin-test-dataset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string, Authorization: `Bearer ${token}` }, body: JSON.stringify({ action }),
  })
  const body = await res.json().catch(() => ({})) as { error?: string; ok?: boolean }
  if (!res.ok) throw new Error(body.error ?? 'จัดการชุดข้อมูลทดสอบไม่สำเร็จ')
  return { ok: body.ok === true }
}
