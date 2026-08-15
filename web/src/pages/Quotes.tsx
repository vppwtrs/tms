import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { api, apiList } from '../api/client'
import type { Customer, Quote, QuoteStatus } from '../types'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, HelpTip, Input, Modal, PageHeader, Pagination, SearchInput, Select, TableSkeleton, Textarea } from '../components/ui'
import { IconCheck, IconClipboard, IconPlus, IconX } from '../components/icons'
import { QUOTE_STATUS_LABEL, QUOTE_TONE, QUOTE_STATUS_ORDER } from '../utils/constants'
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtWeightHuman } from '../utils/format'

const PAGE_SIZE = 12

interface QuoteForm {
  customer_id: string
  origin: string
  destination: string
  distance_km: string
  goods_desc: string
  weight_kg: string
  fee: string
  status: QuoteStatus
  valid_until: string
  notes: string
}

const emptyForm: QuoteForm = {
  customer_id: '',
  origin: '',
  destination: '',
  distance_km: '',
  goods_desc: '',
  weight_kg: '',
  fee: '',
  status: 'sent',
  valid_until: '',
  notes: '',
}

/** สถานะที่เปลี่ยนจากได้ (flow: ร่าง ↔ ส่งแล้ว → ตกลง/ปัดตก/หมดอายุ) */
const NEXT_STATUS: Partial<Record<QuoteStatus, QuoteStatus[]>> = {
  draft: ['sent', 'expired'],
  sent: ['accepted', 'rejected', 'expired'],
}

export default function Quotes(): React.JSX.Element {
  const { push } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()
  const canEdit = user?.role !== 'viewer'

  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (q) p.set('q', q)
    if (status) p.set('status', status)
    return p.toString()
  }, [page, q, status])

  const { data, loading, error, refetch } = useApi<{ list: Quote[]; total: number; totalPages: number }>(
    () => apiList<Quote>(`/quotes?${params}`),
    [params],
  )
  const { data: customers } = useApi<Customer[]>(() => api.get('/customers/all'), [])

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<QuoteForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const [converting, setConverting] = useState<Quote | null>(null)
  const [scheduledAt, setScheduledAt] = useState('')
  const [convertNotes, setConvertNotes] = useState('')
  const [convertLoading, setConvertLoading] = useState(false)

  const [confirmStatus, setConfirmStatus] = useState<{ quote: Quote; to: QuoteStatus } | null>(null)

  const set = (k: keyof QuoteForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const openCreate = (): void => {
    setForm(emptyForm)
    setFormOpen(true)
  }

  const save = async (): Promise<void> => {
    if (!form.origin.trim() || !form.destination.trim()) { push('warning', 'ระบุเส้นทางให้ครบ'); return }
    if (!form.goods_desc.trim()) { push('warning', 'ระบุรายละเอียดสินค้า'); return }
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
        status: form.status,
        valid_until: form.valid_until || null,
        notes: form.notes.trim() || null,
      }
      await api.post('/quotes', payload)
      push('success', 'สร้างใบเสนอราคาเรียบร้อย')
      setFormOpen(false)
      refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const doSetStatus = async (): Promise<void> => {
    if (!confirmStatus) return
    setSaving(true)
    try {
      await api.patch(`/quotes/${confirmStatus.quote.id}/status`, { status: confirmStatus.to })
      push('success', `เปลี่ยนสถานะเป็น "${QUOTE_STATUS_LABEL[confirmStatus.to]}" แล้ว`)
      setConfirmStatus(null)
      refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const openConvert = (quote: Quote): void => {
    setConverting(quote)
    const d = new Date()
    d.setDate(d.getDate() + 1)
    setScheduledAt(d.toISOString().slice(0, 10))
    setConvertNotes('')
  }

  const doConvert = async (): Promise<void> => {
    if (!converting) return
    if (!scheduledAt) { push('warning', 'ระบุกำหนดส่ง'); return }
    setConvertLoading(true)
    try {
      const res = await api.post<{ quote: Quote; order_no: string }>(`/quotes/${converting.id}/convert`, {
        scheduled_at: new Date(scheduledAt + 'T09:00:00').toISOString(),
        notes: convertNotes.trim() || null,
      })
      push('success', `แปลงเป็นออเดอร์ ${res.order_no} เรียบร้อย — ไปที่หน้าออเดอร์เพื่อจัดคิว`)
      setConverting(null)
      refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'แปลงไม่สำเร็จ')
    } finally {
      setConvertLoading(false)
    }
  }

  const quotes = data?.list ?? []

  return (
    <>
      <PageHeader
        title="ใบเสนอราคา"
        subtitle="สร้าง/ติดตามใบเสนอราคา — เมื่อลูกค้าตกลงแล้วแปลงเป็นออเดอร์ขนส่งได้ทันที"
        actions={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>สร้างใบเสนอราคา</Button>}
      />

      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="ค้นหาเลขที่ / ลูกค้า / เส้นทาง..." />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} style={{ width: 160 }}>
          <option value="">ทุกสถานะ</option>
          {QUOTE_STATUS_ORDER.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>)}
        </Select>
      </div>

      {error ? (
        <ErrorBox message={error} onRetry={refetch} />
      ) : loading || !data ? (
        <TableSkeleton rows={8} cols={6} />
      ) : quotes.length === 0 ? (
        <div className="card">
          <EmptyState icon={<IconClipboard size={40} />} title="ไม่พบใบเสนอราคา" desc="สร้างใบเสนอราคาใบแรกเพื่อเริ่มติดตามยอดขาย" action={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>สร้างใบเสนอราคา</Button>} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>ลูกค้า</th>
                {/* รวม เส้นทาง+สินค้า+น้ำหนัก เป็นคอลัมน์เดียว — 9 คอลัมน์อัดจนปุ่มล้นออกนอกจอ */}
                <th>เส้นทาง / สินค้า</th>
                <th className="num">ค่าขนส่ง</th>
                <th>หมดอายุ</th>
                <th>สถานะ<HelpTip text="ร่าง = ยังไม่ส่งให้ลูกค้า · ส่งแล้ว = รอลูกค้าตอบกลับ · ตกลงราคา = ลูกค้าตกลงแล้ว แปลงเป็นออเดอร์ได้ทันที · ปัดตก/หมดอายุ = จบ" /></th>
                <th className="actions">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => (
                <tr key={quote.id}>
                  <td><div className="cell-no text-strong">{quote.quote_no}</div></td>
                  <td>
                    {quote.customer_name ? (
                      <Link to={`/customers/${quote.customer_id}`} onClick={(e) => e.stopPropagation()}>{quote.customer_name}</Link>
                    ) : <span className="text-muted">—</span>}
                    {quote.converted_order_no && <div className="text-xs text-success">→ {quote.converted_order_no}</div>}
                  </td>
                  <td className="text-sm">
                    {quote.origin} → {quote.destination}
                    <div className="text-xs text-muted">{quote.goods_desc} · {fmtWeightHuman(quote.weight_kg)}</div>
                  </td>
                  <td className="num text-strong">{fmtMoney(quote.fee)}</td>
                  <td className="text-sm cell-date">{quote.valid_until ? fmtDate(quote.valid_until) : '—'}</td>
                  <td><Badge label={QUOTE_STATUS_LABEL[quote.status]} tone={QUOTE_TONE[quote.status]} /></td>
                  <td>
                    <div className="actions">
                      {canEdit && (quote.status === 'sent' || quote.status === 'accepted') && quote.converted_order_id == null && (
                        <Button variant="success" size="sm" title="แปลงเป็นออเดอร์" onClick={() => openConvert(quote)}>
                          <IconCheck size={13} /> เป็นออเดอร์
                        </Button>
                      )}
                      {canEdit && NEXT_STATUS[quote.status]?.map((to) => (
                        <Button
                          key={to}
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmStatus({ quote, to })}
                          title={`เปลี่ยนเป็น ${QUOTE_STATUS_LABEL[to]}`}
                        >
                          {to === 'accepted' ? <IconCheck size={13} /> : <IconX size={13} />} {QUOTE_STATUS_LABEL[to]}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > 0 && <Pagination page={page} totalPages={data.totalPages} total={data.total} onChange={setPage} />}

      {/* สร้างใบเสนอราคา */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="สร้างใบเสนอราคา"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>ยกเลิก</Button>
            <Button variant="accent" onClick={save} loading={saving}>สร้างใบเสนอราคา</Button>
          </>
        }
      >
        <div className="form-grid">
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="ลูกค้า">
              <Select value={form.customer_id} onChange={set('customer_id')}>
                <option value="">— ไม่ระบุลูกค้า —</option>
                {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="ต้นทาง" required>
            <Input value={form.origin} onChange={set('origin')} placeholder="เช่น กรุงเทพฯ" />
          </Field>
          <Field label="ปลายทาง" required>
            <Input value={form.destination} onChange={set('destination')} placeholder="เช่น เชียงใหม่" />
          </Field>
          <Field label="ระยะทาง (กม.)">
            <Input type="number" min={0} value={form.distance_km} onChange={set('distance_km')} placeholder="700" />
          </Field>
          <Field label="น้ำหนัก (กก.)">
            <Input type="number" min={0} value={form.weight_kg} onChange={set('weight_kg')} placeholder="3000" />
          </Field>
          <Field label="ค่าขนส่ง (บาท)" required>
            <Input type="number" min={0} value={form.fee} onChange={set('fee')} placeholder="5500" />
          </Field>
          <Field label="สถานะเริ่มต้น">
            <Select value={form.status} onChange={set('status')}>
              <option value="draft">ร่าง</option>
              <option value="sent">ส่งแล้ว</option>
            </Select>
          </Field>
          <Field label="หมดอายุ">
            <Input type="date" value={form.valid_until} onChange={set('valid_until')} />
          </Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="รายละเอียดสินค้า" required>
              <Input value={form.goods_desc} onChange={set('goods_desc')} placeholder="เช่น เครื่องใช้ไฟฟ้า" />
            </Field>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="หมายเหตุ">
              <Textarea value={form.notes} onChange={set('notes')} placeholder="เงื่อนไขราคา ข้อเสนอพิเศษ ฯลฯ" />
            </Field>
          </div>
        </div>
      </Modal>

      {/* ยืนยันเปลี่ยนสถานะ */}
      <ConfirmDialog
        open={confirmStatus !== null}
        onClose={() => setConfirmStatus(null)}
        title={`เปลี่ยนสถานะเป็น "${confirmStatus ? QUOTE_STATUS_LABEL[confirmStatus.to] : ''}"`}
        message={confirmStatus ? <>เปลี่ยนสถานะของ <b>{confirmStatus.quote.quote_no}</b> เป็น <b>{QUOTE_STATUS_LABEL[confirmStatus.to]}</b> ใช่หรือไม่?</> : ''}
        confirmLabel="ยืนยัน"
        loading={saving}
        onConfirm={doSetStatus}
      />

      {/* แปลงเป็นออเดอร์ */}
      <Modal
        open={converting !== null}
        onClose={() => setConverting(null)}
        title={converting ? `แปลง ${converting.quote_no} เป็นออเดอร์` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConverting(null)}>ยกเลิก</Button>
            <Button variant="success" onClick={doConvert} loading={convertLoading} icon={<IconCheck size={15} />}>
              แปลงเป็นออเดอร์
            </Button>
          </>
        }
      >
        {converting && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 12, border: '1px solid var(--line)', fontSize: 14 }}>
              <b>{converting.quote_no}</b> · {converting.origin} → {converting.destination} · {converting.goods_desc} · {fmtNum(converting.weight_kg)} กก. · <b>{fmtMoney(converting.fee)}</b>
            </div>
            <Field label="กำหนดส่ง" required hint="ระบบจะสร้างออเดอร์สถานะรอจัดคิว และล็อกใบเสนอราคาเป็นตกลงราคา">
              <Input type="date" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </Field>
            <Field label="หมายเหตุออเดอร์">
              <Textarea value={convertNotes} onChange={(e) => setConvertNotes(e.target.value)} placeholder={`เช่น เงื่อนไขจากใบเสนอราคา ${converting.quote_no}`} />
            </Field>
            <div className="text-xs text-muted">สร้างแล้วไปที่ <Link to="/orders">หน้าออเดอร์</Link> เพื่อจัดคิวทันที ({fmtDateTime(new Date().toISOString())})</div>
          </div>
        )}
      </Modal>
    </>
  )
}
