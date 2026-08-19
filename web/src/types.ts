export type OrderStatus = 'pending' | 'assigned' | 'in_transit' | 'delivered' | 'cancelled'
export type TripStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'
export type VehicleStatus = 'available' | 'on_trip' | 'maintenance' | 'inactive'
export type DriverStatus = 'available' | 'on_trip' | 'off_duty'
export type Priority = 'normal' | 'urgent'
export type Role = 'admin' | 'dispatcher' | 'viewer' | 'driver'
export type VehicleType = 'pickup' | 'truck6' | 'truck10' | 'reefer' | 'van'
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'
export type InteractionType = 'call' | 'email' | 'meeting' | 'line' | 'other'
export type CustomerSegment = 'A' | 'B' | 'C' | 'VIP'

/** ชื่อสิทธิ์เป็น string ธรรมดา — แคตตาล็อกจริงมาจาก API (/auth/permissions/catalog)
 *  ไม่ hardcode รายชื่อไว้ฝั่ง web เพื่อไม่ให้สองฝั่งหลุดจากกันเวลาเพิ่มสิทธิ์ใหม่ */
export type Permission = string

export interface User {
  id: number
  username: string
  name: string
  role: Role
  /** สิทธิ์ที่ใช้จริงของผู้ใช้ที่ล็อกอินอยู่ — server ส่งมาพร้อม login/me */
  permissions?: Permission[]
}

/** ผู้ใช้ในหน้าจัดการผู้ใช้ (admin เห็น) */
export interface ManagedUser {
  id: number
  username: string
  name: string
  role: Role
  is_active: boolean
  created_at: string
  permissions: Permission[]
  /** เฉพาะสิทธิ์ที่ตั้งต่างจาก preset ของบทบาท */
  overrides: Record<string, boolean>
}

/** งานของคนขับ — ชุดข้อมูลที่ server ตัดตัวเลขเงินออกให้แล้ว */
export interface MyJobOrder {
  id: number
  order_no: string
  trip_id: number
  status: OrderStatus
  priority: Priority
  origin: string
  destination: string
  distance_km: number
  goods_desc: string
  weight_kg: number
  scheduled_at: string
  delivered_at: string | null
  notes: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_address: string | null
  has_pod: number
  /* เลขที่ TMS ใช้ — คนขับอ้างเลขนี้เวลาโทรหาคลังหรือร้าน */
  tms_trip_no: string | null
  tms_picking_list_no: string | null
  tms_unit_count: number | null
  /* ลำดับที่คนขับจัดเอง null = ยังไม่จัด */
  seq: number | null
}

export interface MyJob {
  id: number
  trip_no: string
  status: TripStatus
  departed_at: string | null
  arrived_at: string | null
  notes: string | null
  vehicle_plate: string
  vehicle_type: VehicleType
  accepted_at: string | null
  /* null = "ฉัน" ยังไม่กดรับ ถึงแม้คนอื่นในเที่ยวจะรับไปแล้ว */
  my_accepted_at: string | null
  is_primary: boolean
  driver_count: number
  accepted_count: number
  issue_note: string | null
  orders: MyJobOrder[]
  total_weight: number
}

export interface PermissionCatalog {
  groups: { key: string; label: string; perms: Permission[] }[]
  labels: Record<string, string>
  warnings: Record<string, string>
  presets: Record<Role, Permission[]>
}

export interface Customer {
  id: number
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  segment: CustomerSegment | null
  tax_id: string | null
  credit_terms: number | null
  tags: string | null
  price_note: string | null
  created_at: string
}

export interface CustomerDetail extends Customer {
  order_count: number
  total_revenue: number
  last_order_at: string | null
  open_tasks_count: number
  pending_quotes_count: number
}

export interface Quote {
  id: number
  quote_no: string
  customer_id: number | null
  customer_name: string | null
  origin: string
  destination: string
  distance_km: number
  goods_desc: string
  weight_kg: number
  fee: number
  status: QuoteStatus
  valid_until: string | null
  notes: string | null
  created_by: number | null
  created_by_name: string | null
  converted_order_id: number | null
  converted_order_no: string | null
  created_at: string
  updated_at: string
}

export interface Interaction {
  id: number
  customer_id: number
  type: InteractionType
  subject: string
  note: string | null
  happened_at: string
  created_by: number | null
  created_by_name: string | null
  created_at: string
}

export interface CustomerTask {
  id: number
  customer_id: number
  title: string
  due_at: string | null
  status: 'pending' | 'done'
  note: string | null
  created_by: number | null
  created_by_name: string | null
  created_at: string
}

export interface Vehicle {
  id: number
  plate_no: string
  brand: string | null
  model: string | null
  vehicle_type: VehicleType
  capacity_kg: number
  status: VehicleStatus
  created_at: string
}

export interface Driver {
  id: number
  name: string
  phone: string | null
  license_no: string | null
  license_type: string | null
  status: DriverStatus
  joined_at: string | null
  /** บัญชีผู้ใช้ที่ผูกไว้ — คนขับจะเห็นหน้า "งานของฉัน" ได้ต่อเมื่อช่องนี้ไม่ว่าง */
  user_id: number | null
  created_at: string
}

export interface Order {
  id: number
  order_no: string
  customer_id: number | null
  customer_name: string | null
  origin: string
  destination: string
  distance_km: number
  goods_desc: string
  weight_kg: number
  fee: number
  status: OrderStatus
  priority: Priority
  scheduled_at: string
  delivered_at: string | null
  trip_id: number | null
  trip_no: string | null
  trip_status: string | null
  /** คนขับที่รับผิดชอบ — มาจากเที่ยววิ่ง ออเดอร์ที่ยังไม่ได้จัดเที่ยวจะเป็น null */
  driver_id: number | null
  driver_name: string | null
  pod_id: number | null
  pod_status: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Trip {
  id: number
  trip_no: string
  vehicle_id: number
  vehicle_plate: string
  vehicle_type: string | null
  vehicle_capacity: number
  driver_id: number
  driver_name: string
  driver_phone: string | null
  status: TripStatus
  departed_at: string | null
  arrived_at: string | null
  fuel_cost: number
  toll_cost: number
  other_cost: number
  notes: string | null
  created_at: string
}

export interface TripDetail extends Trip {
  orders: Order[]
  total_weight: number
  total_fee: number
  total_cost: number
}

export interface Pod {
  id: number
  order_id: number
  recipient_name: string
  signature_data: string
  photo_path: string | null
  notes: string | null
  status: 'collected' | 'verified'
  lat: number | null
  lng: number | null
  collected_by: number
  collected_by_name: string
  collected_at: string
  updated_at: string
}

export interface Settings {
  org_name: string
  currency_code: string
  currency_symbol: string
}

export interface PaginationMeta {
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface DashboardSummary {
  kpis: {
    orders_today: number
    in_transit: number
    delivered_month: number
    revenue_month: number
    pending: number
    urgent_unassigned: number
    overdue: number
  }
  trend: { d: string; count: number; revenue: number }[]
  orders_by_status: { status: string; count: number }[]
  vehicles_by_status: { status: string; count: number }[]
  drivers_by_status: { status: string; count: number }[]
  alerts: {
    urgent_unassigned: { id: number; order_no: string; destination: string; scheduled_at: string }[]
    overdue: { id: number; order_no: string; destination: string; scheduled_at: string }[]
  }
  recent_orders: { id: number; order_no: string; destination: string; status: string; created_at: string }[]
}

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

export interface CsvTableStatus {
  table: string
  file: string
  title: string
  description: string
  rows: number
  fileSize: number | null
  lastExport: string | null
  error: string | null
}

export interface CsvStatus {
  csvDir: string
  autoSyncMs: number
  tables: CsvTableStatus[]
}

export interface BolDocument {
  org: { org_name: string; currency_code: string; currency_symbol: string }
  id: number
  order_no: string
  customer_name: string | null
  customer_address: string | null
  customer_contact: string | null
  customer_phone: string | null
  customer_tax_id: string | null
  origin: string
  destination: string
  distance_km: number
  goods_desc: string
  weight_kg: number
  fee: number
  status: OrderStatus
  priority: Priority
  scheduled_at: string
  delivered_at: string | null
  notes: string | null
  trip_no: string | null
  vehicle_plate: string | null
  vehicle_type: string | null
  driver_name: string | null
  driver_phone: string | null
  created_at: string
}

export interface ReportsResult {
  from: string
  to: string
  kpis: {
    total_orders: number
    delivered: number
    cancelled: number
    revenue: number
    costs: number
    profit: number
  on_time: number
  avg_delivery_hours: number | null
  pod_collected: number
  pod_verified: number
}
  by_status: { status: string; count: number }[]
  monthly: { month: string; count: number; revenue: number }[]
  top_customers: { name: string; orders: number; revenue: number }[]
  driver_performance: { id: number; name: string; trips: number; orders: number; revenue: number; costs: number; on_time: number }[]
  lanes: { origin: string; destination: string; orders: number; revenue: number }[]
  crm: {
    at_risk: { id: number; name: string; segment: string | null; last_order_at: string | null; days_since: number; order_count: number; total_revenue: number }[]
    new_vs_repeat: { new_customers: number; repeat_customers: number; new_revenue: number; repeat_revenue: number }
    quotes: { created: number; accepted: number; rejected: number; conversion_rate: number | null }
    customer_value: { name: string; orders: number; revenue: number }[]
  }
}
