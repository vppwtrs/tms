import { useEffect, useState } from 'react'
import { listCustomers, createCustomer, updateCustomer, removeCustomer, type Paged } from '../api/customers'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { CustomerRow } from '../types/database'
import type { CustomerSegment } from '../types'
import { SEGMENT_LABEL, SEGMENT_TONE } from '../utils/constants'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal,
  PageHeader, Pagination, SearchInput, Select, TableSkeleton, Textarea,
} from '../components/ui'
import { IconBuilding, IconEdit, IconPlus, IconTrash } from '../components/icons'

/**
 * ลูกค้า ฉบับคลาวด์ — คู่ขนานกับ Customers.tsx ที่ยังคุยกับ Express บน LAN
 *
 * หน้าตาและลำดับข้อมูลตั้งใจให้เหมือนของเดิมทุกอย่าง คนที่ใช้อยู่แล้วจะได้ไม่ต้องเรียนใหม่
 * ต่างกันแค่สามจุด:
 *   1. ข้อมูลมาจาก api/customers.ts (PostgREST) ไม่ใช่ fetch('/api/customers')
 *   2. สิทธิ์อ่านจาก useCloudAuth().can() ซึ่งมาจาก role_permissions ไม่ใช่เทียบ role ตรง ๆ
 *   3. ยังไม่ลิงก์ไปหน้าโปรไฟล์ลูกค้า เพราะ CustomerDetail ยังไม่ถูกแปลง —
 *      ลิงก์ที่พาไปหน้าซึ่งไม่มี route คือพาผู้ใช้ไปเจอ 404 โดยไม่มีทางกลับ
 *
 * can() ใช้ซ่อน/แสดงปุ่มเท่านั้น ตัวกันจริงคือ RLS — กดยิงตรงเกินสิทธิ์จะได้ 42501
 * ซึ่ง toDataError() แปลเป็นข้อความไทยให้แล้ว
 */

const PAGE_SIZE = 10
const SEGMENTS: CustomerSegment[] = ['VIP', 'A', 'B', 'C']

interface CustomerForm {
  name: string
  contact_person: string
  phone: string
  email: string
  address: string
  segment: string
  tax_id: string
  credit_terms: string
  tags: string
  price_note: string
}

const emptyForm: CustomerForm = {
  name: '', contact_person: '', phone: '', email: '', address: '',
  segment: 'B', tax_id: '', credit_terms: '', tags: '', price_note: '',
}

export default function CloudCustomers(): React.JSX.Element {
  const { can } = useCloudAuth()
  const { push } = useToast()
  const canEdit = can('customers.write')
  const canDelete = can('customers.delete')

  const [data, setData] = useState<Paged<CustomerRow> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [segment, setSegment] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CustomerRow | null>(null)
  const [form, setForm] = useState<CustomerForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<CustomerRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const load = (): void => {
    setLoading(true)
    listCustomers({ q: q || undefined, segment: segment || undefined, page, limit: PAGE_SIZE })
      .then((d) => { setData(d); setError('') })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  /* หน่วงการค้น 300ms — ทุกตัวอักษรที่พิมพ์คือหนึ่ง request ไป PostgREST
     ของเดิมบน Express อยู่ใน LAN เลยไม่รู้สึก แต่ตอนนี้วิ่งข้ามอินเทอร์เน็ตไปโซล */
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [page, q, segment])

  const set = (k: keyof CustomerForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  const openCreate = (): void => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (c: CustomerRow): void => {
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
      /* ช่องว่างเก็บเป็น null ไม่ใช่ '' — คอลัมน์พวกนี้ nullable และหน้าอื่นเช็ค null
         ถ้าเก็บ '' ค่าที่ "ไม่ได้กรอก" กับ "กรอกเป็นค่าว่าง" จะแยกกันไม่ออก */
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
        await updateCustomer(editing.id, payload)
        push('success', `แก้ไข ${editing.name} เรียบร้อย`)
      } else {
        await createCustomer(payload)
        push('success', 'เพิ่มลูกค้าเรียบร้อย')
      }
      setFormOpen(false)
      load()
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
      await removeCustomer(deleting.id)
      push('success', `ลบ ${deleting.name} แล้ว`)
      setDeleting(null)
      load()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'ลบไม่สำเร็จ')
    } finally {
      setDeleteLoading(false)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

  return (
    <>
      <PageHeader
        title="ลูกค้า"
        subtitle="ฐานข้อมูลลูกค้า"
        actions={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>เพิ่มลูกค้า</Button>}
      />

      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="ค้นหาชื่อ / ผู้ติดต่อ / เบอร์..." />
        <Select value={segment} onChange={(e) => { setSegment(e.target.value); setPage(1) }} style={{ width: 160 }}>
          <option value="">ทุกกลุ่ม</option>
          {SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>)}
        </Select>
      </div>

      {error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : loading || !data ? (
        <TableSkeleton rows={8} cols={6} />
      ) : data.rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconBuilding size={40} />}
            title="ไม่พบลูกค้า"
            desc={q || segment ? 'ลองเปลี่ยนคำค้นหรือกลุ่มลูกค้า' : 'เพิ่มลูกค้ารายแรก'}
            action={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>เพิ่มลูกค้า</Button>}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table ops-table">
            <thead>
              <tr>
                <th>ชื่อลูกค้า</th>
                <th>กลุ่ม</th>
                <th>เบอร์โทร</th>
                <th>เครดิต</th>
                <th>แท็ก</th>
                <th className="actions">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((c) => (
                <tr key={c.id}>
                  <td className="text-strong">
                    {c.name}
                    {c.contact_person && <div className="text-xs text-muted">{c.contact_person}</div>}
                  </td>
                  <td>
                    {c.segment
                      ? <Badge label={SEGMENT_LABEL[c.segment as CustomerSegment] ?? c.segment} tone={SEGMENT_TONE[c.segment as CustomerSegment] ?? 'pending'} />
                      : '—'}
                  </td>
                  <td className="text-sm">{c.phone ?? <span className="text-muted">—</span>}</td>
                  <td className="text-sm">{c.credit_terms ? `${c.credit_terms} วัน` : <span className="text-muted">—</span>}</td>
                  <td>
                    {c.tags
                      ? <span className="text-xs text-muted">{c.tags.split(',').slice(0, 2).join(' · ')}</span>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <div className="actions">
                      {canEdit && (
                        <Button variant="ghost" size="sm" title="แก้ไข" onClick={() => openEdit(c)}><IconEdit size={14} /></Button>
                      )}
                      {canDelete && (
                        <Button variant="ghost" size="sm" title="ลบ" className="text-danger" onClick={() => setDeleting(c)}><IconTrash size={14} /></Button>
                      )}
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
          <Field label="แท็ก" hint="คั่นด้วยเครื่องหมายจุลภาค">
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
