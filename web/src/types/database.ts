/**
 * ชื่อที่โค้ดในระบบใช้เรียกชนิดข้อมูลของตาราง — ทุกอันชี้ไปที่ database.generated.ts
 *
 * ===== อ่านก่อนแก้ =====
 * **ห้ามเขียนรูปร่างของตารางลงในไฟล์นี้** ของจริงมาจากฐานโดยตรง สร้างใหม่ด้วย
 *
 *     npx supabase gen types typescript --linked > web/src/types/database.generated.ts
 *
 * ไฟล์นี้เดิมเขียนมือทั้ง 783 บรรทัด เพราะตอนนั้นเชื่อว่ายังไม่ได้ link project ไว้
 * ซึ่งไม่จริง — ตรวจแล้ววันที่ 27 ส.ค. 69 ว่า link อยู่ตั้งแต่แรก คำสั่งข้างบนใช้ได้เลย
 * ราคาที่จ่ายไประหว่างนั้นคือทุกครั้งที่แก้ migration ต้องมาแก้ที่นี่ให้ตรงด้วยมือ
 * ลืมเมื่อไหร่ tsc ผ่านแต่ query พังตอน runtime ซึ่งเป็นความพังที่หาสาเหตุยากที่สุด
 *
 * ที่ยังต้องมีไฟล์นี้อยู่ ไม่ใช้ของ generated ตรง ๆ เพราะ:
 *  1. ชื่อสั้นกว่ามาก — `UserRow` เทียบกับ `Database['public']['Tables']['users']['Row']`
 *     ที่ต้องเขียนซ้ำในทุกไฟล์ของชั้น api
 *  2. เป็นจุดเดียวที่ต้องแก้ ถ้าวันหนึ่งเปลี่ยนชื่อตารางในฐาน
 *  3. เก็บชนิดที่ฐานไม่ได้บอกเราไว้ท้ายไฟล์ (ดูหัวข้อสุดท้าย)
 *
 * เพิ่มตารางใหม่ในฐานแล้วอยากใช้ที่นี่: generate ใหม่ แล้วเติมหนึ่งบรรทัดข้างล่าง
 */

/* Gen = ของที่ generate มาจากฐานตรง ๆ ห้ามแก้ไฟล์นั้นด้วยมือ
   ตั้งชื่อย่อเพราะ Database ถูกใช้เป็นชื่อของชนิดที่ประกอบเสร็จแล้วท้ายไฟล์ */
import type { Database as Gen } from './database.generated.js'

/* ---------- จุดที่ฐานบอกความจริงไม่ครบ ----------
   สองกรณีนี้เจอตอนย้ายมาใช้ types ที่ generate จากฐาน (27 ส.ค. 69) แต่ละอันคือ
   ที่ที่ schema อ่อนกว่าที่โค้ดสมมติไว้ เขียนไว้ตรงนี้ให้เห็นชัดว่ามีกี่จุด
   ทางแก้ที่ถูกจริงคือแก้ที่ฐาน แล้วลบตัวช่วยพวกนี้ทิ้ง */

/** คอลัมน์ที่ฐานบังคับว่าต้องมีค่า แต่มี trigger เติมให้ตอน insert
 *  generate ออกมาจึงเป็น "ต้องส่ง" ทั้งที่ของจริงปล่อยว่างได้ — ฐานไม่มีทางรู้เรื่อง trigger */
type FilledByTrigger<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/** คอลัมน์ text ที่รับได้แค่ไม่กี่ค่า แต่ไม่ได้ประกาศเป็น enum ในฐาน
 *  generate ออกมาได้แค่ string ซึ่งกว้างเกินจริง */
type Narrow<T, K extends keyof T, V> = Omit<T, K> & { [P in K]: V }

type Tables = Gen['public']['Tables']

type AppTables = Omit<Tables, 'orders' | 'quotes' | 'users'> & {
  orders: Omit<Tables['orders'], 'Row' | 'Insert'> & {
    /* work_kind: งานส่งรถ กับ งานส่งกล่อง คนละแบบกันทั้งจอ */
    Row: Narrow<Tables['orders']['Row'], 'work_kind', 'vehicle' | 'box' | null>
    /* order_no ตั้งเลขต่อจากใบล่าสุดของปีโดย trigger ใน 0007 */
    Insert: FilledByTrigger<Tables['orders']['Insert'], 'order_no'>
  }
  quotes: Omit<Tables['quotes'], 'Insert'> & {
    /* quote_no เหมือน order_no */
    Insert: FilledByTrigger<Tables['quotes']['Insert'], 'quote_no'>
  }
  users: Omit<Tables['users'], 'Row'> & {
    /* auth_source: บัญชีนี้เกิดจากล็อกอิน TMS หรือ admin สร้างให้ */
    Row: Narrow<Tables['users']['Row'], 'auth_source', 'local' | 'tms'>
  }
}

type Row<T extends keyof AppTables> = AppTables[T]['Row']
type Enum<T extends keyof Gen['public']['Enums']> = Gen['public']['Enums'][T]

/* ---------- ชุดค่าที่เป็น enum จริงในฐาน ----------
   ไม่ใช่คอลัมน์ text ที่มี check — ฐานปฏิเสธค่านอกรายการนี้ให้เอง
   เพิ่มค่าใหม่ต้องทำที่ migration แล้ว generate ใหม่ แก้ที่นี่อย่างเดียวไม่พอ */
export type UserRole = Enum<'user_role'>
export type VehicleType = Enum<'vehicle_type'>
export type VehicleStatus = Enum<'vehicle_status'>
export type DriverStatus = Enum<'driver_status'>
export type TripStatus = Enum<'trip_status'>
export type OrderStatus = Enum<'order_status'>
export type OrderPriority = Enum<'order_priority'>
export type PodStatus = Enum<'pod_status'>
export type QuoteStatus = Enum<'quote_status'>
export type InteractionType = Enum<'interaction_type'>
export type TaskStatus = Enum<'task_status'>

/* ---------- แถวของตาราง ---------- */
export type UserRow = Row<'users'>
export type UserPermissionRow = Row<'user_permissions'>
export type PermissionAuditRow = Row<'permission_audit_log'>
export type CustomerRow = Row<'customers'>
export type VehicleRow = Row<'vehicles'>
export type DriverRow = Row<'drivers'>
export type TripRow = Row<'trips'>
export type TripDriverRow = Row<'trip_drivers'>
export type VehicleOdometerRow = Row<'vehicle_odometer'>
export type OrderRow = Row<'orders'>
export type PodRow = Row<'pod'>
export type QuoteRow = Row<'quotes'>
export type CustomerInteractionRow = Row<'customer_interactions'>
export type CustomerTaskRow = Row<'customer_tasks'>
export type TmsShipmentRow = Row<'tms_shipments'>
export type TmsDealerMapRow = Row<'tms_dealer_map'>

/* ---------- แถวของวิว — ยังเขียนมือ ----------
   ของ generated ใช้แทนไม่ได้: Postgres ไม่เก็บ NOT NULL ของวิว ทุกคอลัมน์จึงออกมาเป็น
   `| null` หมดทั้งที่ของจริงไม่มีทางเป็น null (เช่น trip_no, status) ผลคือโค้ดที่เรียกใช้
   ต้องเช็ค null ทุกจุดโดยไม่มีเหตุผล หรือไม่ก็ใส่ ! ทิ้งไว้เต็มไปหมดซึ่งแย่กว่าเดิม

   ที่นี่จึงประกาศตามความจริงที่วิวรับประกันไว้เอง — **แก้วิวเมื่อไหร่ต้องมาแก้ตรงนี้ด้วย**
   ต่างจากส่วนตารางข้างบนที่ไม่ต้องแตะแล้วตลอดไป

   my_trips / my_orders คือสิ่งที่คนขับคนหนึ่งเห็น ไม่ใช่ทั้งตาราง — ตัวกรองอยู่ในวิว
   ฝั่งฐาน ไม่ได้อยู่ในคำสั่ง query ของแอป หน้าคนขับจึงขอข้อมูลของคนอื่นไม่ได้
   แม้แต่ตอนที่โค้ดฝั่งเราเขียนผิด */
export type MyTripRow = {
  id: number
  trip_no: string
  /* รถของเที่ยว — เปิดให้คนขับเห็นเฉพาะ id กับทะเบียน ไม่ใช่ทั้งแถวของ vehicles */
  vehicle_id: number
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
  cancel_reason: string | null
  cancelled_at: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_address: string | null
  has_pod: boolean
}

/* ---------- ชนิดที่ฐานไม่ได้บอกเรา ----------
   ไม่ใช่ enum ในฐาน เป็นคอลัมน์ text ที่ generate ออกมาได้แค่ `string` จึงต้องแคบให้เอง
   ถ้าวันหนึ่งย้ายไปเป็น enum จริงในฐาน ให้ลบทิ้งแล้วใช้ Enum<> แทน */
export type PermissionMode = 'inherit' | 'allow' | 'deny'


interface View<Row> {
  Row: Row
  Relationships: []
}

/**
 * ชนิดที่ supabase-js ใช้ — ตารางกับ enum มาจากฐานโดยตรง ส่วนวิวกับฟังก์ชันเขียนมือ
 *
 * ทำไมฟังก์ชันยังเขียนมือ: RPC ส่วนใหญ่คืน `json` หรือ `record` ซึ่ง generate ออกมา
 * ได้แค่ `Json` แปลว่าโค้ดที่เรียกจะไม่รู้เลยว่าในนั้นมีคีย์อะไร ของที่เขียนไว้ที่นี่
 * คือสัญญาที่อ่านมาจากตัว SQL จริง มีค่ามากกว่าและเป็นสิ่งเดียวที่กันการเรียกผิดคีย์
 *
 * **เพิ่ม/แก้ฟังก์ชันใน migration แล้วต้องมาแก้ที่นี่ด้วย** — เป็นหนี้ที่ยังตัดไม่ได้
 * จนกว่า RPC จะคืนชนิดที่ฐานบอกรูปร่างได้เอง
 */
export interface Database {
  public: {
    Tables: AppTables
    Views: {
      my_trips: View<MyTripRow>
      my_orders: View<MyOrderRow>
    }
    Functions: {
      start_trip: { Args: { p_trip_id: number }; Returns: void }
      deliver_order: { Args: { p_order_id: number }; Returns: void }
      finish_return: { Args: { p_trip_id: number; p_toll_cost: number | null }; Returns: { trip_id: number; trip_no: string } }
      log_odometer: { Args: { p_vehicle_id: number; p_reading_km: number; p_kind: 'start' | 'end' }; Returns: { vehicle_id: number; reading_km: number; kind: string; date: string } }
      odometer_status: { Args: { p_vehicle_id: number }; Returns: { logged_today: boolean; start_km: number | null; end_km: number | null; reading_km: number | null; last_km: number | null } }
      undo_deliver_order: {
        Args: { p_order_id: number }
        Returns: { order_id: number; order_no: string; pl_no: string | null }
      }
      complete_trip: { Args: { p_trip_id: number }; Returns: void }
      /* ยกเลิกจุดส่งทั้งร้าน — ใช้ร่วมกันทั้งจอคนขับและจอออฟฟิศ ฟังก์ชันเดียว
         แยกสิทธิ์ข้างในเอง คนขับได้เฉพาะเที่ยวตัวเองตอนกำลังวิ่ง */
      cancel_stop: {
        Args: { p_order_ids: number[]; p_reason: string }
        Returns: { cancelled: number; trip_id: number }
      }
      undo_cancel_stop: {
        Args: { p_order_ids: number[] }
        Returns: { restored: number; trip_id: number }
      }
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
      /* เช็คสิทธิ์แนบรูป POD — Edge Function pod-photo-upload เรียกก่อนแตะ R2 */
      pod_can_write: { Args: { p_order_id: number }; Returns: boolean }
      /* ถือ pod.write ไหม — Edge Function pod-photo-delete เรียกก่อนลบไฟล์กำพร้า */
      pod_photo_admin: { Args: Record<string, never>; Returns: boolean }
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
      dispatch_complete_trip: { Args: { p_trip_id: number }; Returns: { trip_no: string; closed: number; without_pod: number } }
      /** ถามก่อนกดปิด: ปิดแล้วจะกินกี่ใบ และในนั้นไม่มีหลักฐานกี่ใบ */
      trip_close_preview: { Args: { p_trip_id: number }; Returns: { trip_no: string | null; open_orders: number; without_pod: number } }
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
    Enums: Gen['public']['Enums']
    CompositeTypes: Gen['public']['CompositeTypes']
  }
}
