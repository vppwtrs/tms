/** ค่าคงที่ของโดเมน — สถานะทั้งหมด + ป้ายกำกับภาษาไทย + สี (ฝั่ง web อ่าน label จากที่นี่ได้เช่นกัน) */

export const ORDER_STATUSES = ['pending', 'assigned', 'in_transit', 'delivered', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const TRIP_STATUSES = ['planned', 'in_progress', 'completed', 'cancelled'] as const
export type TripStatus = (typeof TRIP_STATUSES)[number]

export const VEHICLE_STATUSES = ['available', 'on_trip', 'maintenance', 'inactive'] as const
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number]

export const DRIVER_STATUSES = ['available', 'on_trip', 'off_duty'] as const
export type DriverStatus = (typeof DRIVER_STATUSES)[number]

export const PRIORITIES = ['normal', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const ROLES = ['admin', 'dispatcher', 'viewer', 'driver'] as const
export type Role = (typeof ROLES)[number]

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

export const INTERACTION_TYPES = ['call', 'email', 'meeting', 'line', 'other'] as const
export type InteractionType = (typeof INTERACTION_TYPES)[number]

export const CUSTOMER_SEGMENTS = ['A', 'B', 'C', 'VIP'] as const
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number]

export const VEHICLE_TYPES = ['pickup', 'truck6', 'truck10', 'reefer', 'van'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

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

export const INTERACTION_TYPE_LABEL: Record<InteractionType, string> = {
  call: 'โทรศัพท์',
  email: 'อีเมล',
  meeting: 'ประชุม/พบหน้า',
  line: 'LINE',
  other: 'อื่นๆ',
}

/** สถานะออเดอร์ที่ยัง "ค้าง" อยู่ (ใช้คำนวณคิว/การแจ้งเตือน) */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['pending', 'assigned', 'in_transit']
