import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { api, apiList } from '../api/client'
import type { Customer, CustomerSegment } from '../types'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, TableSkeleton, Textarea } from '../components/ui'
import { IconBuilding, IconEdit, IconPlus, IconTrash } from '../components/icons'
import { SEGMENT_LABEL, SEGMENT_TONE } from '../utils/constants'

const PAGE_SIZE = 10

interface CustomerForm {
  name: string
  contact_person: string
  phone: string
  email: string
  address: string
  segment: CustomerSegment | ''
  tax_id: string
  credit_terms: string
  tags: string
  price_note: string
}

const emptyForm: CustomerForm = { name: '', contact_person: '', phone: '', email: '', address: '', segment: 'B', tax_id: '', credit_terms: '', tags: '', price_note: '' }

const SEGMENTS: CustomerSegment[] = ['VIP', 'A', 'B', 'C']

export default function Customers(): React.JSX.Element {
  const { push } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()
  const canEdit = user?.role !== 'viewer'
  const isAdmin = user?.role === 'admin'

  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [segment, setSegment] = useState('')
  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (q) p.set('q', q)
    if (segment) p.set('segment', segment)
    return p.toString()
  }, [page, q, segment])

  const { data, loading, error, refetch } = useApi<{ list: Customer[]; total: number; totalPages: number }>(
    () => apiList<Customer>(`/customers?${params}`),
    [params],
  )

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState<CustomerForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<Customer | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const set = (k: keyof CustomerForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const openCreate = (): void => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (c: Customer): void => {
    setEditing(c)
    setForm({
      name: c.name,
      contact_person: c.contact_person ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
      segment: c.segment ?? 'B',
      tax_id: c.tax_id ?? '',
      credit_terms: c.credit_terms != null ? String(c.credit_terms) : '',
      tags: c.tags ?? '',
      price_note: c.price_note ?? '',
    })
    setFormOpen(true)
  }

  const save = async (): Promise<void> => {
    if (!form.name.trim()) { push('warning', 'ระบุชื่อลูกค้า'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        contact_person: form.contact_person.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        segment: form.segment || 'B',
        tax_id: form.tax_id.trim() || null,
        credit_terms: form.credit_terms ? Number(form.credit_terms) : null,
        tags: form.tags.trim() || null,
        price_note: form.price_note.trim() || null,
      }
      if (editing) {
        await api.put(`/customers/${editing.id}`, payload)
        push('success', `แก้ไข ${editing.name} เรียบร้อย`)
      } else {
        await api.post('/customers', payload)
        push('success', 'เพิ่มลูกค้าเรียบร้อย')
      }
      setFormOpen(false)
      refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await api.delete(`/customers/${deleting.id}`)
      push('success', `ลบ ${deleting.name} แล้ว`)
      setDeleting(null)
      refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <>
      <PageHeader
        title="ลูกค้า"
        subtitle="ฐานข้อมูลลูกค้า + CRM — กดชื่อลูกค้าเพื่อดูโปรไฟล์เต็ม (ออเดอร์, ใบเสนอราคา, การติดต่อ, งานติดตาม)"
        actions={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>เพิ่มลูกค้า</Button>}
      />

      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="ค้นหาชื่อ / ผู้ติดต่อ / เบอร์ / แท็ก..." />
        <Select value={segment} onChange={(e) => { setSegment(e.target.value); setPage(1) }} style={{ width: 160 }}>
          <option value="">ทุกกลุ่ม</option>
          {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
        </Select>
      </div>

      {error ? (
        <ErrorBox message={error} onRetry={refetch} />
      ) : loading || !data ? (
        <TableSkeleton rows={8} cols={6} />
      ) : data.list.length === 0 ? (
        <div className="card">
          <EmptyState icon={<IconBuilding size={40} />} title="ไม่พบลูกค้า" desc="เพิ่มลูกค้ารายแรก" action={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>เพิ่มลูกค้า</Button>} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ชื่อลูกค้า</th>
                <th>กลุ่ม</th>
                <th>ผู้ติดต่อ</th>
                <th>เบอร์โทร</th>
                <th>เครดิต</th>
                <th>แท็ก</th>
                <th className="actions">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {data.list.map((c) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/customers/${c.id}`)}>
                  <td className="text-strong">
                    <Link to={`/customers/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                    {c.contact_person && <div className="text-xs text-muted">{c.contact_person}</div>}
                  </td>
                  <td>
                    {c.segment ? <Badge label={SEGMENT_LABEL[c.segment as CustomerSegment] ?? c.segment} tone={SEGMENT_TONE[c.segment as CustomerSegment] ?? 'pending'} /> : '—'}
                  </td>
                  <td className="text-sm">{c.phone ?? <span className="text-muted">—</span>}</td>
                  <td className="text-sm">{c.credit_terms ? `${c.credit_terms} วัน` : <span className="text-muted">—</span>}</td>
                  <td>
                    {c.tags ? <span className="text-xs text-muted">{c.tags.split(',').slice(0, 2).join(' · ')}</span> : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <div className="actions">
                      {canEdit && (
                        <Button variant="ghost" size="sm" title="แก้ไข" onClick={(e) => { e.stopPropagation(); openEdit(c) }}><IconEdit size={14} /></Button>
                      )}
                      {isAdmin && (
                        <Button variant="ghost" size="sm" title="ลบ" className="text-danger" onClick={(e) => { e.stopPropagation(); setDeleting(c) }}><IconTrash size={14} /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > 0 && <Pagination page={page} totalPages={data.totalPages} total={data.total} onChange={setPage} />}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `แก้ไข ${editing.name}` : 'เพิ่มลูกค้า'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>ยกเลิก</Button>
            <Button variant="accent" onClick={save} loading={saving}>{editing ? 'บันทึก' : 'เพิ่มลูกค้า'}</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="ชื่อลูกค้า / บริษัท" required>
            <Input value={form.name} onChange={set('name')} placeholder="เช่น บริษัท ไทยฟู้ดส์ จำกัด" />
          </Field>
          <Field label="กลุ่มลูกค้า">
            <Select value={form.segment} onChange={set('segment')}>
              {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="ผู้ติดต่อ">
            <Input value={form.contact_person} onChange={set('contact_person')} placeholder="เช่น คุณวิภา" />
          </Field>
          <Field label="เบอร์โทร">
            <Input value={form.phone} onChange={set('phone')} placeholder="081-234-5678" />
          </Field>
          <Field label="อีเมล">
            <Input type="email" value={form.email} onChange={set('email')} placeholder="contact@example.com" />
          </Field>
          <Field label="เลขประจำตัวผู้เสียภาษี">
            <Input value={form.tax_id} onChange={set('tax_id')} placeholder="13XXXXXXXXXXX" />
          </Field>
          <Field label="เงื่อนไขเครดิต (วัน)" hint="เช่น 30 = ชำระภายใน 30 วัน">
            <Input type="number" min={0} max={365} value={form.credit_terms} onChange={set('credit_terms')} placeholder="30" />
          </Field>
          <Field label="แท็ก" hint="คั่นด้วยเครื่องหมายจุลภาค เช่น ลูกค้าหลัก, ขนส่งประจำ">
            <Input value={form.tags} onChange={set('tags')} placeholder="ลูกค้าหลัก, ขนส่งประจำ" />
          </Field>
          <Field label="ที่อยู่">
            <Textarea value={form.address} onChange={set('address')} placeholder="เลขที่ ถนน จังหวัด" />
          </Field>
          <Field label="เงื่อนไขราคา / หมายเหตุ">
            <Textarea value={form.price_note} onChange={set('price_note')} placeholder="เช่น ราคาพิเศษ -5% เส้นทางประจำ" />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="ลบลูกค้า"
        message={deleting ? <>ต้องการลบ <b>{deleting.name}</b> ใช่หรือไม่? ถ้าลูกค้ามีออเดอร์ในระบบ ระบบจะบล็อกการลบ</> : ''}
        confirmLabel="ลบ"
        danger
        loading={deleteLoading}
        onConfirm={confirmDelete}
      />
    </>
  )
}
