/** แทน api/tmsAuth ในโหมดสาธิต — ไม่มีการคุยกับ TMS ของบริษัทเลยแม้แต่ครั้งเดียว
 *  ทางเข้าฝั่งออฟฟิศจึงล้มทันที เหลือทางเดียวคือบัญชีคนขับสาธิต */
export interface TmsAccount { name: string; username: string }

export const TMS_EXPIRED_EVENT = 'tms-token-expired'

export const getTmsToken = (): string | null => null
export const clearTmsToken = (): void => {}
export function signalTmsExpired(): void {}
export function takeSignedOutReason(): string | null { return null }
export function tmsTokenSecondsLeft(): number | null { return null }

export async function signInWithTms(): Promise<{ pending: boolean; account: TmsAccount | null }> {
  throw new Error('โหมดสาธิตไม่ต่อกับ TMS ของบริษัท')
}

export async function tmsCall<T>(): Promise<T> {
  throw new Error('โหมดสาธิตไม่ต่อกับ TMS ของบริษัท')
}
