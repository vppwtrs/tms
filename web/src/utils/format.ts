/** ฟังก์ชันจัดรูปแบบภาษาไทย — วันที่/เวลา/เงิน/น้ำหนัก */

const dateFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const longDateFmt = new Intl.DateTimeFormat('th-TH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const timeFmt = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' })
const monthShortFmt = new Intl.DateTimeFormat('th-TH', { month: 'short' })
const dayShortFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric' })

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return dateFmt.format(d)
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return dateTimeFmt.format(d)
}

/* เวลาอย่างเดียว — ในรายการจุดส่งของคนขับ วันที่ซ้ำกันทุกบรรทัดจนอ่านไม่ทัน
   สิ่งที่ต้องเทียบคือ "ร้านนี้กี่โมง" เทียบกับร้านถัดไป */
export function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return timeFmt.format(d)
}

export function fmtLongToday(date = new Date()): string {
  return longDateFmt.format(date)
}

export function fmtMoney(value: number, symbol = '฿'): string {
  return `${new Intl.NumberFormat('th-TH').format(value)} ${symbol}`
}

export function fmtNum(value: number): string {
  return new Intl.NumberFormat('th-TH').format(value)
}

export function fmtWeight(kg: number): string {
  return `${fmtNum(kg)} กก.`
}

/** น้ำหนักแบบคนอ่าน — 1,000 กก. ขึ้นไปแสดงเป็น "ตัน" (เช่น 4.1 ตัน แทน 4,065 กก.) */
export function fmtWeightHuman(kg: number): string {
  if (kg >= 1000) {
    const t = kg / 1000
    return `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 }).format(t)} ตัน`
  }
  return `${fmtNum(kg)} กก.`
}

export function fmtKm(km: number): string {
  return `${fmtNum(km)} กม.`
}

/** ระยะทาง + เวลาเดินทางโดยประมาณ (รถบรรทุกเฉลี่ย ~65 กม./ชม.) — "380 กม. (≈ 6 ชม.)" */
export function fmtRoute(km: number): string {
  if (km <= 0) return '—'
  const hours = km / 65
  /* ปัดเป็นครึ่งชั่วโมง — ค่านี้เป็นแค่ค่าประมาณจากความเร็วเฉลี่ย
     การบอก "10 ชม. 46 นาที" ให้ความแม่นยำลวง แถมยาวจนตารางแตกบรรทัด */
  const time = hours < 1 ? `${Math.round(hours * 60)} นาที` : `${Math.round(hours * 2) / 2} ชม.`
  return `${fmtNum(km)} กม. · ≈ ${time}`
}

/** ป้ายกำกับแกนเดือนของกราฟ เช่น "ส.ค." */
export function fmtMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return monthShortFmt.format(new Date(y, m - 1, 1))
}

export function fmtDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return dayShortFmt.format(d)
}

/** วันที่ของวันนี้ในรูปแบบ ISO (YYYY-MM-DD) สำหรับ input[type=date] */
export function todayIso(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return todayIso(d)
}

/** เวลาท้องถิ่นของ ISO string เป็น YYYY-MM-DD (ตามเขตเวลาผู้ใช้) */
export function isoToDateInput(iso: string): string {
  const d = new Date(iso)
  return todayIso(d)
}

/** แปลงค่า input[type=date] (YYYY-MM-DD) เป็น ISO datetime ที่ใช้ได้กับ API */
export function dateInputToIso(dateStr: string, hour = 12): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1, hour, 0, 0)
  return date.toISOString()
}

/** ตัวย่อชื่อผู้ใช้สำหรับ avatar */
export function initials(name: string): string {
  return name.trim().slice(0, 1) || '?'
}
