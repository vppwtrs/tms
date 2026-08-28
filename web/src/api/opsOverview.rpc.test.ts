import { describe, expect, it, vi } from 'vitest'

/* ไคลเอนต์ปลอมที่พังแบบเดียวกับของจริงเมื่อเมธอดถูกเรียกแบบหลุดจากเจ้าของ
   ของจริงอ่าน this.rest ต่อข้างใน พอ this เป็น undefined จะได้
   "Cannot read properties of undefined (reading 'rest')" ซึ่งเคยขึ้นเต็มหน้าแรก
   โดยไม่มีอะไรบอกว่าต้นเหตุอยู่ตรงไหน */
const rest = { calls: [] as unknown[] }

vi.mock('./supabase', () => ({
  supabase: {
    rest,
    rpc(this: { rest: typeof rest } | undefined, fn: string, args: unknown) {
      /* จุดตายอยู่บรรทัดนี้ — เรียกแบบ const f = client.rpc แล้ว f() จะพังตรงนี้ */
      this!.rest.calls.push({ fn, args })
      return Promise.resolve({ data: { ok: true, fn }, error: null })
    },
  },
}))

const { opsOverview } = await import('./opsOverview')

describe('opsOverview เรียก RPC ผ่านตัวไคลเอนต์', () => {
  it('ต้องไม่ดึงเมธอดออกมาเรียกลอย ๆ', async () => {
    const out = await opsOverview('2026-08-28', '2026-08-28') as unknown as { ok: boolean }
    expect(out.ok).toBe(true)
    expect(rest.calls).toEqual([
      { fn: 'ops_overview', args: { p_from: '2026-08-28', p_to: '2026-08-28' } },
    ])
  })

  it('ไม่ส่งวันมา = null ทั้งคู่ ให้ฐานตัดสินว่าวันนี้คือวันไหน', async () => {
    rest.calls.length = 0
    await opsOverview()
    expect(rest.calls).toEqual([{ fn: 'ops_overview', args: { p_from: null, p_to: null } }])
  })
})
