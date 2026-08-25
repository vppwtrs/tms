import { getTripBoardDetailed, type BoardTrip } from './trips'
import { listUnassignedOrders } from './orders'
import { trackingBoard, type TrackedTrip } from './tracking'

/**
 * สรุปประจำวันของหน้าแรก — "วันนี้มีอะไรต้องรีบ"
 *
 * **ไม่ใช่ AI** ไม่มีโมเดล ไม่มีบริการภายนอก ไม่มีค่าใช้จ่ายต่อครั้ง เป็นกฎที่เขียนไว้
 * ตรง ๆ ในไฟล์นี้ล้วน ๆ เรียกชื่อให้ตรงกับสิ่งที่มันเป็นเพราะคนที่อ่านหน้าจอต้องรู้ว่า
 * ตัวเลขมาจากไหน และต้องเถียงกับมันได้เวลามันผิด
 *
 * ทุกกฎอ่านจากฟังก์ชันรายการเดิม ไม่มี query ใหม่ ไม่มี RPC ใหม่ ไม่มีตารางใหม่
 * เกณฑ์ที่ใช้ก็ยืมของหน้าที่มีอยู่แล้ว (เช่น 5 นาทีของสัญญาณขาด ยกมาจากหน้าติดตามรถ)
 * เพื่อไม่ให้ระบบมีสองความจริงเรื่องเดียวกัน
 *
 * ทุกข้อต้องมีปุ่มพาไปที่ที่แก้ได้ ข้อไหนบอกปัญหาแล้วไม่บอกว่าไปทำต่อตรงไหน
 * ก็เป็นแค่การเพิ่มความกังวลให้คนอ่าน
 */

export type InsightTone = 'danger' | 'warn' | 'info' | 'success'

export interface InsightItem {
  tone: InsightTone
  title: string
  detail: string
  action?: { label: string; to: string }
}

export interface OpsSummary {
  headline: string
  items: InsightItem[]
  kpis: {
    tripsToday: number
    running: number
    waitingAccept: number
    doneToday: number
    unassigned: number
    stopsDone: number
    stopsTotal: number
  }
}

/** สัญญาณขาดนานเท่านี้ถือว่า "ไม่รู้ว่ารถอยู่ไหน" — เกณฑ์เดียวกับหน้าติดตามรถ */
const STALE_MS = 5 * 60 * 1000

/** เที่ยวที่ออกไปแล้วนานเท่านี้แต่ยังไม่ปิด ถือว่านานผิดปกติสำหรับงานหนึ่งวัน */
const LONG_RUN_MS = 10 * 60 * 60 * 1000

export async function opsSummary(): Promise<OpsSummary> {
  /* หน้าแรกไม่ควรพังทั้งหน้าเพราะสิทธิ์ของบางส่วนไม่ถึง — คนที่ดูออเดอร์ได้แต่ดูตำแหน่ง
     รถไม่ได้ ยังต้องได้สรุปในส่วนที่ตัวเองเห็น ส่วนที่ยิงไม่ผ่านกลายเป็นว่าง ไม่ใช่ error */
  const [board, unassigned, tracked] = await Promise.all([
    getTripBoardDetailed().catch(() => ({ waiting: [], running: [], done: [] })),
    listUnassignedOrders().catch(() => []),
    trackingBoard().catch(() => [] as TrackedTrip[]),
  ])

  const items: InsightItem[] = []
  const live: BoardTrip[] = [...board.waiting, ...board.running]

  /* 1 · งานด่วนที่ยังไม่มีเที่ยว — ค้างที่นี่แปลว่ายังไม่มีใครถือของใบนั้นเลย */
  const urgent = unassigned.filter((o) => o.priority === 'urgent')
  if (urgent.length > 0) {
    items.push({
      tone: 'danger',
      title: `งานด่วน ${urgent.length} ใบยังไม่ได้จัดเที่ยว`,
      detail: urgent.slice(0, 3).map((o) => o.destination).join(' · '),
      action: { label: 'จัดเที่ยว', to: '/dispatch' },
    })
  } else if (unassigned.length > 0) {
    items.push({
      tone: 'info',
      title: `ออเดอร์รอจัดเที่ยว ${unassigned.length} ใบ`,
      detail: 'ยังไม่มีใบไหนถูกทำเครื่องหมายว่าด่วน',
      action: { label: 'จัดเที่ยว', to: '/dispatch' },
    })
  }

  /* 2 · จ่ายงานแล้วแต่คนขับยังไม่กดรับ — งานที่คิดว่าออกไปแล้วแต่จริง ๆ ยังไม่ออก */
  if (board.waiting.length > 0) {
    /* เที่ยวที่ TMS ดันออกมาแล้ว (มี departed_at) แต่ยังไม่มีใครกดรับ หนักกว่าเที่ยว
       ที่เพิ่งวางแผนไว้เฉย ๆ เพราะฝั่งโน้นถือว่างานออกไปแล้ว */
    const pushed = board.waiting.filter((t) => t.departed_at !== null)
    items.push({
      tone: pushed.length > 0 ? 'warn' : 'info',
      title: `${board.waiting.length} เที่ยวยังไม่มีคนขับกดรับ`,
      detail: board.waiting.slice(0, 3).map((t) => `${t.tms_trip_no ?? t.trip_no} (${t.driver_name})`).join(' · '),
      action: { label: 'ดูแผนงาน', to: '/dispatch' },
    })
  }

  /* 3 · คนขับที่ไม่มีบัญชีผู้ใช้ — จ่ายงานสำเร็จแต่เขาเปิดแอปดูไม่ได้เลย
     เงียบที่สุดในบรรดาปัญหาทั้งหมด เพราะฝั่งออฟฟิศเห็นว่าจ่ายไปแล้ว */
  const noAccount = live.filter((t) => !t.driver_has_account)
  if (noAccount.length > 0) {
    items.push({
      tone: 'danger',
      title: `คนขับของ ${noAccount.length} เที่ยวยังไม่มีบัญชีเข้าแอป`,
      detail: `${noAccount.slice(0, 3).map((t) => t.driver_name).join(' · ')} — จ่ายงานแล้วแต่เขาเปิดดูไม่ได้`,
      action: { label: 'เปิดหน้าพนักงานขับ', to: '/drivers' },
    })
  }

  /* 4 · ปัญหาที่คนขับแจ้งเข้ามาเอง — มีคนกดบอกแล้ว ค้างไว้ไม่ได้ */
  const issues = live.filter((t) => t.issue_note)
  if (issues.length > 0) {
    items.push({
      tone: 'danger',
      title: `คนขับแจ้งปัญหา ${issues.length} เรื่อง`,
      detail: issues.slice(0, 2).map((t) => `${t.tms_trip_no ?? t.trip_no}: ${t.issue_note}`).join(' · '),
      action: { label: 'ดูแผนงาน', to: '/dispatch' },
    })
  }

  /* 5 · รถที่ไม่ส่งตำแหน่งมานาน — แอปถูกปิด เครื่องดับ หรือเน็ตหาย
     ไม่ได้แปลว่ารถหาย แต่แปลว่าตอบลูกค้าไม่ได้ว่าของอยู่ไหน */
  const stale = tracked.filter((t) => {
    if (t.status === 'completed') return false
    const seen = t.last_seen?.recorded_at
    return !seen || Date.now() - new Date(seen).getTime() > STALE_MS
  })
  if (stale.length > 0) {
    items.push({
      tone: 'warn',
      title: `${stale.length} คันไม่ส่งตำแหน่งเกิน 5 นาที`,
      detail: stale.slice(0, 4).map((t) => t.plate_no).join(' · '),
      action: { label: 'เปิดแผนที่', to: '/tracking' },
    })
  }

  /* 6 · เที่ยวที่ออกไปนานแล้วยังไม่ปิด — มักเป็นเที่ยวที่คนขับลืมกดปิดตอนกลับถึงคลัง
     ซึ่งทำให้ทั้งรถและคนขับยังถูกจองอยู่ในระบบทั้งที่ว่างแล้ว */
  const overdue = board.running.filter((t) => t.departed_at && Date.now() - new Date(t.departed_at).getTime() > LONG_RUN_MS)
  if (overdue.length > 0) {
    items.push({
      tone: 'warn',
      title: `${overdue.length} เที่ยววิ่งเกิน 10 ชั่วโมงแล้วยังไม่ปิด`,
      detail: overdue.slice(0, 3).map((t) => `${t.tms_trip_no ?? t.trip_no} (${t.vehicle_plate})`).join(' · '),
      action: { label: 'ดูแผนงาน', to: '/dispatch' },
    })
  }

  /* 7 · จุดที่ส่งของแล้วแต่ยังไม่มีหลักฐาน — ตัวเลขนี้คือสิ่งที่ต้องยื่นตอนลูกค้าทวง */
  const stopsDone = tracked.reduce((s, t) => s + t.stops_done, 0)
  const stopsTotal = tracked.reduce((s, t) => s + t.stops_total, 0)
  const podPoints = tracked.reduce((s, t) => s + t.pod_points.length, 0)
  if (stopsDone > podPoints) {
    items.push({
      tone: 'warn',
      title: `${stopsDone - podPoints} จุดส่งแล้วแต่ยังไม่มีหลักฐาน`,
      detail: 'ลายเซ็นหรือรูปยังไม่ถูกอัปโหลดขึ้นระบบ',
      action: { label: 'ดูออเดอร์', to: '/orders' },
    })
  }

  const headline = items.some((i) => i.tone === 'danger')
    ? 'มีเรื่องต้องจัดการก่อนเรื่องอื่น'
    : items.length > 0
      ? 'งานเดินตามปกติ มีบางจุดที่ควรตามต่อ'
      : 'ไม่มีอะไรค้าง งานเดินครบทุกเที่ยว'

  return {
    headline,
    items,
    kpis: {
      tripsToday: board.waiting.length + board.running.length + board.done.length,
      running: board.running.length,
      waitingAccept: board.waiting.length,
      doneToday: board.done.length,
      unassigned: unassigned.length,
      stopsDone,
      stopsTotal,
    },
  }
}
