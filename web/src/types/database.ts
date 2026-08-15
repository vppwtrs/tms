/**
 * ชนิดข้อมูลของตารางใน Supabase — เขียนมือให้ตรงกับ supabase/migrations/
 *
 * ปกติไฟล์นี้ควร generate ด้วย `npx supabase gen types typescript --linked > web/src/types/database.ts`
 * แต่ตอนนี้ยังไม่ได้ link project จึงเขียนมือไปก่อน
 * **แก้ migration เมื่อไหร่ ต้องมาแก้ไฟล์นี้ด้วย** ไม่งั้น tsc ผ่านแต่ query พังตอน runtime
 */

export type UserRole = 'admin' | 'dispatcher' | 'viewer' | 'driver'
export type VehicleType = 'pickup' | 'truck6' | 'truck10' | 'reefer' | 'van'
export type VehicleStatus = 'available' | 'on_trip' | 'maintenance' | 'inactive'
export type DriverStatus = 'available' | 'on_trip' | 'off_duty'
export type TripStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'
export type OrderStatus = 'pending' | 'assigned' | 'in_transit' | 'delivered' | 'cancelled'
export type OrderPriority = 'normal' | 'urgent'
export type PodStatus = 'collected' | 'verified'
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'
export type InteractionType = 'call' | 'email' | 'meeting' | 'line' | 'other'
export type TaskStatus = 'pending' | 'done'

export type UserRow = {
  id: number
  auth_id: string | null
  username: string
  name: string
  role: UserRole
  is_active: boolean
  created_at: string
}

export type UserPermissionRow = {
  user_id: number
  permission: string
  allowed: boolean
}

export type CustomerRow = {
  id: number
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  segment: string
  tax_id: string | null
  credit_terms: number | null
  tags: string | null
  price_note: string | null
  created_at: string
}

export type VehicleRow = {
  id: number
  plate_no: string
  brand: string | null
  model: string | null
  vehicle_type: VehicleType
  capacity_kg: number
  status: VehicleStatus
  created_at: string
}

export type DriverRow = {
  id: number
  name: string
  phone: string | null
  license_no: string | null
  license_type: string | null
  status: DriverStatus
  joined_at: string | null
  user_id: number | null
  created_at: string
}

export type TripRow = {
  id: number
  trip_no: string
  vehicle_id: number
  driver_id: number
  status: TripStatus
  departed_at: string | null
  arrived_at: string | null
  fuel_cost: number
  toll_cost: number
  other_cost: number
  notes: string | null
  created_at: string
}

export type OrderRow = {
  id: number
  order_no: string
  customer_id: number | null
  origin: string
  destination: string
  distance_km: number
  goods_desc: string
  weight_kg: number
  fee: number
  status: OrderStatus
  priority: OrderPriority
  scheduled_at: string
  delivered_at: string | null
  trip_id: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type PodRow = {
  id: number
  order_id: number
  recipient_name: string
  signature_data: string
  photo_path: string | null
  notes: string | null
  status: PodStatus
  lat: number | null
  lng: number | null
  collected_by: number
  collected_at: string
  updated_at: string
}

export type QuoteRow = {
  id: number
  quote_no: string
  customer_id: number | null
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
  converted_order_id: number | null
  created_at: string
  updated_at: string
}

export type TmsShipmentRow = {
  id: number
  picking_list_no: string
  trip_no_tms: string | null
  /* orderDate จากรายงาน = "Trip Date" — รายงานไม่มีฟิลด์ planDeliveryDate ดู 0006 */
  trip_date: string | null
  dealer_name: string | null
  branch: string | null
  unit: number | null
  item_no: string | null
  item_name: string | null
  item_qty: number | null
  /* ยอดของ PL ที่ถูกแบ่งส่งหลายเที่ยว — เทียบกับ unit ผ่าน qty_source
     วัดของจริง 40 ใบแล้ว unit ตรงกับ qty ทุกใบ split ยังไม่เคยถูกใช้ */
  item_split_qty: number | null
  qty_source: 'qty' | 'split' | null
  /* dealer_code คือกุญแจจับคู่ลูกค้าใน tms_dealer_map — ชื่อร้านใช้แทนไม่ได้ */
  dealer_code: string | null
  license_plate: string | null
  driver_name: string | null
  status_delivery: string | null
  actual_cost: number | null
  raw: Record<string, unknown>
  synced_at: string
  order_id: number | null
}

/* view ฝั่งคนขับ — สังเกตว่าไม่มี fee / fuel_cost / toll_cost / other_cost
   ถ้าวันไหนมีคนเผลอเติมคอลัมน์เงินเข้ามาที่นี่ แปลว่า view ฝั่ง SQL ก็ถูกแก้ไปแล้วเช่นกัน */
export type MyTripRow = {
  id: number
  trip_no: string
  status: TripStatus
  departed_at: string | null
  arrived_at: string | null
  notes: string | null
  plate_no: string
  vehicle_type: VehicleType
}

export type MyOrderRow = {
  id: number
  order_no: string
  trip_id: number | null
  status: OrderStatus
  priority: OrderPriority
  origin: string
  destination: string
  goods_desc: string
  weight_kg: number
  scheduled_at: string
  delivered_at: string | null
  notes: string | null
  customer_name: string | null
  customer_phone: string | null
  has_pod: boolean
}

export type CustomerInteractionRow = {
  id: number
  customer_id: number
  type: InteractionType
  subject: string
  note: string | null
  happened_at: string
  created_by: number | null
  created_at: string
}

export type CustomerTaskRow = {
  id: number
  customer_id: number
  title: string
  due_at: string | null
  status: TaskStatus
  note: string | null
  created_by: number | null
  created_at: string
}

/* คอลัมน์ที่เป็น null ได้ ต้อง "ไม่ส่งมาก็ได้" ตอน insert ไม่ใช่บังคับให้ส่ง null มาเอง
   ถ้าไม่แยกตรงนี้ ทุกฟอร์มต้องเขียน phone: null, email: null ครบทุกช่องที่ไม่ได้กรอก */
export type TmsDealerMapRow = {
  dealer_code: string
  dealer_name: string
  customer_id: number | null
  /* null customer_id = ยังไม่มีใครตัดสินใจ / ignored = ตัดสินใจแล้วว่าไม่เอาเข้าระบบ
     สองอย่างนี้ต่างกัน อย่ายุบเป็นค่าเดียว ไม่งั้นร้านที่ตั้งใจข้ามจะโผล่ให้ตรวจซ้ำทุกวัน */
  ignored: boolean
  mapped_by: number | null
  mapped_at: string | null
  created_at: string
}

type NullableKeys<T> = { [K in keyof T]-?: null extends T[K] ? K : never }[keyof T]

type Insertable<T, Generated extends keyof T> = Omit<T, Generated | NullableKeys<T>> &
  Partial<Pick<T, Generated | NullableKeys<T>>>

/* Relationships จำเป็นต้องมีถึงจะเข้ารูป GenericTable ของ postgrest-js
   ปล่อยเป็น [] ได้เพราะเราไม่ได้ใช้ nested select แบบ orders(customers(*))
   ถ้าวันไหนจะใช้ ต้อง generate types จริงด้วย supabase gen types */
interface Table<Row, Ins = Row, Upd = Partial<Row>> {
  Row: Row
  Insert: Ins
  Update: Upd
  Relationships: []
}

interface View<Row> {
  Row: Row
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      users: Table<UserRow, Insertable<UserRow, 'id' | 'created_at' | 'is_active' | 'role'>>
      user_permissions: Table<UserPermissionRow>
      customers: Table<CustomerRow, Insertable<CustomerRow, 'id' | 'created_at' | 'segment'>>
      vehicles: Table<VehicleRow, Insertable<VehicleRow, 'id' | 'created_at' | 'status' | 'capacity_kg' | 'vehicle_type'>>
      drivers: Table<DriverRow, Insertable<DriverRow, 'id' | 'created_at' | 'status'>>
      /* trip_no / order_no / quote_no เป็น optional เพราะ trigger ใน 0007 เติมให้ตอน insert
         ส่งมาเองก็ได้ แต่ปกติปล่อยว่างแล้วให้ DB ตั้งเลขต่อจากใบล่าสุดของปีนี้ */
      trips: Table<TripRow, Insertable<TripRow, 'id' | 'created_at' | 'status' | 'trip_no' | 'fuel_cost' | 'toll_cost' | 'other_cost'>>
      orders: Table<OrderRow, Insertable<OrderRow, 'id' | 'created_at' | 'updated_at' | 'status' | 'order_no' | 'priority' | 'distance_km' | 'weight_kg' | 'fee'>>
      pod: Table<PodRow, Insertable<PodRow, 'id' | 'updated_at' | 'status'>>
      quotes: Table<QuoteRow, Insertable<QuoteRow, 'id' | 'created_at' | 'updated_at' | 'status' | 'quote_no' | 'distance_km' | 'weight_kg' | 'fee'>>
      customer_interactions: Table<CustomerInteractionRow, Insertable<CustomerInteractionRow, 'id' | 'created_at' | 'type'>>
      customer_tasks: Table<CustomerTaskRow, Insertable<CustomerTaskRow, 'id' | 'created_at' | 'status'>>
      tms_shipments: Table<TmsShipmentRow, Insertable<TmsShipmentRow, 'id' | 'synced_at'>>
      tms_dealer_map: Table<TmsDealerMapRow, Insertable<TmsDealerMapRow, 'created_at' | 'ignored'>>
      settings: Table<{ key: string; value: string }>
      permissions: Table<{ permission: string; label: string }>
      role_permissions: Table<{ role: UserRole; permission: string }>
    }
    Views: {
      my_trips: View<MyTripRow>
      my_orders: View<MyOrderRow>
    }
    Functions: {
      start_trip: { Args: { p_trip_id: number }; Returns: void }
      deliver_order: { Args: { p_order_id: number }; Returns: void }
      complete_trip: { Args: { p_trip_id: number }; Returns: void }
      save_pod: {
        Args: {
          p_order_id: number
          p_recipient_name: string
          p_signature_data: string
          p_photo_path?: string | null
          p_notes?: string | null
          p_lat?: number | null
          p_lng?: number | null
        }
        Returns: number
      }
      /* ฝั่งออฟฟิศ — 0007 อธิบายว่าทำไมงานพวกนี้ต้องเป็นฟังก์ชัน ไม่ใช่ยิงตารางเรียงกัน */
      create_trip: {
        Args: { p_vehicle_id: number; p_driver_id: number; p_order_ids: number[]; p_notes?: string | null }
        Returns: { trip_id: number; trip_no: string; warning: string | null }
      }
      add_orders_to_trip: {
        Args: { p_trip_id: number; p_order_ids: number[] }
        Returns: { warning: string | null }
      }
      remove_order_from_trip: { Args: { p_trip_id: number; p_order_id: number }; Returns: void }
      dispatch_start_trip: { Args: { p_trip_id: number }; Returns: void }
      dispatch_complete_trip: { Args: { p_trip_id: number }; Returns: void }
      dispatch_cancel_trip: { Args: { p_trip_id: number }; Returns: void }
      convert_quote: {
        Args: { p_quote_id: number; p_scheduled_at: string; p_notes?: string | null }
        Returns: { order_id: number; order_no: string }
      }
      /* สะพานจาก TMS บริษัท — 0008 อธิบายว่าทำไมต้องให้คนจับคู่ร้านก่อน ไม่เดาจากชื่อ */
      preview_tms_import: {
        Args: { p_date: string }
        Returns: {
          date: string
          picking_lists: number
          trips: number
          already_imported: number
          unmapped_dealers: { dealer_code: string; dealer_name: string; picking_lists: number }[]
          unknown_plates: string[]
        }
      }
      import_tms_shipments: {
        Args: { p_date: string }
        Returns: { date: string; created: number; skipped: number }
      }
    }
    Enums: {
      user_role: UserRole
      vehicle_type: VehicleType
      vehicle_status: VehicleStatus
      driver_status: DriverStatus
      trip_status: TripStatus
      order_status: OrderStatus
      order_priority: OrderPriority
      pod_status: PodStatus
      quote_status: QuoteStatus
    }
    CompositeTypes: Record<string, never>
  }
}
