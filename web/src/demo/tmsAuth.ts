/** แทน api/tmsAuth ในโหมดสาธิต — ไม่มีการคุยกับ TMS ของบริษัทเลยแม้แต่ครั้งเดียว
 *  ทางเข้าฝั่งออฟฟิศจึงล้มทันที เหลือทางเดียวคือบัญชีคนขับสาธิต */
export interface TmsAccount { name: string; username: string }

export const TMS_EXPIRED_EVENT = 'tms-token-expired'

export const clearTmsToken = (): void => {}
export function signalTmsExpired(): void {}
export function takeSignedOutReason(): string | null { return null }
export function tmsTokenSecondsLeft(): number | null { return null }

export type TmsOp = 'warehouses' | 'myWarehouses' | 'pickingLists' | 'trips' | 'tripPickingList'

export async function signInWithTms(): Promise<{ pending: boolean; account: TmsAccount | null }> {
  throw new Error('โหมดสาธิตไม่ต่อกับ TMS ของบริษัท')
}

export async function tmsOp<T>(): Promise<T> {
  throw new Error('โหมดสาธิตไม่ต่อกับ TMS ของบริษัท')
}
