import { useMemo, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { api, apiList } from '../api/client'
import type { BolDocument, Customer, Driver, Order, OrderStatus, Priority } from '../types'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, HelpTip, Input, Modal, PageHeader, Pagination, SearchInput, Select, TableSkeleton, Textarea } from '../components/ui'
import { PodModal } from '../components/PodModal'
import { BolModal } from '../components/BolModal'
import { ORDER_STATUS_LABEL, ORDER_STATUS_ORDER, ORDER_TONE, PRIORITY_LABEL, PRIORITY_TONE } from '../utils/constants'
import { dateInputToIso, fmtDate, fmtMoney, fmtNum, fmtRoute, fmtWeightHuman, isoToDateInput } from '../utils/format'
import { IconBox, IconEdit, IconPlus, IconPrinter, IconTrash } from '../components/icons'

const PAGE_SIZE = 15

interface OrderForm {
  customer_id: string
  origin: string
  destination: string
  distance_km: string
  goods_desc: string
  weight_kg: string
  fee: string
  priority: Priority
  scheduled_at: string
  notes: string
}

const emptyForm: OrderForm = {
  customer_id: '',
  origin: '',
  destination: '',
  distance_km: '',
  goods_desc: '',
  weight_kg: '',
  fee: '',
  priority: 'normal',
  scheduled_at: '',
  notes: '',
}

export default function Orders(): React.JSX.Element {
  const { push } = useToast()
  const { user } = useAuth()
  const canEdit = user?.role !== 'viewer'

  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [driverId, setDriverId] = useState('')

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (q) params.set('q', q)
    if (status) params.set('status', status)
    if (priority) params.set('priority', priority)
    if (from) params.set('from', `${from}T00:00:00`)
    if (to) params.set('to', `${to}T23:59:59`)
    if (driverId) params.set('driver_id', driverId)
    return params.toString()
  }, [page, q, status, priority, from, to, driverId])

  const { data, loading, error, refetch } = useApi<{ list: Order[]; total: number; totalPages: number }>(
    () => apiList<Order>(`/orders?${query}`),
    [query],
  )

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Order | null>(null)
  const [form, setForm] = useState<OrderForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState<Order | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [podOrder, setPodOrder] = useState<Order | null>(null)
  const [bol, setBol] = useState<BolDocument | null>(null)
  const [bolLoadingId, setBolLoadingId] = useState<number | null>(null)

  const openBol = async (order: Order): Promise<void> => {
    setBolLoadingId(order.id)
    try {
      const doc = await api.get<BolDocument>(`/orders/${order.id}/bol`)
      setBol(doc)
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'โหลดใบนำส่งไม่สำเร็จ')
    } finally {
      setBolLoadingId(null)
    }
  }

  const customersApi = useApi<Customer[]>(() => api.get('/customers/all'), [])
  const customers = customersApi.data ?? []

  /* รายชื่อคนขับสำหรับตัวกรอง — ต้องเอาทุกคน ไม่ใช่เฉพาะคนว่าง (`/drivers/available`)
     เพราะคนที่กำลังวิ่งอยู่คือคนที่ฝ่ายวางแผนอยากกรองดูมากที่สุด */
  const driversApi = useApi<{ list: Driver[] }>(() => apiList<Driver>('/drivers?limit=200'), [])
  const drivers = driversApi.data?.list ?? []

  const set = (key: keyof OrderForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const openCreate = (): void => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (order: Order): void => {
    setEditing(order)
    setForm({
      customer_id: order.customer_id ? String(order.customer_id) : '',
      origin: order.origin,
      destination: order.destination,
      distance_km: String(order.distance_km),
      goods_desc: order.goods_desc,
      weight_kg: String(order.weight_kg),
      fee: String(order.fee),
      priority: order.priority,
      scheduled_at: isoToDateInput(order.scheduled_at),
      notes: order.notes ?? '',
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
        await api.put(`/orders/${editing.id}`, payload)
        push('success', `แก้ไขออเดอร์ ${editing.order_no} เรียบร้อย`)
      } else {
        await api.post('/orders', payload)
        push('success', 'สร้างออเดอร์เรียบร้อย')
      }
      setFormOpen(false)
      refetch()
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
      await api.post(`/orders/${cancelling.id}/cancel`)
      push('success', `ยกเลิกออเดอร์ ${cancelling.order_no} แล้ว`)
      setCancelling(null)
      refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'ยกเลิกไม่สำเร็จ')
    } finally {
      setCancelLoading(false)
    }
  }

  const resetFilters = (): void => {
    setQ(''); setStatus(''); setPriority(''); setFrom(''); setTo(''); setDriverId(''); setPage(1)
  }

  return (
    <>
      <PageHeader
        title="จัดการออเดอร์"
        subtitle="ออเดอร์ขนส่งทั้งหมด — ค้นหา กรอง ดูสถานะ และจัดการ"
        actions={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>สร้างออเดอร์</Button>}
      />

      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="ค้นหาเลขที่ / ลูกค้า / เส้นทาง / สินค้า..." />
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
        <ErrorBox message={error} onRetry={refetch} />
      ) : loading || !data ? (
        <TableSkeleton rows={10} cols={8} />
      ) : data.list.length === 0 ? (
        <div className="card">
          <EmptyState icon={<IconBox size={40} />} title="ไม่พบออเดอร์" desc={q || status || priority ? 'ลองเปลี่ยนเงื่อนไขการค้นหา' : 'สร้างออเดอร์ → จัดคิวรถ-คนขับในแผนงาน → ส่งของพร้อมเก็บ POD — ระบบดูแลสถานะต่อให้อัตโนมัติ'} action={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>สร้างออเดอร์</Button>} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>ลูกค้า</th>
                {/* น้ำหนักย้ายมาอยู่บรรทัดรองของเส้นทาง — ลด 1 คอลัมน์ให้ตารางหายใจออก */}
                <th>เส้นทาง</th>
                <th className="num">ค่าขนส่ง</th>
                <th>กำหนดส่ง</th>
                <th>คนขับ<HelpTip text="มาจากเที่ยววิ่งที่ออเดอร์ใบนี้ถูกจัดเข้าไป — ออเดอร์ที่ยังไม่ได้จัดคิวจะยังไม่มีคนขับ" /></th>
                <th>สถานะ</th>
                <th>POD<HelpTip text="หลักฐานการส่งมอบ — ลายเซ็นผู้รับ + รูปถ่ายสินค้า ณ จุดส่ง ใช้ยืนยันว่าส่งของครบถ้วน" /></th>
                <th className="actions">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {data.list.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="cell-no">
                      <span className="text-strong">{o.order_no}</span>
                      {o.priority === 'urgent' && <Badge label="ด่วน" tone="urgent" dot />}
                    </div>
                    <div className="text-xs text-muted">{o.goods_desc}</div>
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
                      <>
                        {o.driver_name}
                        <div className="text-xs text-muted">{o.trip_no}</div>
                      </>
                    ) : (
                      <span className="text-muted text-xs">ยังไม่จัดคิว</span>
                    )}
                  </td>
                  <td>
                    <Badge label={ORDER_STATUS_LABEL[o.status]} tone={ORDER_TONE[o.status]} dot={o.status === 'in_transit'} />
                  </td>
                  <td>
                    {o.status === 'delivered' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {o.pod_status ? (
                          <Badge label={o.pod_status === 'verified' ? 'ยืนยันแล้ว' : 'มี POD'} tone={o.pod_status === 'verified' ? 'delivered' : 'in_transit'} dot={o.pod_status === 'collected'} />
                        ) : (
                          <Badge label="ไม่มี POD" tone="pending" />
                        )}
                        <Button variant={o.pod_status ? 'outline' : 'accent'} size="sm" onClick={() => setPodOrder(o)}>
                          POD
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
                  <td>
                    <div className="actions">
                      <Button variant="ghost" size="sm" title="พิมพ์ใบนำส่ง" aria-label={`พิมพ์ใบนำส่ง ${o.order_no}`} loading={bolLoadingId === o.id} onClick={() => openBol(o)}><IconPrinter size={14} /></Button>
                      {canEdit && (o.status === 'pending' || o.status === 'assigned') && (
                        <>
                          <Button variant="ghost" size="sm" title="แก้ไข" onClick={() => openEdit(o)}><IconEdit size={14} /></Button>
                          <Button variant="ghost" size="sm" title="ยกเลิก" className="text-danger" onClick={() => setCancelling(o)}><IconTrash size={14} /></Button>
                        </>
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
        <Pagination page={page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
      )}

      {/* Modal สร้าง/แก้ไข */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `แก้ไขออเดอร์ ${editing.order_no}` : 'สร้างออเดอร์ใหม่'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>ยกเลิก</Button>
            <Button variant="accent" onClick={save} loading={saving}>{editing ? 'บันทึกการแก้ไข' : 'สร้างออเดอร์'}</Button>
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

      {podOrder && <PodModal open order={podOrder} onClose={() => setPodOrder(null)} onChanged={refetch} />}

      {bol && <BolModal doc={bol} onClose={() => setBol(null)} />}

      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="ยืนยันการยกเลิกออเดอร์"
        message={cancelling ? <>ต้องการยกเลิกออเดอร์ <b>{cancelling.order_no}</b> ({cancelling.origin} → {cancelling.destination}) ใช่หรือไม่? ออเดอร์จะเปลี่ยนเป็นสถานะ <b>ยกเลิก</b> ทันที และไม่สามารถย้อนกลับได้</> : ''}
        confirmLabel="ยกเลิกออเดอร์"
        danger
        loading={cancelLoading}
        onConfirm={confirmCancel}
      />
    </>
  )
}
