import type { OrderStatus, TripStatus, VehicleStatus, DriverStatus, Priority, VehicleType, Role, QuoteStatus, InteractionType, CustomerSegment } from '../types'

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'รอจัดคิว',
  assigned: 'จัดคิวแล้ว',
  in_transit: 'กำลังขนส่ง',
  delivered: 'ส่งสำเร็จ',
  cancelled: 'ยกเลิก',
}

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  planned: 'วางแผนแล้ว',
  in_progress: 'กำลังขนส่ง',
  /* ส่งครบแล้วแต่รถยังอยู่ข้างนอก — ยังไม่ว่าง ยังตามตำแหน่งอยู่ */
  returning: 'กำลังกลับคลัง',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
}

export const VEHICLE_STATUS_LABEL: Record<VehicleStatus, string> = {
  available: 'ว่าง',
  on_trip: 'กำลังขนส่ง',
  maintenance: 'ซ่อมบำรุง',
  inactive: 'ไม่ใช้งาน',
}

export const DRIVER_STATUS_LABEL: Record<DriverStatus, string> = {
  available: 'ว่าง',
  on_trip: 'กำลังขนส่ง',
  off_duty: 'หยุดงาน',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  normal: 'ปกติ',
  urgent: 'ด่วน',
}

export const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  pickup: 'กระบะ 4 ล้อ',
  truck6: 'รถ 6 ล้อ',
  truck10: 'รถ 10 ล้อ',
  reefer: 'รถห้องเย็น',
  van: 'รถตู้',
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'ผู้ดูแลระบบ',
  dispatcher: 'ผู้วางแผนงาน',
  viewer: 'ดูอย่างเดียว',
  driver: 'พนักงานขับรถ',
}

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'ร่าง',
  sent: 'ส่งแล้ว',
  accepted: 'ตกลงราคา',
  rejected: 'ปัดตก',
  expired: 'หมดอายุ',
}

export const QUOTE_TONE: Record<QuoteStatus, string> = {
  draft: 'pending',
  sent: 'assigned',
  accepted: 'delivered',
  rejected: 'cancelled',
  expired: 'off_duty',
}

export const INTERACTION_TYPE_LABEL: Record<InteractionType, string> = {
  call: 'โทรศัพท์',
  email: 'อีเมล',
  meeting: 'ประชุม/พบหน้า',
  line: 'LINE',
  other: 'อื่นๆ',
}

export const INTERACTION_TYPE_ICON: Record<InteractionType, string> = {
  call: '📞',
  email: '✉️',
  meeting: '🤝',
  line: '💬',
  other: '📌',
}

export const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  VIP: 'VIP',
  A: 'กลุ่ม A',
  B: 'กลุ่ม B',
  C: 'กลุ่ม C',
}

export const SEGMENT_TONE: Record<CustomerSegment, string> = {
  VIP: 'delivered',
  A: 'assigned',
  B: 'pending',
  C: 'off_duty',
}

/** badge tone (suffix ของ class badge-*) ตามสถานะ */
export const ORDER_TONE: Record<OrderStatus, string> = {
  pending: 'pending',
  assigned: 'assigned',
  in_transit: 'in_transit',
  delivered: 'delivered',
  cancelled: 'cancelled',
}

export const TRIP_TONE: Record<TripStatus, string> = {
  planned: 'planned',
  in_progress: 'in_progress',
  returning: 'in_progress',
  completed: 'completed',
  cancelled: 'cancelled',
}

export const VEHICLE_TONE: Record<VehicleStatus, string> = {
  available: 'available',
  on_trip: 'in_progress',
  maintenance: 'maintenance',
  inactive: 'inactive',
}

export const DRIVER_TONE: Record<DriverStatus, string> = {
  available: 'available',
  on_trip: 'in_progress',
  off_duty: 'off_duty',
}

export const PRIORITY_TONE: Record<Priority, string> = {
  normal: 'normal',
  urgent: 'urgent',
}

export const ORDER_STATUS_ORDER: OrderStatus[] = ['pending', 'assigned', 'in_transit', 'delivered', 'cancelled']

/** สีของกราฟ (donut/bar) ตามสถานะ — โทนเดียวกับ badges (Aurora status palette) */
export const STATUS_CHART_COLORS: Record<string, string> = {
  pending: '#5f5a74',
  assigned: '#4e5fc7',
  in_transit: '#8f5a15',
  delivered: '#1f7a5f',
  cancelled: '#b8405b',
}

export const QUOTE_STATUS_ORDER: QuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired']

/* เหตุผลที่หน้างานเจอจริงตอนยกเลิกจุดส่ง — ให้เลือกแทนพิมพ์ เพราะคนขับกดอยู่ข้างถนน
   และเหตุผลที่พิมพ์อิสระล้วนกลายเป็น "ยกเลิก" กับ "ไม่รับ" ซึ่งสรุปอะไรไม่ได้
   จอออฟฟิศใช้รายการเดียวกัน รายงานจึงนับรวมกันได้ ไม่ใช่คนละคำเรียกของเรื่องเดียวกัน */
export const CANCEL_STOP_REASONS = [
  'ร้านปิด ไม่มีคนรับ',
  'ร้านแจ้งยกเลิก',
  'ต้นทางยกเลิกรายการ',
  'ของไม่ครบ/ของผิด',
  'ที่อยู่ผิด หาไม่เจอ',
  'ร้านขอเลื่อนวันส่ง',
] as const
