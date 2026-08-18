import { useCallback, useEffect, useState } from 'react'
import { listOrders, createOrder, updateOrder, cancelOrder, type OrderListRow } from '../api/orders'
import { useRealtime } from '../hooks/useRealtime'
import { listAllCustomers } from '../api/customers'
import { listDrivers } from '../api/vehicles'
import type { Paged } from '../api/customers'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { CustomerRow, DriverRow, OrderPriority, OrderStatus } from '../types/database'
import {
  ORDER_STATUS_LABEL, ORDER_STATUS_ORDER, ORDER_TONE,
} from '../utils/constants'
import { dateInputToIso, fmtDate, fmtMoney, fmtRoute, fmtWeightHuman, isoToDateInput } from '../utils/format'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, HelpTip, Input, Modal,
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

const PAGE_SIZE = 15

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

export default function CloudOrders(): React.JSX.Element {
  const { can } = useCloudAuth()
  const { push } = useToast()
  const canEdit = can('orders.write')
  const canCancel = can('orders.cancel')

  const [data, setData] = useState<Paged<OrderListRow> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [page, setPage] = useState(1)
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
        push('success', `แก้ไขออเดอร์ ${editing.order_no} เรียบร้อย`)
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
      await cancelOrder(cancelling.id)
      push('success', `ยกเลิกออเดอร์ ${cancelling.order_no} แล้ว`)
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
        <TableSkeleton rows={10} cols={8} />
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
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>เลขเที่ยว / เลขออเดอร์</th>
                <th>ลูกค้า</th>
                <th>เส้นทาง</th>
                <th className="num">ค่าขนส่ง</th>
                <th>กำหนดส่ง</th>
                <th>คนขับ<HelpTip text="มาจากเที่ยววิ่งที่ออเดอร์ใบนี้ถูกจัดเข้าไป — ออเดอร์ที่ยังไม่ได้จัดคิวจะยังไม่มีคนขับ" /></th>
                <th>สถานะ</th>
                <th>POD<HelpTip text="หลักฐานการส่งมอบ — ลายเซ็นผู้รับ + รูปถ่าย ณ จุดส่ง ฉบับคลาวด์ยังดูได้แค่ว่ามีหรือไม่มี" /></th>
                <th className="actions">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="cell-no">
                      <span className="text-strong">{o.tms_trip_no ?? o.trip_no ?? 'ยังไม่จัดเที่ยว'}</span>
                      {o.priority === 'urgent' && <Badge label="ด่วน" tone="urgent" dot />}
                    </div>
                    <div className="text-xs text-muted">ออเดอร์ {o.order_no}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                      <Badge
                        label={orderKind(o.work_kind, o.goods_desc) === 'box' ? 'กล่อง' : 'รถ'}
                        tone={orderKind(o.work_kind, o.goods_desc) === 'box' ? 'accent' : 'neutral'}
                      />
                      <span className="text-xs text-muted">{o.goods_desc}</span>
                    </div>
                  </td>
                  <td>{o.customer_name ?? <span className="text-muted">—</span>}</td>
                  <td>
                    {o.origin} <span className="text-muted">→</span> {o.destination}
                    <div className="text-xs text-muted">{fmtWeightHuman(o.weight_kg)} · {fmtRoute(o.distance_km)}</div>
                  </td>
                  <td className="num text-strong">{fmtMoney(o.fee)}</td>
                  <td className="cell-date">
                    {fmtDate(o.scheduled_at)}
                    {o.delivered_at && <div className="text-xs text-success">ส่ง {fmtDate(o.delivered_at)}</div>}
                  </td>
                  <td>
                    {o.driver_name ? (
                      o.driver_name
                    ) : (
                      <span className="text-muted text-xs">ยังไม่จัดคิว</span>
                    )}
                  </td>
                  <td>
                    <Badge label={ORDER_STATUS_LABEL[o.status]} tone={ORDER_TONE[o.status]} dot={o.status === 'in_transit'} />
                  </td>
                  <td>
                    {o.status === 'delivered' ? (
                      o.pod_status ? (
                        <Badge
                          label={o.pod_status === 'verified' ? 'ยืนยันแล้ว' : 'มี POD'}
                          tone={o.pod_status === 'verified' ? 'delivered' : 'in_transit'}
                          dot={o.pod_status === 'collected'}
                        />
                      ) : (
                        <Badge label="ไม่มี POD" tone="pending" />
                      )
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
                  <td>
                    <div className="actions">
                      {canEdit && (o.status === 'pending' || o.status === 'assigned') && (
                        <Button variant="ghost" size="sm" title="แก้ไข" onClick={() => openEdit(o)}><IconEdit size={14} /></Button>
                      )}
                      {canCancel && (o.status === 'pending' || o.status === 'assigned') && (
                        <Button variant="ghost" size="sm" title="ยกเลิก" className="text-danger" onClick={() => setCancelling(o)}><IconTrash size={14} /></Button>
                      )}
                      {o.status === 'delivered' && <span className="text-xs text-muted">เสร็จสิ้น</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > 0 && (
        <Pagination page={page} totalPages={totalPages} total={data.total} onChange={setPage} />
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `แก้ไขออเดอร์ ${editing.order_no}` : 'สร้างออเดอร์ใหม่'}
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
          <Field label="น้ำหนัก (กก.)">
            <Input type="number" min={0} value={form.weight_kg} onChange={set('weight_kg')} placeholder="1000" />
          </Field>
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

      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="ยืนยันการยกเลิกออเดอร์"
        message={cancelling ? <>ต้องการยกเลิกออเดอร์ <b>{cancelling.order_no}</b> ({cancelling.origin} → {cancelling.destination}) ใช่หรือไม่? ออเดอร์จะเปลี่ยนเป็นสถานะ <b>ยกเลิก</b> ทันที และไม่สามารถย้อนกลับได้</> : ''}
        confirmLabel="ยกเลิกออเดอร์"
        danger
        loading={cancelLoading}
        onConfirm={() => void confirmCancel()}
      />
    </>
  )
}
