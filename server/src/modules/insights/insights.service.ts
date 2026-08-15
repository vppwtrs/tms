import { startOfDay } from '../../utils/helpers.js'
import { InsightsRepository } from './insights.repository.js'

export type InsightTone = 'info' | 'warn' | 'danger' | 'success'

export interface InsightItem {
  tone: InsightTone
  title: string
  detail: string
  action?: { label: string; to: string }
}

export interface DailyInsight {
  headline: string
  items: InsightItem[]
  generated_at: string
}

const MAX_ITEMS = 6
const QUOTE_EXPIRY_DAYS = 3
const AT_RISK_DAYS = 30

/**
 * "AI สรุปประจำวัน" — สังเคราะห์ข้อมูลจริงจากทุกโมดูล (ออเดอร์/เที่ยว/ใบเสนอราคา/ลูกค้า/ทรัพยากร)
 * เป็นข้อความสรุป + next-best-action (ตามแนว Attio/Hex)
 * หมายเหตุ: เป็น rule-based engine (กำหนดตายตัว ไม่เรียก LLM ภายนอก — ต่อยอด API ได้ในอนาคต)
 */
export class InsightsService {
  constructor(private readonly repo: InsightsRepository) {}

  daily(): DailyInsight {
    const now = new Date()
    const nowIso = now.toISOString()
    const todayStart = startOfDay(now)
    const tomorrow = new Date(todayStart)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const yesterday = new Date(todayStart)
    yesterday.setDate(yesterday.getDate() - 1)

    const cutoff = new Date(now.getTime() + QUOTE_EXPIRY_DAYS * 86400000)

    const pressure = this.repo.orderPressure()
    const quotes = this.repo.expiringQuotes(cutoff.toISOString())
    const sentQuotes = this.repo.sentQuoteCount()
    const atRisk = this.repo.atRiskCustomers(AT_RISK_DAYS)
    const avail = this.repo.availability()
    const delivered = this.repo.deliveredToday(todayStart.toISOString(), tomorrow.toISOString(), yesterday.toISOString())

    const items: InsightItem[] = []

    /* --- ระดับอันตราย (ต้องจัดการก่อน) --- */
    if (pressure.overdue > 0) {
      items.push({
        tone: 'danger',
        title: 'ออเดอร์เลยกำหนด',
        detail: `มีออเดอร์เลยกำหนดส่ง ${pressure.overdue} ใบที่ยังไม่จัดคิว/ยังไม่ส่ง — ลูกค้าอาจต่อว่าถ้าปล่อยไว้นาน`,
        action: { label: 'ไปจัดการ', to: '/dispatch' },
      })
    }
    if (pressure.urgent_unassigned > 0) {
      items.push({
        tone: 'danger',
        title: 'ออเดอร์ด่วนยังไม่จัดคิว',
        detail: `มีออเดอร์ด่วน ${pressure.urgent_unassigned} ใบรอจับคู่รถ-คนขับ — จัดคิวเป็นชุดแรกของวันเพื่อให้ทันกำหนด`,
        action: { label: 'ไปแผนงาน', to: '/dispatch' },
      })
    }

    const nowMs = now.getTime()
    const alreadyExpired = quotes.filter((q) => new Date(q.valid_until).getTime() < nowMs)
    if (alreadyExpired.length > 0) {
      const names = alreadyExpired.slice(0, 2).map((q) => q.customer_name ?? q.quote_no).join(' · ')
      items.push({
        tone: 'danger',
        title: 'ใบเสนอราคาหมดอายุแล้ว',
        detail: `${alreadyExpired.length} ใบเลยกำหนด (${names}) — ติดต่อลูกค้าเพื่อต่ออายุราคาก่อนเสียโอกาส`,
        action: { label: 'ดูใบเสนอราคา', to: '/quotes' },
      })
    }

    /* --- ระดับเตือน (ควรจัดการ) --- */
    const expiringSoon = quotes.filter((q) => new Date(q.valid_until).getTime() >= nowMs)
    if (expiringSoon.length > 0) {
      const names = expiringSoon.slice(0, 2).map((q) => q.customer_name ?? q.quote_no).join(' · ')
      const nearest = Math.min(...expiringSoon.map((q) => Math.max(1, Math.ceil((new Date(q.valid_until).getTime() - nowMs) / 86400000))))
      items.push({
        tone: 'warn',
        title: 'ใบเสนอราคาใกล้หมดอายุ',
        detail: `${expiringSoon.length} ใบจะหมดอายุภายใน ${QUOTE_EXPIRY_DAYS} วัน (${names}) — ใบที่ใกล้สุดเหลืออีก ${nearest} วัน โทรติดตามเพื่อปิดการขาย`,
        action: { label: 'ติดตาม', to: '/quotes' },
      })
    }
    if (atRisk.length > 0) {
      const names = atRisk.slice(0, 2).map((c) => c.name).join(' · ')
      items.push({
        tone: 'warn',
        title: 'ลูกค้าเงียบเกิน 30 วัน',
        detail: `ลูกค้า ${atRisk.length} รายเคยใช้บริการแต่ไม่มีการติดต่ออีก (${names}) — เสี่ยงย้ายไปใช้คู่แข่ง`,
        action: { label: 'ดูรายชื่อ', to: '/customers' },
      })
    }

    const hasResources = avail.vehicles_total > 0 || avail.drivers_total > 0
    const vehRatio = avail.vehicles_available / Math.max(1, avail.vehicles_total)
    const drvRatio = avail.drivers_available / Math.max(1, avail.drivers_total)
    if (hasResources && (vehRatio < 0.35 || drvRatio < 0.35)) {
      items.push({
        tone: 'warn',
        title: 'ทรัพยากรกำลังแน่น',
        detail: `รถว่าง ${avail.vehicles_available}/${avail.vehicles_total} คัน · คนขับว่าง ${avail.drivers_available}/${avail.drivers_total} คน — วางแผนเที่ยวล่วงหน้าเพื่อไม่ให้คิวตัน`,
        action: { label: 'ดูทรัพยากร', to: '/vehicles' },
      })
    }

    /* --- ระดับข้อมูล (ติดตามปกติ) --- */
    const awaiting = Math.max(0, sentQuotes - quotes.length)
    if (awaiting > 0) {
      items.push({
        tone: 'info',
        title: 'รอลูกค้าตอบกลับใบเสนอราคา',
        detail: `มีใบเสนอราคา ${awaiting} ใบที่ส่งแล้วยังไม่มีการตอบกลับ — วนติดตามตามรอบ`,
        action: { label: 'ติดตาม', to: '/quotes' },
      })
    }
    if (avail.trips_in_progress > 0) {
      items.push({
        tone: 'info',
        title: 'เที่ยวกำลังขนส่ง',
        detail: `${avail.trips_in_progress} เที่ยวอยู่บนถนน — เตรียมรับ POD ตามกำหนดส่งมอบ`,
        action: { label: 'ดูแผนงาน', to: '/dispatch' },
      })
    }

    /* --- ระดับสำเร็จ (กำลังใจ + ภาพรวม) --- */
    if (delivered.count > 0) {
      const pct = delivered.prev_revenue > 0 ? Math.round(((delivered.revenue - delivered.prev_revenue) / delivered.prev_revenue) * 100) : null
      const pctText = pct == null ? '' : pct >= 0 ? ` · เพิ่ม ${pct}% เทียบเมื่อวาน` : ` · ลด ${Math.abs(pct)}% เทียบเมื่อวาน`
      items.push({
        tone: 'success',
        title: 'ส่งสำเร็จวันนี้',
        detail: `ส่งของครบ ${delivered.count} เที่ยว · รายได้ ${delivered.revenue.toLocaleString('th-TH')} บาท${pctText}`,
      })
    } else if (items.length === 0) {
      items.push({
        tone: 'success',
        title: 'ทุกอย่างเป็นไปตามแผน',
        detail: 'ยังไม่มีออเดอร์ค้างหรือใบเสนอราคาที่ต้องติดตาม — ใช้เวลานี้เตรียมแผนล่วงหน้าได้เลย',
      })
    }

    // จำกัดจำนวน — เรียงสำคัญก่อน (danger → warn → info → success)
    const ordered = [...items].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]).slice(0, MAX_ITEMS)
    const hasDanger = ordered.some((i) => i.tone === 'danger')
    const hasWarn = ordered.some((i) => i.tone === 'warn')

    const headline =
      pressure.overdue > 0
        ? `ต้องรีบจัดการ — ออเดอร์เลยกำหนด ${pressure.overdue} ใบ และยังมีค้างในคิวอีก ${pressure.pending} ใบ`
        : pressure.urgent_unassigned > 0
          ? `วันนี้โฟกัสออเดอร์ด่วน ${pressure.urgent_unassigned} ใบก่อน — จัดคิวให้เสร็จภายในช่วงเช้า`
          : hasDanger || hasWarn
            ? `มีสิ่งที่ต้องติดตาม ${ordered.filter((i) => i.tone === 'danger' || i.tone === 'warn').length} จุด — จัดการตามลำดับความสำคัญ`
            : `ทุกอย่างเป็นไปตามแผน — ส่งสำเร็จ ${delivered.count} เที่ยว · รายได้ ${delivered.revenue.toLocaleString('th-TH')} บาท`

    return { headline, items: ordered, generated_at: nowIso }
  }
}

const TONE_ORDER: Record<InsightTone, number> = { danger: 0, warn: 1, info: 2, success: 3 }
