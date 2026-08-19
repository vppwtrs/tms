import { Fragment, useCallback, useEffect, useState } from 'react'
import { listOrders, createOrder, updateOrder, removeOrder, type OrderListRow } from '../api/orders'
import { useRealtime } from '../hooks/useRealtime'
import { PodViewModal } from '../components/PodViewModal'
import { listAllCustomers } from '../api/customers'
import { listDrivers } from '../api/vehicles'
import type { Paged } from '../api/customers'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { CustomerRow, DriverRow, OrderPriority, OrderStatus } from '../types/database'
import {
  ORDER_STATUS_LABEL, ORDER_STATUS_ORDER, ORDER_TONE,
} from '../utils/constants'
import { dateInputToIso, fmtDate, fmtMoney, fmtRoute, isoToDateInput } from '../utils/format'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal,
  PageHeader, Pagination, SearchInput, Select, TableSkeleton,
} from '../components/ui'
import { IconBox, IconEdit, IconPlus, IconTrash } from '../components/icons'

/**
 * จัดการออเดอร์ ฉบับคลาวด์ — คู่ขนานกับ Orders.tsx บน LAN
 *
 * ต่างจากของเดิมสามอย่าง อย่างแรกเป็นเรื่องเทคนิค สองอย่างหลังคือของที่ยังไม่มี:
 *
 *   1. ชื่อลูกค้า/คนขับ/เลขเที่ยว มาจาก embedded resource ของ PostgREST
 *      ไม่ใช่ JOIN ที่ server เขียนเอง (ดู api/orders.ts)
 *   2. **ยังไม่มีปุ่มพิมพ์ใบนำส่ง** — ของเดิมยิง /orders/:id/bol ซึ่งเป็น endpoint
 *      ของ Express ฝั่งคลาวด์ยังไม่มีตัวแทน ใส่ปุ่มที่กดแล้วพังไม่ช่วยใคร
 *   3. **ยังไม่มีหน้าต่าง POD** ด้วยเหตุผลเดียวกัน (PodModal ยิง /pod/... ตรง ๆ)
 *      สถานะ POD ยังโชว์ให้เห็นว่ามีหรือไม่มี แค่กดเข้าไปดูรูปยังไม่ได้
 *
 * ยกเลิกออเดอร์คือเปลี่ยนสถานะ ไม่ใช่ลบแถว — ประวัติงานที่ยกเลิกคือข้อมูลที่ต้องใช้
 * ตอบลูกค้าทีหลัง 0003 ไม่มี policy delete บนตารางนี้เลยด้วยซ้ำ
 */

/* การ์ดหนึ่งใบต่อหนึ่งเที่ยว — หน้าละ 15 ใบทำให้เที่ยวเดียวกินทั้งหน้าแล้วยังไม่ครบ
   ต้องเห็นทั้งเที่ยวจบในหน้าเดียว ไม่งั้นการจัดกลุ่มก็ไม่ได้ตอบอะไร */
const PAGE_SIZE = 100

type OrderKind = 'vehicle' | 'box'

/* TMS ส่งชนิดงานมากับชื่อสินค้าในรูปแบบที่ใช้งานจริง:
   BOX... = ชิ้นงานกล่อง ส่วนรายการรุ่นรถ เช่น SPRINT... = รถ */
const orderKind = (kind: OrderKind | null, goods: string): OrderKind =>
  kind ?? (/^box\b/i.test(goods.trim()) ? 'box' : 'vehicle')

interface OrderForm {
  customer_id: string
  origin: string
  destination: string
  distance_km: string
  goods_desc: string
  weight_kg: string
  fee: string
  priority: OrderPriority
  scheduled_at: string
  notes: string
}

const emptyForm: OrderForm = {
  customer_id: '', origin: '', destination: '', distance_km: '', goods_desc: '',
  weight_kg: '', fee: '', priority: 'normal', scheduled_at: '', notes: '',
}

/** เลขที่ใช้เรียกใบนี้กับคนนอกระบบ — PL ก่อนเสมอ
 *
 * ORD เป็นเลขที่ระบบเราสร้างเอง คลัง ร้านค้า และคนขับไม่รู้จัก เวลาโทรตามของ
 * ทุกฝ่ายอ้าง PL ใบที่สร้างเองในระบบ (ไม่มี PL) จึงเป็นกรณีเดียวที่ยังต้องใช้ ORD
 */
function billNo(o: OrderListRow): string {
  return o.tms_picking_list_no ?? o.order_no
}

interface StoreGroup {
  key: string
  store: string
  destination: string
  rows: OrderListRow[]
  /* สรุปหลักฐานระดับ "จุดแวะ" ไม่ใช่ระดับใบ — คนขับเซ็นครั้งเดียวที่หน้าร้าน
     แล้วลายเซ็นชุดนั้นถูกบันทึกลงทุกใบของร้านนั้น ป้ายรายใบจึงพูดข้อเท็จจริง
     เดียวกันซ้ำเท่าจำนวนใบ ซึ่งอ่านเหมือนมีหลักฐานหลายชุดทั้งที่มีชุดเดียว */
  delivered: number
  withPod: number
  verified: number
  /* ใบที่ใช้เปิดดูหลักฐานของจุดนี้ — ใบไหนก็ได้ที่มี POD เพราะเป็นลายเซ็นใบเดียวกัน */
  podRow: OrderListRow | null
}

/** ป้ายหลักฐานของจุดแวะ — บอกความจริงระดับจุด ไม่ใช่ระดับใบ
 *  "มี POD" เฉย ๆ ตอบไม่ได้ว่าครบทุกใบหรือยัง ซึ่งเป็นคำถามเดียวที่คนวางแผนถาม */
function podStopLabel(store: { delivered: number; withPod: number; verified: number }): string {
  if (store.verified === store.delivered) return 'ยืนยันแล้ว'
  if (store.withPod === store.delivered) return store.delivered > 1 ? `มี POD · ${store.delivered} ใบ` : 'มี POD'
  return `มี POD ${store.withPod}/${store.delivered} ใบ`
}

interface TripGroup {
  key: string
  tripNo: string
  driver: string | null
  scheduled: string
  stores: StoreGroup[]
  bills: number
}

/**
 * จัดชั้นตามที่งานจริงเป็น: เที่ยว แล้วร้าน แล้วใบ แล้วรายการของ
 *
 * ตารางแบนที่หนึ่งแถวคือหนึ่งใบ ทำให้เลขเที่ยวกับชื่อร้านซ้ำลงมาทุกบรรทัด
 * จนอ่านไม่ออกว่าเที่ยวหนึ่งแวะกี่ร้าน และร้านหนึ่งต้องยกของกี่ใบ ซึ่งเป็น
 * สองคำถามแรกที่คนวางแผนถามเสมอ
 *
 * แถวยังเป็นหนึ่งใบเหมือนเดิม เพราะปุ่มแก้ไข/ยกเลิกและ POD ผูกกับใบ ไม่ใช่ผูกกับร้าน
 */
function groupOrders(rows: OrderListRow[]): TripGroup[] {
  const norm = (v: string | null): string => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const trips = new Map<string, Map<string, OrderListRow[]>>()

  for (const o of rows) {
    /* ใบที่ยังไม่จัดเที่ยวไปรวมกันเป็นก้อนเดียว — เป็นกองงานที่ต้องจัด ไม่ใช่เที่ยว */
    const tripKey = String(o.trip_id ?? 0)
    const storeKey = `${norm(o.customer_name) || norm(o.destination)}|${norm(o.destination)}`
    let stores = trips.get(tripKey)
    if (!stores) { stores = new Map(); trips.set(tripKey, stores) }
    const found = stores.get(storeKey)
    if (found) found.push(o)
    else stores.set(storeKey, [o])
  }

  return [...trips.entries()].map(([tripKey, stores]) => {
    const all = [...stores.values()].flat()
    const first = all[0] as OrderListRow
    return {
      key: tripKey,
      tripNo: first.tms_trip_no ?? first.trip_no ?? 'ยังไม่จัดเที่ยว',
      driver: first.driver_name,
      scheduled: first.scheduled_at,
      bills: all.length,
      stores: [...stores.entries()].map(([storeKey, group]) => {
        const head = group[0] as OrderListRow
        /* ในร้านเรียงตามเลข PL — เลขเดียวกับที่คลังยื่นใบมาให้ */
        const rows = [...group].sort((a, b) => billNo(a).localeCompare(billNo(b), 'th'))
        const delivered = rows.filter((r) => r.status === 'delivered')
        const withPod = delivered.filter((r) => r.pod_status)
        return {
          key: `${tripKey}|${storeKey}`,
          store: head.customer_name ?? head.destination,
          destination: head.destination,
          rows,
          delivered: delivered.length,
          withPod: withPod.length,
          verified: withPod.filter((r) => r.pod_status === 'verified').length,
          podRow: withPod[0] ?? null,
        }
      }),
    }
  })
}

export default function CloudOrders(): React.JSX.Element {
  const { can } = useCloudAuth()
  const { push } = useToast()
  const canEdit = can('orders.write')
  const canCancel = can('orders.cancel')

  const [data, setData] = useState<Paged<OrderListRow> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [page, setPage] = useState(1)
  /* ร้านที่กางอยู่ — ปิดไว้เป็นค่าเริ่มต้น หน้านี้ตอบคำถาม "เที่ยวนี้แวะร้านไหนบ้าง"
     ก่อนเสมอ รายการของเป็นคำถามที่สองซึ่งถามทีละร้าน ไม่ได้ถามพร้อมกันทุกร้าน */
  const [openStores, setOpenStores] = useState<Set<string>>(new Set())
  const toggleStore = (key: string): void => setOpenStores((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [driverId, setDriverId] = useState('')

  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [drivers, setDrivers] = useState<DriverRow[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<OrderListRow | null>(null)
  const [form, setForm] = useState<OrderForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState<OrderListRow | null>(null)
  /* ใบที่กำลังเปิดดูหลักฐาน — เก็บทั้งใบไว้เพราะหัวหน้าต่างต้องขึ้นเลข PL ไม่ใช่ id */
  const [podOrder, setPodOrder] = useState<OrderListRow | null>(null)
  /* ลายเซ็นชุดเดียวถูกบันทึกลงทุกใบของร้าน หน้าต่างจึงต้องบอกว่ามันครอบกี่ใบ
     ไม่งั้นคนเปิดจากใบเดียวจะเข้าใจว่าใบอื่นยังไม่มีหลักฐาน */
  const [podCovers, setPodCovers] = useState(1)
  const [cancelLoading, setCancelLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      setData(await listOrders({
        q: q || undefined,
        status: (status || undefined) as OrderStatus | undefined,
        priority: (priority || undefined) as OrderPriority | undefined,
        from: from ? `${from}T00:00:00` : undefined,
        to: to ? `${to}T23:59:59` : undefined,
        driverId: driverId ? Number(driverId) : undefined,
        page,
        limit: PAGE_SIZE,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดออเดอร์ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [q, status, priority, from, to, driverId, page])

  useEffect(() => {
    const t = setTimeout(() => void load(), 300)
    return () => clearTimeout(t)
  }, [load])

  /* ออเดอร์ขยับได้จากหลายทาง: คนจัดรถแก้เอง, การนำเข้าเที่ยวจาก TMS, คนขับปิดงาน
     ฟังตารางที่กระทบตารางนี้ทั้งหมด ไม่ใช่แค่ orders */
  useRealtime(['orders', 'trips', 'pod'], () => void load())

  useEffect(() => {
    listAllCustomers().then(setCustomers).catch(() => setCustomers([]))
    /* เอาคนขับทุกคน ไม่ใช่เฉพาะคนว่าง — คนที่กำลังวิ่งอยู่คือคนที่ฝ่ายวางแผนอยากกรองดูที่สุด */
    listDrivers({ limit: 200 }).then((r) => setDrivers(r.rows)).catch(() => setDrivers([]))
  }, [])

  const set = (key: keyof OrderForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const openCreate = (): void => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (o: OrderListRow): void => {
    setEditing(o)
    setForm({
      customer_id: o.customer_id ? String(o.customer_id) : '',
      origin: o.origin,
      destination: o.destination,
      distance_km: String(o.distance_km),
      goods_desc: o.goods_desc,
      weight_kg: String(o.weight_kg),
      fee: String(o.fee),
      priority: o.priority,
      scheduled_at: isoToDateInput(o.scheduled_at),
      notes: o.notes ?? '',
    })
    setFormOpen(true)
  }

  const save = async (): Promise<void> => {
    if (!form.origin.trim() || !form.destination.trim() || !form.goods_desc.trim() || !form.scheduled_at) {
      push('warning', 'กรอกข้อมูลที่จำเป็นให้ครบ (เส้นทาง, สินค้า, กำหนดส่ง)')
      return
    }
    setSaving(true)
    try {
      const payload = {
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        origin: form.origin.trim(),
        destination: form.destination.trim(),
        distance_km: Number(form.distance_km || 0),
        goods_desc: form.goods_desc.trim(),
        weight_kg: Number(form.weight_kg || 0),
        fee: Number(form.fee || 0),
        priority: form.priority,
        scheduled_at: dateInputToIso(form.scheduled_at),
        notes: form.notes.trim() || null,
      }
      if (editing) {
        await updateOrder(editing.id, payload)
        push('success', `แก้ไขใบ ${billNo(editing)} เรียบร้อย`)
      } else {
        await createOrder(payload)
        push('success', 'สร้างออเดอร์เรียบร้อย')
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const confirmCancel = async (): Promise<void> => {
    if (!cancelling) return
    setCancelLoading(true)
    try {
      await removeOrder(cancelling.id)
      push('success', `ลบใบ ${billNo(cancelling)} แล้ว — ใบจาก TMS กลับไปสั่งงานใหม่ได้`)
      setCancelling(null)
      await load()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'ยกเลิกไม่สำเร็จ')
    } finally {
      setCancelLoading(false)
    }
  }

  const resetFilters = (): void => {
    setQ(''); setStatus(''); setPriority(''); setFrom(''); setTo(''); setDriverId(''); setPage(1)
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

  return (
    <>
      <PageHeader
        title="จัดการออเดอร์"
        subtitle="ออเดอร์ขนส่งทั้งหมด — ค้นหา กรอง ดูสถานะ และจัดการ"
        actions={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>สร้างออเดอร์</Button>}
      />

      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="ค้นหาเลขที่ / เส้นทาง / สินค้า..." />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} style={{ width: 150 }}>
          <option value="">สถานะทั้งหมด</option>
          {ORDER_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <Select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1) }} style={{ width: 130 }}>
          <option value="">ความสำคัญทั้งหมด</option>
          <option value="normal">ปกติ</option>
          <option value="urgent">ด่วน</option>
        </Select>
        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} style={{ width: 150 }} title="กำหนดส่ง ตั้งแต่" />
        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} style={{ width: 150 }} title="ถึง" />
        <Select value={driverId} onChange={(e) => { setDriverId(e.target.value); setPage(1) }} style={{ width: 170 }} title="คนขับที่รับผิดชอบ">
          <option value="">คนขับทั้งหมด</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </Select>
        <div className="spacer" />
        {(q || status || priority || from || to || driverId) && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>ล้างตัวกรอง</Button>
        )}
      </div>

      {error ? (
        <ErrorBox message={error} onRetry={() => void load()} />
      ) : loading || !data ? (
        <TableSkeleton rows={10} cols={6} />
      ) : data.rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconBox size={40} />}
            title="ไม่พบออเดอร์"
            desc={q || status || priority ? 'ลองเปลี่ยนเงื่อนไขการค้นหา' : 'ดึงข้อมูลจาก TMS แล้วนำเข้าเป็นออเดอร์ หรือสร้างเองทีละใบ'}
            action={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>สร้างออเดอร์</Button>}
          />
        </div>
      ) : (
        /* รูปแบบเดียวกับหน้าตรวจเที่ยวจาก TMS: การ์ดเที่ยว ในนั้นเป็นการ์ดร้าน
           ในนั้นเป็นใบ แล้วรายการของอยู่ในใบ — ไม่ตัดอะไรทิ้ง เห็นครบทุกชั้น
           ตารางทำแบบนี้ไม่ได้ เพราะสามชั้นซ้อนกันในตารางเดียวอ่านเป็นแถวแบน ๆ เสมอ */
        <div style={{ display: 'grid', gap: 14 }}>
          {groupOrders(data.rows).map((trip) => (
            <section key={trip.key} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="text-strong" style={{ fontSize: 15 }}>{trip.tripNo}</span>
                <span className="text-xs text-muted">
                  {trip.stores.length} ร้าน · {trip.bills} ใบ · {fmtDate(trip.scheduled)}
                </span>
                <div style={{ flex: 1 }} />
                <span className="text-xs text-muted">
                  {trip.driver ?? 'ยังไม่จัดคิว'}
                </span>
              </div>

              {trip.stores.map((store) => {
                const open = openStores.has(store.key)
                return (
                <div key={store.key} className="card store-card" style={{ padding: 0, marginTop: 10 }}>
                  {/* ชื่อร้านเป็นปุ่ม — ทั้งแถบกดได้ ไม่ใช่ลูกศรเล็ก ๆ ที่ต้องเล็งกด */}
                  <div className="store-head-row">
                    <button type="button" className="store-head" aria-expanded={open} onClick={() => toggleStore(store.key)}>
                      <span className={`store-caret${open ? ' is-open' : ''}`} aria-hidden="true">›</span>
                      <span className="store-head-text">
                        <span className="text-strong">{store.store}</span>
                        <span className="text-xs text-muted">{store.destination}</span>
                      </span>
                      <span className="text-xs text-muted">{store.rows.length} ใบ</span>
                    </button>
                    {/* หลักฐานของทั้งจุดแวะ อยู่นอกปุ่มพับ/กาง — เห็นได้โดยไม่ต้องกางร้าน
                        และปุ่มซ้อนในปุ่มเป็นสิ่งที่ HTML ไม่ยอมรับตั้งแต่แรก */}
                    {store.delivered > 0 && (
                      store.podRow ? (
                        <button
                          type="button"
                          className="pod-badge-btn"
                          onClick={() => { setPodOrder(store.podRow); setPodCovers(store.withPod) }}
                          title="ดูลายเซ็นและรูปหลักฐานของจุดนี้"
                        >
                          <Badge
                            label={podStopLabel(store)}
                            tone={store.verified === store.delivered ? 'delivered' : 'in_transit'}
                            dot={store.verified < store.delivered}
                          />
                        </button>
                      ) : (
                        <Badge label="ไม่มี POD" tone="pending" />
                      )
                    )}
                  </div>

                  {open && (
                  <div className="store-body">
                  {store.rows.map((o) => (
                    <div
                      key={o.id}
                      style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}
                    >
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* เลขที่ใช้เรียกใบนี้กับคนนอกระบบคือ PL ไม่ใช่ ORD ที่เราสร้างเอง */}
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{billNo(o)}</span>
                        {o.priority === 'urgent' && <Badge label="ด่วน" tone="urgent" dot />}
                        {!o.tms_picking_list_no && <Badge label="สร้างเอง" tone="neutral" />}
                        <Badge
                          label={orderKind(o.work_kind, o.goods_desc) === 'box' ? 'กล่อง' : 'รถ'}
                          tone={orderKind(o.work_kind, o.goods_desc) === 'box' ? 'accent' : 'neutral'}
                        />
                        <Badge label={ORDER_STATUS_LABEL[o.status]} tone={ORDER_TONE[o.status]} dot={o.status === 'in_transit'} />
                        {/* ป้ายรายใบขึ้นเฉพาะตอนที่จุดนี้ "ไม่เท่ากัน" — บางใบมีหลักฐาน
                            บางใบไม่มี ตอนนั้นเท่านั้นที่ป้ายรายใบบอกอะไรใหม่
                            ถ้าทั้งจุดเหมือนกันหมด ป้ายบนหัวร้านพูดแทนไปแล้ว */}
                        {o.status === 'delivered' && store.withPod > 0 && store.withPod < store.delivered && (
                          o.pod_status ? (
                            <button
                              type="button"
                              className="pod-badge-btn"
                              onClick={() => { setPodOrder(o); setPodCovers(1) }}
                              title="ดูลายเซ็นและรูปหลักฐาน"
                            >
                              <Badge
                                label={o.pod_status === 'verified' ? 'ยืนยันแล้ว' : 'มี POD'}
                                tone={o.pod_status === 'verified' ? 'delivered' : 'in_transit'}
                                dot={o.pod_status === 'collected'}
                              />
                            </button>
                          ) : (
                            <Badge label="ยังไม่เซ็น" tone="pending" />
                          )
                        )}
                        <div style={{ flex: 1 }} />
                        <span className="text-xs text-muted">
                          {fmtMoney(o.fee)}
                          {' · '}{fmtDate(o.scheduled_at)}
                          {o.delivered_at ? ` · ส่ง ${fmtDate(o.delivered_at)}` : ''}
                        </span>
                        <div className="actions">
                          {canEdit && (o.status === 'pending' || o.status === 'assigned') && (
                            <Button variant="ghost" size="sm" title="แก้ไข" onClick={() => openEdit(o)}><IconEdit size={14} /></Button>
                          )}
                          {canCancel && (o.status === 'pending' || o.status === 'assigned') && (
                            <Button variant="ghost" size="sm" title="ยกเลิก" className="text-danger" onClick={() => setCancelling(o)}><IconTrash size={14} /></Button>
                          )}
                        </div>
                      </div>

                      {/* รายการของครบทุกบรรทัด ไม่ย่อ ไม่ตัดท้าย — บรรทัดพวกนี้คือสิ่งที่
                          คนโหลดของเทียบกับใบจริงทีละรุ่น */}
                      {o.items.length > 0 ? (
                        o.items.map((it) => (
                          <div
                            key={it.item_no}
                            style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '2px 0' }}
                          >
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{it.item_no}</span>
                            <span className="text-muted" style={{ flex: 1 }}>{it.item_name ?? ''}</span>
                            <span>×{it.qty}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-muted" style={{ marginTop: 2 }}>{o.goods_desc}</div>
                      )}
                    </div>
                  ))}
                  </div>
                  )}
                </div>
                )
              })}
            </section>
          ))}
        </div>
      )}

      {data && data.total > 0 && (
        <Pagination page={page} totalPages={totalPages} total={data.total} onChange={setPage} />
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `แก้ไขใบ ${billNo(editing)}` : 'สร้างออเดอร์ใหม่'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>ยกเลิก</Button>
            <Button variant="accent" onClick={() => void save()} loading={saving}>{editing ? 'บันทึกการแก้ไข' : 'สร้างออเดอร์'}</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="ลูกค้า">
            <Select value={form.customer_id} onChange={set('customer_id')}>
              <option value="">— ไม่ระบุ —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="กำหนดส่ง" required>
            <Input type="date" value={form.scheduled_at} onChange={set('scheduled_at')} />
          </Field>
          <Field label="ต้นทาง" required>
            <Input value={form.origin} onChange={set('origin')} placeholder="เช่น กรุงเทพฯ" />
          </Field>
          <Field label="ปลายทาง" required>
            <Input value={form.destination} onChange={set('destination')} placeholder="เช่น ชลบุรี" />
          </Field>
          <Field label="ระยะทาง (กม.)">
            <Input type="number" min={0} value={form.distance_km} onChange={set('distance_km')} placeholder="130" />
          </Field>
          {/* ช่องน้ำหนักถูกซ่อน — ยังไม่มีใครใช้ตัวเลขนี้ในงานจริง และ TMS ไม่ส่งมาให้
              คอลัมน์ในฐานยังอยู่ครบ ใบที่สร้างเองบันทึกเป็น 0 ถ้าวันหนึ่งต้องชั่งจริง
              เปิดช่องนี้กลับมาแล้วข้อมูลเก่ายังอ่านได้เหมือนเดิม */}
          <Field label="รายละเอียดสินค้า" required>
            <Input value={form.goods_desc} onChange={set('goods_desc')} placeholder="เช่น เครื่องใช้ไฟฟ้า" />
          </Field>
          <Field label="ค่าขนส่ง (บาท)">
            <Input type="number" min={0} value={form.fee} onChange={set('fee')} placeholder="2500" />
          </Field>
          <Field label="ความสำคัญ">
            <Select value={form.priority} onChange={set('priority')}>
              <option value="normal">ปกติ</option>
              <option value="urgent">ด่วน</option>
            </Select>
          </Field>
          <Field label="หมายเหตุ">
            <Input value={form.notes} onChange={set('notes')} placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" />
          </Field>
        </div>
      </Modal>

      {podOrder && (
        <PodViewModal orderId={podOrder.id} billNo={billNo(podOrder)} covers={podCovers} onClose={() => setPodOrder(null)} />
      )}

      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="ยืนยันการยกเลิกออเดอร์"
        message={cancelling ? <>ต้องการลบใบ <b>{billNo(cancelling)}</b> ({cancelling.origin} → {cancelling.destination}) ใช่หรือไม่? ใบจะถูกลบออกจากระบบ และใบเดิมจาก TMS จะกลับไปอยู่ในสถานะยังไม่ถูกสั่งงาน — สั่งใหม่ได้ที่หน้าตรวจเที่ยวจาก TMS</> : ''}
        confirmLabel="ยกเลิกออเดอร์"
        danger
        loading={cancelLoading}
        onConfirm={() => void confirmCancel()}
      />
    </>
  )
}
