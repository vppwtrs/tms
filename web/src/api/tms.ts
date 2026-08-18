import { supabase, unwrap, toDataError } from './supabase.js'
import type { TmsShipmentRow, TmsDealerMapRow } from '../types/database.js'

/**
 * สะพานจาก TMS บริษัท — ไม่มีของเดิมใน server/ ให้แทน นี่เป็นของใหม่ทั้งก้อน
 *
 * ลำดับที่ตั้งใจให้เป็น: ดึง PL (คนกด/รอบ 5 นาที) -> preview -> คนจับคู่ร้าน -> import
 *
 * **ห้ามข้าม preview** ปุ่มนำเข้าที่กดแล้วเข้าเลยโดยไม่ให้ดูก่อน คือปุ่มที่คนกดแล้วเสียใจ
 * ชื่อร้านใน TMS ไม่ตรงกับชื่อลูกค้าในระบบเรา จับคู่ผิด = ออเดอร์ไปโผล่ผิดลูกค้าแบบเงียบ ๆ
 */

export async function listShipments(date: string): Promise<TmsShipmentRow[]> {
  return unwrap(
    /* วันที่วางแผนส่ง ไม่ใช่ trip_date — ใบสถานะ New ยังไม่มีเที่ยว จึงไม่มี trip_date
       กรองด้วย trip_date คือทำให้ใบที่ต้องวางแผนมากที่สุดหายไปทั้งหมด (ดู 0012) */
    supabase.from('tms_shipments').select('*').eq('plan_delivery_date', date).order('picking_list_no'),
  )
}

export interface UnmappedDealer {
  dealer_code: string
  dealer_name: string
  picking_lists: number
  /* ที่อยู่ปลายทางมาพร้อม PL header อยู่แล้ว — ใช้สร้างลูกค้าใหม่ได้ทันที
     ให้คนพิมพ์ที่อยู่ซ้ำจากหน้า TMS คือที่มาของที่อยู่ผิดที่คนขับต้องไปเจอเอง */
  ship_to_name: string | null
  address: string | null
  province: string | null
}

export interface ImportPreview {
  date: string
  picking_lists: number
  trips: number
  already_imported: number
  /* ใบที่ส่งจบแล้ว — เก็บไว้ในตารางเพื่อเฝ้าสถานะ แต่ไม่นำเข้าเป็นออเดอร์
     นำเข้ามาก็ได้ออเดอร์ pending ที่ไม่มีอะไรให้ทำ */
  not_plannable: number
  unmapped_dealers: UnmappedDealer[]
  unknown_plates: string[]
}

export async function previewImport(date: string): Promise<ImportPreview> {
  const { data, error } = await supabase.rpc('preview_tms_import', { p_date: date })
  if (error) throw toDataError(error)
  return data as ImportPreview
}

/** ใบที่ร้านยังไม่จับคู่จะถูก "ข้าม" ไม่ใช่ทำให้ทั้งวันล้ม — ดู skipped ในผลลัพธ์
 *  เรียกซ้ำวันเดิมได้ ใบที่เข้าไปแล้วจะไม่ถูกสร้างซ้ำ */
export async function importShipments(date: string): Promise<{ date: string; created: number; skipped: number }> {
  const { data, error } = await supabase.rpc('import_tms_shipments', { p_date: date })
  if (error) throw toDataError(error)
  return data as { date: string; created: number; skipped: number }
}

/* ---------- เที่ยวของ TMS ---------- */

export interface TmsTripPreviewRow {
  tms_id: string
  trip_no: string
  status: string | null
  status_id: number | null
  reason: string | null
  license_plate: string | null
  driver_name: string | null
  area: string | null
  vehicle_type: string | null
  total_pl: number | null
  total_unit: number | null
  warehouse_code: string | null
  imported: boolean
  trip_id: number | null
  /* null = ยังไม่จับคู่คนขับ ซึ่งเป็นเรื่องเดียวที่กันการนำเข้า —
     ทะเบียนไม่กัน (ระบบสร้างรถให้เอง) และใบที่ร้านยังไม่จับคู่ก็ไม่กัน (เที่ยวไปทั้งก้อน) */
  driver_id: number | null
  /* TMS ส่งชื่อคนขับมาเป็นก้อนเดียว เที่ยวที่ไปสองคนคั่นด้วยคอมมา
     นี่คือชื่อที่แยกแล้วและยังไม่รู้จัก — ต้องจับคู่ให้ครบทุกชื่อก่อนนำเข้า */
  unmapped_driver_names: string[]
  unmapped_pls: number
  pls_in_db: number
  /* ค่าจ้างตามสัญญา — null คือ TMS ยังไม่ลงตัวเลข ไม่ใช่ศูนย์บาท */
  cost: number | null
  /* ที่ปิดจริงหลังจบงาน ต่างจาก cost ได้เมื่อมีจุดส่งเพิ่ม/ค่าล่วงเวลา */
  actual_cost: number | null
}

export interface TmsTripsPreview {
  date: string | null
  latest_date: string | null
  trips: TmsTripPreviewRow[]
  unmapped_drivers: string[]
  /* ออเดอร์ที่นำเข้ามาแล้วแต่ยังไม่รู้ว่าเป็นลูกค้ารายไหน — งานยังส่งคนขับได้ปกติ */
  orders_without_customer: number
  /* TMS ยกเลิกเที่ยวที่เรานำเข้าไปแล้ว — ระบบไม่ยกเลิกให้เอง รถอาจวิ่งออกไปแล้ว */
  cancelled_after_import: { trip_no: string; reason: string | null; our_trip_id: number }[]
}

export async function previewTrips(date?: string): Promise<TmsTripsPreview> {
  const { data, error } = await supabase.rpc('preview_tms_trips', { p_date: date ?? null })
  if (error) throw toDataError(error)
  return data as unknown as TmsTripsPreview
}

/** สร้างเที่ยว + ออเดอร์ของใบในเที่ยวในทรานแซกชันเดียว
 *  กดซ้ำเที่ยวเดิมไม่สร้างเที่ยวที่สอง (คืน `already: true`) */
export async function importTrip(tmsId: string): Promise<{
  trip_id: number
  trip_no?: string
  status?: string
  created_orders: number
  linked_orders?: number
  orders_without_customer?: number
  already: boolean
}> {
  const { data, error } = await supabase.rpc('import_tms_trip', { p_tms_id: tmsId })
  if (error) throw toDataError(error)
  return data as { trip_id: number; created_orders: number; already: boolean }
}

/**
 * นำเข้าเที่ยวที่พร้อมส่งให้คนขับโดยอัตโนมัติ
 *
 * จงใจนำเข้าเฉพาะเที่ยวที่มี driver_id แล้วเท่านั้น เพราะ RLS ของหน้าคนขับ
 * ผูกกับคนขับในเที่ยว ถ้านำเข้าเที่ยวที่ยังจับคู่ไม่ได้ งานจะถูกสร้างแต่ไม่มี
 * ใครเห็น และถ้าเดาผิด งานจะไปอยู่ในมือคนขับผิดคน
 */
export async function autoImportReadyTrips(): Promise<{
  checked: number
  imported: number
  createdOrders: number
  waitingForDriver: number
}> {
  const preview = await previewTrips()
  const ready = preview.trips.filter((t) => t.driver_id && !t.imported && t.status_id !== 6)
  const waitingForDriver = preview.trips.filter((t) => !t.driver_id && !t.imported && t.status_id !== 6).length
  let imported = 0
  let createdOrders = 0

  for (const trip of ready) {
    const result = await importTrip(trip.tms_id)
    if (!result.already) {
      imported++
      createdOrders += result.created_orders ?? 0
    }
  }

  return { checked: preview.trips.length, imported, createdOrders, waitingForDriver }
}

/** สร้างคนขับ/รถจากข้อมูลของ TMS พร้อมจับคู่ให้ — คนกดต่อคน/ต่อคัน ระบบไม่เดาชื่อ
 *  คนขับที่เกิดจากที่นี่ยังไม่มีบัญชีผู้ใช้ จึงยังเข้าแอปไม่ได้จนกว่าจะมีคนสร้างบัญชีให้ */
export async function createDriverFromTms(driverKey: string): Promise<{ driver_id: number; name: string }> {
  const { data, error } = await supabase.rpc('create_driver_from_tms', { p_driver_key: driverKey })
  if (error) throw toDataError(error)
  return data as { driver_id: number; name: string }
}

/** เติม customer_id ให้ออเดอร์ที่นำเข้าไปก่อนที่ร้านจะถูกจับคู่
 *  ต้องมี ไม่งั้นทางแก้เดียวคือลบออเดอร์แล้วนำเข้าใหม่ ซึ่งพาลบ POD ที่คนขับเก็บไว้ไปด้วย */
export async function linkOrdersToCustomers(): Promise<{ linked: number }> {
  const { data, error } = await supabase.rpc('link_tms_orders_to_customers')
  if (error) throw toDataError(error)
  return data as { linked: number }
}

export async function createVehicleFromTms(plate: string): Promise<{ vehicle_id: number; plate: string }> {
  const { data, error } = await supabase.rpc('create_vehicle_from_tms', { p_plate: plate })
  if (error) throw toDataError(error)
  return data as { vehicle_id: number; plate: string }
}

/* ---------- ตารางจับคู่ร้าน ---------- */

export async function listDealerMap(): Promise<TmsDealerMapRow[]> {
  return unwrap(supabase.from('tms_dealer_map').select('*').order('dealer_name'))
}

/** สร้างลูกค้าจากร้านของ TMS แล้วจับคู่ให้ในจังหวะเดียว
 *
 *  เป็น RPC ไม่ใช่ insert + upsert สองคำสั่งจากหน้าจอ เพราะเน็ตหลุดกลางทางแล้วจะได้
 *  ลูกค้าที่ไม่ผูกกับร้านไหนลอยอยู่ แล้วคนก็กดสร้างใหม่ กลายเป็นลูกค้าซ้ำชื่อเดียวกันสองราย
 *
 *  ยังไม่ใช่การเดา — คนต้องกดปุ่มต่อร้าน ต่างจากการ match ชื่ออัตโนมัติที่ผิดแล้วเงียบ */
export async function createCustomerFromDealer(
  dealerCode: string,
): Promise<{ customer_id: number; name: string }> {
  const { data, error } = await supabase.rpc('create_customer_from_dealer', { p_dealer_code: dealerCode })
  if (error) throw toDataError(error)
  return data as { customer_id: number; name: string }
}

export async function mapDealer(input: {
  dealer_code: string
  dealer_name: string
  customer_id: number | null
  ignored?: boolean
  mapped_by: number | null
}): Promise<TmsDealerMapRow> {
  return unwrap(
    supabase
      .from('tms_dealer_map')
      .upsert({ ...input, mapped_at: new Date().toISOString() }, { onConflict: 'dealer_code' })
      .select()
      .single(),
  )
}
