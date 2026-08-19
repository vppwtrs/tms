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
  /* 0010 — พนักงานออฟฟิศยืนยันตัวผ่าน TMS บริษัท คนขับใช้อีเมล/รหัสผ่านของ Supabase
     is_active = false คือ "รอ admin อนุมัติ" ไม่ใช่ "ถูกปิดบัญชี" ทั้งสองกรณีใช้ค่าเดียวกัน */
  auth_source: 'local' | 'tms'
  approved_at: string | null
  approved_by: number | null
  last_login_at: string | null
  /* true = ยังใช้รหัสชั่วคราวที่ผู้ดูแลตั้งให้ แอปกั้นไว้จนกว่าจะตั้งรหัสของตัวเอง */
  must_change_password: boolean
}

export type UserPermissionRow = {
  user_id: number
  permission: string
  allowed: boolean
  mode?: 'allow' | 'deny'
  source?: 'group' | 'user'
}

export type PermissionMode = 'inherit' | 'allow' | 'deny'
export type PermissionAuditRow = {
  id: number
  actor_user_id: number | null
  target_user_id: number | null
  role: UserRole | null
  action: string
  permission: string | null
  before_value: string | null
  after_value: string | null
  reason: string | null
  created_at: string
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
  /* ค่าจ้างขนส่งจาก TMS — null คือยังไม่มีตัวเลข ต่างจาก 0 ที่แปลว่าไม่มีค่าใช้จ่ายจริง
     แยกจาก fuel/toll/other ที่เป็นต้นทุนที่เราจ่ายเองระหว่างทาง */
  freight_cost: number | null
  freight_actual_cost: number | null
  accepted_at: string | null
  accepted_by: number | null
  issue_note: string | null
  issue_at: string | null
  notes: string | null
  created_at: string
  /* คนขับที่กดปิดเที่ยว — ปิดได้เฉพาะคนขับหลัก แต่บันทึกไว้เพื่อตรวจย้อนหลัง */
  closed_by: number | null
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
  /** ข้อมูลอ้างอิงจาก TMS — เลขจริงแยกจาก order_no ของระบบเรา */
  tms_trip_no: string | null
  tms_picking_list_no: string | null
  work_kind: 'vehicle' | 'box' | null
  tms_unit_count: number | null
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
  /* จาก PL header (0012) — plan_delivery_date คือวันที่ใช้วางแผน คนละตัวกับ trip_date
     ที่เป็นวันของเที่ยวที่ TMS จับใบเข้าไปแล้ว (ว่างได้ถ้าใบยังไม่ถูกจัดเที่ยว) */
  plan_delivery_date: string | null
  pl_status: string | null
  trip_status: string | null
  pl_type: string | null
  area: string | null
  province: string | null
  customer_address: string | null
  ship_to_name: string | null
  /* ที่อยู่ปลายทาง = ปุ่มเปิดแผนที่นำทางของคนขับ ไม่ใช่ของประดับ (กติกาเดียวกับ 0011) */
  ship_to_address: string | null
  ship_to_province: string | null
  ship_to_postcode: string | null
  total_qty: number | null
  pickup_date: string | null
  delivery_date: string | null
  /* เท่าเดิม = push ไม่เขียนทับแถวนี้ คิดฝั่ง SQL ไม่ใช่ให้ client ส่งมา */
  row_hash: string | null
  first_seen_at: string
  status_changed_at: string | null
  raw: Record<string, unknown>
  synced_at: string
  order_id: number | null
}

/* view ฝั่งคนขับ — สังเกตว่าไม่มี fee / fuel_cost / toll_cost / other_cost
   ถ้าวันไหนมีคนเผลอเติมคอลัมน์เงินเข้ามาที่นี่ แปลว่า view ฝั่ง SQL ก็ถูกแก้ไปแล้วเช่นกัน */
export type TripDriverRow = {
  trip_id: number
  driver_id: number
  /* 1 = คนขับหลัก (คนเดียวที่ปิดเที่ยวได้) ที่เหลือคือผู้ช่วย */
  seq: number
  /* คนนี้กดรับงานเมื่อไหร่ — ต่างจาก trips.accepted_at ที่เป็นของทั้งเที่ยว */
  accepted_at: string | null
  created_at: string
}

export type MyTripRow = {
  id: number
  trip_no: string
  status: TripStatus
  departed_at: string | null
  arrived_at: string | null
  notes: string | null
  plate_no: string
  vehicle_type: VehicleType
  /* null = ยังไม่กดรับงานนี้ คือประตูที่กันไม่ให้งานเดินเองข้ามคนขับ */
  accepted_at: string | null
  issue_note: string | null
  issue_at: string | null
  /* ของคนที่เปิดแอปอยู่ ไม่ใช่ของทั้งเที่ยว — เที่ยวถูกรับแล้วไม่ได้แปลว่า "ฉัน" รับแล้ว */
  my_accepted_at: string | null
  /* คนขับหลักเท่านั้นที่ปิดเที่ยวได้ ผู้ช่วยปิดจุดส่งและเก็บ POD ได้ตามปกติ */
  is_primary: boolean
  driver_count: number
  accepted_count: number
  /* คลังต้นทางกับเขต อ่านจากเที่ยวดิบของ TMS — null สำหรับเที่ยวที่สร้างเองในระบบ */
  warehouse_code: string | null
  area: string | null
}

export type MyOrderRow = {
  id: number
  order_no: string
  trip_id: number | null
  status: OrderStatus
  priority: OrderPriority
  origin: string
  destination: string
  /* 0011 — distance_km กับ customer_address เติมทีหลัง
     customer_address เป็นปุ่มเปิดแผนที่นำทาง ไม่ใช่ของประดับ */
  distance_km: number
  goods_desc: string
  weight_kg: number
  scheduled_at: string
  delivered_at: string | null
  notes: string | null
  /* เลขเที่ยวกับเลข PL ของ TMS — คนขับใช้เลขนี้คุยกับคลังและร้าน */
  tms_trip_no: string | null
  tms_picking_list_no: string | null
  tms_unit_count: number | null
  work_kind: string | null
  /* ลำดับที่คนขับจัดเอง null = ยังไม่จัด เรียงตามกำหนดส่งไปก่อน */
  seq: number | null
  customer_name: string | null
  customer_phone: string | null
  customer_address: string | null
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
      permission_audit_log: Table<PermissionAuditRow>
      customers: Table<CustomerRow, Insertable<CustomerRow, 'id' | 'created_at' | 'segment'>>
      vehicles: Table<VehicleRow, Insertable<VehicleRow, 'id' | 'created_at' | 'status' | 'capacity_kg' | 'vehicle_type'>>
      drivers: Table<DriverRow, Insertable<DriverRow, 'id' | 'created_at' | 'status'>>
      /* trip_no / order_no / quote_no เป็น optional เพราะ trigger ใน 0007 เติมให้ตอน insert
         ส่งมาเองก็ได้ แต่ปกติปล่อยว่างแล้วให้ DB ตั้งเลขต่อจากใบล่าสุดของปีนี้ */
      trips: Table<TripRow, Insertable<TripRow, 'id' | 'created_at' | 'status' | 'trip_no' | 'fuel_cost' | 'toll_cost' | 'other_cost' | 'freight_cost' | 'freight_actual_cost'>>
      /* คนขับของเที่ยว รวมคนที่ไปด้วย — trips.driver_id เก็บได้แค่คนขับหลัก */
      trip_drivers: Table<TripDriverRow, Insertable<TripDriverRow, 'created_at' | 'seq' | 'accepted_at'>>
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
          /* not_plannable = ใบที่ส่งจบแล้ว (Completed) นับให้เห็น แต่ไม่นำเข้า
             ที่อยู่ปลายทางติดมาด้วย ใช้สร้างลูกค้าใหม่ได้เลยโดยไม่ต้องพิมพ์ซ้ำจาก TMS */
          not_plannable: number
          unmapped_dealers: {
            dealer_code: string
            dealer_name: string
            picking_lists: number
            ship_to_name: string | null
            address: string | null
            province: string | null
          }[]
          unknown_plates: string[]
        }
      }
      import_tms_shipments: {
        Args: { p_date: string }
        Returns: { date: string; created: number; skipped: number }
      }
      push_tms_shipments: {
        Args: { p_rows: Record<string, string>[] }
        Returns: { rows: number; inserted: number; updated: number; unchanged: number; dates: string[] }
      }
      /* กระดานสถานะ — รวมทุกคำถามที่หน้าจอถามพร้อมกันเป็น request เดียว
         p_date เป็น null = ฟังก์ชันเลือกวันล่าสุดที่มีงานจริงให้ */
      tms_board: {
        Args: { p_date?: string | null }
        Returns: {
          date: string | null
          latest_date: string | null
          synced_at: string | null
          last_change_at: string | null
          trips: number
          trips_pending_import: number
          trips_by_status: { status: string; status_id: number; trips: number; units: number }[]
          picking_lists: number
          total_qty: number
          pending_import: number
          by_status: { pl_status: string; trip_status: string; picking_lists: number }[]
          recent_days: { date: string; trips: number; picking_lists: number; pending: number }[]
        }
      }
      create_customer_from_dealer: {
        Args: { p_dealer_code: string }
        Returns: { customer_id: number; name: string }
      }
      /* เที่ยวของ TMS — 0013 อธิบายว่าทำไมกรองด้วย carrier ไม่ใช่ด้วยคลัง */
      push_tms_trips: {
        Args: { p_rows: Record<string, unknown>[] }
        Returns: {
          seen: number
          inserted: number
          updated: number
          unchanged: number
          skipped_carrier: number
          linked_pl: number
        }
      }
      push_tms_trips_and_sync: {
        Args: { p_rows: Record<string, unknown>[] }
        Returns: Record<string, unknown>
      }
      sync_tms_trip_status: {
        Args: Record<string, never>
        Returns: { trips: number; orders: number }
      }
      link_tms_orders_to_customers: {
        Args: Record<string, never>
        Returns: { linked: number }
      }
      preview_tms_trips: {
        Args: { p_date?: string | null }
        Returns: Record<string, unknown>
      }
      save_pod_with_photos: {
        Args: {
          p_order_id: number
          p_recipient_name: string
          p_signature_data: string
          p_photos: { path: string; kind: string }[]
          p_notes?: string | null
          p_lat?: number | null
          p_lng?: number | null
        }
        Returns: number
      }
      pod_photos_of_order: {
        Args: { p_order_id: number }
        Returns: { path: string; kind: string }[]
      }
      /* คืน json ก้อนเดียวหรือ null — ฝั่งเรียกกำหนดรูปร่างจริงเองที่ api/pod.ts
         ประกาศเป็น unknown ตรงนี้ เพราะโครงของ json_build_object ไม่ได้ถูก
         ตรวจจากฐาน การพิมพ์ซ้ำสองที่มีแต่จะเพี้ยนกันเงียบ ๆ ตอนแก้ข้างเดียว */
      pod_of_order: {
        Args: { p_order_id: number }
        Returns: unknown
      }
      log_trip_location: {
        Args: {
          p_trip_id: number
          p_lat: number
          p_lng: number
          p_accuracy_m?: number | null
        }
        Returns: void
      }
      tracking_board: {
        Args: Record<string, never>
        Returns: Record<string, unknown>[]
      }
      trip_track: {
        Args: { p_trip_id: number }
        Returns: Record<string, unknown>[]
      }
      remove_order: {
        Args: { p_order_id: number }
        Returns: { deleted: number; order_no: string }
      }
      set_stop_order: {
        Args: { p_trip_id: number; p_order_ids: number[] }
        Returns: void
      }
      import_tms_trip: {
        Args: { p_tms_id: string; p_driver_ids?: number[] | null }
        Returns: {
          trip_id: number
          created_orders: number
          linked_orders?: number
          orders_without_customer?: number
          already: boolean
        }
      }
      admin_force_delete_trip: {
        Args: { p_trip_id: number }
        Returns: {
          trip_no: string
          deleted_orders: number
          deleted_pods: number
          /* path ของรูปที่เพิ่งกำพร้า — ฝั่งเว็บสั่งลบไฟล์ต่อเอง เพราะลบจาก SQL
             ทำให้แถวหายแต่ไฟล์ยังอยู่ */
          orphan_photo_paths: string[]
        }
      }
      cleanup_tms_raw: {
        Args: { p_keep_days?: number }
        Returns: {
          deleted_bills: number
          deleted_trips: number
          keep_days: number
          db_bytes_before: number
          db_bytes_after: number
        }
      }
      usage_stats: {
        Args: Record<string, never>
        Returns: {
          db_bytes: number
          file_bytes: number
          file_objects: number
          mau_estimate: number
          tables: { name: string; bytes: number; approx_rows: number }[]
          buckets: { name: string; objects: number; bytes: number }[]
          measured_at: string
        }
      }
      verify_pod: {
        Args: { p_pod_id: number }
        Returns: { id: number; status: 'verified'; already: boolean }
      }
      unverify_pod: {
        Args: { p_pod_id: number; p_reason: string }
        Returns: { id: number; status: string; already: boolean }
      }
      refresh_order_item_qty: {
        Args: Record<string, never>
        Returns: { fixed: number; added: number }
      }
      reconcile_tms_trips: {
        Args: { p_from: string; p_to: string; p_warehouses: string[]; p_seen: string[] }
        Returns: {
          deleted: number
          shipments: number
          kept_imported: { trip_no: string; our_trip_id: number }[]
        }
      }
      auto_import_trips: {
        Args: Record<string, never>
        Returns: {
          imported: number
          created_orders: number
          waiting_for_driver: number
          failed: number
        }
      }
      accept_trip: {
        Args: { p_trip_id: number }
        Returns: { trip_id: number; already: boolean }
      }
      clear_trip_issue: {
        Args: { p_trip_id: number }
        Returns: void
      }
      report_trip_issue: {
        Args: { p_trip_id: number; p_note: string }
        Returns: void
      }
      tms_trip_detail: {
        Args: { p_tms_id: string }
        Returns: unknown
      }
      delete_vehicle: {
        Args: { p_id: number }
        Returns: { deleted: number; plate_no: string }
      }
      delete_customer: {
        Args: { p_id: number }
        Returns: { deleted: number; name: string }
      }
      suspected_duplicate_drivers: {
        Args: Record<string, never>
        Returns: unknown
      }
      merge_drivers: {
        Args: { p_keep: number; p_drop: number }
        Returns: { kept: number; name: string; removed: number; removed_name: string; moved_trips: number }
      }
      delete_driver: {
        Args: { p_id: number }
        Returns: { deleted: number; name: string }
      }
      create_driver_from_tms: {
        Args: { p_driver_key: string }
        Returns: { driver_id: number; name: string }
      }
      create_vehicle_from_tms: {
        Args: { p_plate: string }
        Returns: { vehicle_id: number; plate: string }
      }
      /* admin สร้างบัญชีจากหน้าเว็บ — 0015 อธิบายว่าทำไมฝั่ง auth ต้องอยู่ใน Edge Function */
      i_can: {
        Args: { p_permission: string }
        Returns: boolean
      }
      create_app_user: {
        Args: {
          p_auth_id: string
          p_username: string
          p_name: string
          p_role: UserRole
          p_as_driver?: boolean
          p_phone?: string | null
        }
        Returns: { user_id: number; driver_id: number | null }
      }
      attach_user_to_driver: {
        Args: { p_user_id: number; p_driver_id: number }
        Returns: { driver_id: number; user_id: number }
      }
      drivers_without_account: {
        Args: Record<string, never>
        Returns: { driver_id: number; name: string; phone: string | null }[]
      }
      /* ตัวตน — 0010 อธิบายว่าทำไม my_account ต้องอ่านจาก auth.uid() ตรง ๆ */
      my_account: {
        Args: Record<string, never>
        Returns:
          | { found: false }
          | {
              found: true
              user_id: number
              name: string
              username: string
              role: UserRole
              is_active: boolean
              source: 'local' | 'tms'
            }
      }
      approve_user: {
        Args: { p_user_id: number; p_role: UserRole }
        Returns: { user_id: number; name: string; role: UserRole }
      }
      revoke_user: {
        Args: { p_user_id: number }
        Returns: { user_id: number; is_active: boolean }
      }
      effective_permissions: { Args: { p_user_id: number }; Returns: UserPermissionRow[] }
      admin_save_user_permission: { Args: { p_user_id: number; p_permission: string; p_mode: PermissionMode; p_reason?: string | null }; Returns: void }
      admin_reset_user_permissions: { Args: { p_user_id: number; p_reason?: string | null }; Returns: void }
      clear_my_password_flag: { Args: Record<string, never>; Returns: void }
      drivers_busy_on: { Args: { p_date: string; p_driver_ids: number[] }; Returns: unknown }
      trip_accept_state: { Args: { p_trip_id: number }; Returns: unknown }
      log_tms_pull_run: {
        Args: {
          p_mode: string; p_date_from: string; p_date_to: string; p_warehouses: string[]
          p_trips_seen?: number; p_trips_ours?: number; p_rows_changed?: number
          p_ok?: boolean; p_error?: string | null
        }
        Returns: number
      }
      tms_pull_coverage: { Args: { p_hours?: number }; Returns: unknown }
      admin_set_role_permission: { Args: { p_role: UserRole; p_permission: string; p_allowed: boolean; p_reason?: string | null }; Returns: void }
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
