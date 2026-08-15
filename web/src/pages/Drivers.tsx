import { useEffect, useMemo, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { api, apiList } from '../api/client'
import type { Driver, DriverStatus, ManagedUser } from '../types'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Pagination, SearchInput, Select, TableSkeleton } from '../components/ui'
import { DRIVER_STATUS_LABEL, DRIVER_TONE } from '../utils/constants'
import { fmtDate } from '../utils/format'
import { IconEdit, IconPlus, IconTrash, IconUsers } from '../components/icons'

const PAGE_SIZE = 10

interface DriverForm {
  name: string
  phone: string
  license_no: string
  license_type: string
  joined_at: string
  user_id: string
}

const emptyForm: DriverForm = { name: '', phone: '', license_no: '', license_type: '', joined_at: '', user_id: '' }

export default function Drivers(): React.JSX.Element {
  const { push } = useToast()
  const { user, can } = useAuth()
  const canEdit = user?.role !== 'viewer'
  const isAdmin = user?.role === 'admin'

  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (q) p.set('q', q)
    if (status) p.set('status', status)
    return p.toString()
  }, [page, q, status])

  const { data, loading, error, refetch } = useApi<{ list: Driver[]; total: number; totalPages: number }>(
    () => apiList<Driver>(`/drivers?${params}`),
    [params],
  )

  /* บัญชีบทบาท "พนักงานขับรถ" สำหรับช่องผูกบัญชี — โหลดเฉพาะคนที่มีสิทธิ์จัดการผู้ใช้
     คนอื่นเรียกจะได้ 403 เปล่า ๆ */
  const [driverAccounts, setDriverAccounts] = useState<ManagedUser[]>([])
  useEffect(() => {
    if (!can('users.manage')) return
    api
      .get<ManagedUser[]>('/auth/users')
      .then((list) => setDriverAccounts(list.filter((u) => u.role === 'driver' && u.is_active)))
      .catch(() => {})
  }, [can])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Driver | null>(null)
  const [form, setForm] = useState<DriverForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<Driver | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const set = (k: keyof DriverForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const openCreate = (): void => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (d: Driver): void => {
    setEditing(d)
    setForm({ name: d.name, phone: d.phone ?? '', license_no: d.license_no ?? '', license_type: d.license_type ?? '', joined_at: d.joined_at ?? '', user_id: d.user_id ? String(d.user_id) : '' })
    setFormOpen(true)
  }

  const save = async (): Promise<void> => {
    if (!form.name.trim()) { push('warning', 'ระบุชื่อพนักงานขับ'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        license_no: form.license_no.trim() || null,
        license_type: form.license_type.trim() || null,
        joined_at: form.joined_at || null,
        user_id: form.user_id ? Number(form.user_id) : null,
      }
      if (editing) {
        await api.put(`/drivers/${editing.id}`, payload)
        push('success', `แก้ไข ${editing.name} เรียบร้อย`)
      } else {
        await api.post('/drivers', payload)
        push('success', 'เพิ่มพนักงานขับเรียบร้อย')
      }
      setFormOpen(false)
      refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (d: Driver, next: DriverStatus): Promise<void> => {
    try {
      await api.patch(`/drivers/${d.id}/status`, { status: next })
      push('success', `${d.name}: ${DRIVER_STATUS_LABEL[next]}`)
      refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ')
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await api.delete(`/drivers/${deleting.id}`)
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
        title="พนักงานขับ"
        subtitle="ทะเบียนพนักงานขับ — เบอร์ติดต่อ ใบขับขี่ และสถานะ"
        actions={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>เพิ่มพนักงานขับ</Button>}
      />

      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="ค้นหาชื่อ / เบอร์ / เลขใบขับขี่..." />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} style={{ width: 150 }}>
          <option value="">สถานะทั้งหมด</option>
          {(['available', 'on_trip', 'off_duty'] as DriverStatus[]).map((s) => (
            <option key={s} value={s}>{DRIVER_STATUS_LABEL[s]}</option>
          ))}
        </Select>
      </div>

      {error ? (
        <ErrorBox message={error} onRetry={refetch} />
      ) : loading || !data ? (
        <TableSkeleton rows={8} cols={6} />
      ) : data.list.length === 0 ? (
        <div className="card">
          <EmptyState icon={<IconUsers size={40} />} title="ไม่พบพนักงานขับ" desc="เพิ่มพนักงานขับคนแรก" action={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>เพิ่มพนักงานขับ</Button>} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th>เบอร์โทร</th>
                <th>ใบขับขี่</th>
                <th>เข้างาน</th>
                <th>สถานะ</th>
                <th className="actions">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {data.list.map((d) => (
                <tr key={d.id}>
                  <td className="text-strong">{d.name}</td>
                  <td>{d.phone ?? <span className="text-muted">—</span>}</td>
                  <td>
                    {d.license_no ?? <span className="text-muted">—</span>}
                    {d.license_type && <div className="text-xs text-muted">{d.license_type}</div>}
                  </td>
                  <td className="text-sm">{fmtDate(d.joined_at)}</td>
                  <td>
                    {canEdit ? (
                      <Select
                        value={d.status}
                        onChange={(e) => changeStatus(d, e.target.value as DriverStatus)}
                        style={{ width: 120, padding: '4px 8px', fontSize: 13 }}
                        disabled={d.status === 'on_trip'}
                      >
                        {(['available', 'off_duty'] as DriverStatus[]).map((s) => (
                          <option key={s} value={s}>{DRIVER_STATUS_LABEL[s]}</option>
                        ))}
                        {d.status === 'on_trip' && <option value="on_trip">กำลังขนส่ง</option>}
                      </Select>
                    ) : (
                      <Badge label={DRIVER_STATUS_LABEL[d.status]} tone={DRIVER_TONE[d.status]} dot={d.status === 'on_trip'} />
                    )}
                  </td>
                  <td>
                    <div className="actions">
                      {canEdit && (
                        <Button variant="ghost" size="sm" title="แก้ไข" onClick={() => openEdit(d)}><IconEdit size={14} /></Button>
                      )}
                      {isAdmin && (
                        <Button variant="ghost" size="sm" title="ลบ" className="text-danger" onClick={() => setDeleting(d)}><IconTrash size={14} /></Button>
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
        title={editing ? `แก้ไข ${editing.name}` : 'เพิ่มพนักงานขับ'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>ยกเลิก</Button>
            <Button variant="accent" onClick={save} loading={saving}>{editing ? 'บันทึก' : 'เพิ่ม'}</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="ชื่อ-นามสกุล" required>
            <Input value={form.name} onChange={set('name')} placeholder="เช่น สมชาย ใจดี" />
          </Field>
          <Field label="เบอร์โทร">
            <Input value={form.phone} onChange={set('phone')} placeholder="081-234-5678" />
          </Field>
          <Field label="เลขใบขับขี่">
            <Input value={form.license_no} onChange={set('license_no')} placeholder="ลท 123456" />
          </Field>
          <Field label="ประเภทใบขับขี่">
            <Select value={form.license_type} onChange={set('license_type')}>
              <option value="">— เลือก —</option>
              <option value="ประเภท 2">ประเภท 2</option>
              <option value="ประเภท 3">ประเภท 3</option>
              <option value="ประเภท 4">ประเภท 4</option>
            </Select>
          </Field>
          <Field label="วันที่เข้างาน">
            <Input type="date" value={form.joined_at} onChange={set('joined_at')} />
          </Field>
          {/* ผูกบัญชีเข้ากับคนขับ — นี่คือสิ่งที่ทำให้หน้า "งานของฉัน" รู้ว่าเที่ยวไหนเป็นของใคร
              ไม่ผูกก็ใช้ระบบได้ตามปกติ แค่คนขับเปิดแอปดูงานตัวเองไม่ได้ */}
          {can('users.manage') && (
            <Field
              label="บัญชีผู้ใช้ของคนขับคนนี้"
              hint={driverAccounts.length === 0 ? 'ยังไม่มีบัญชีบทบาท "พนักงานขับรถ" — สร้างที่หน้าผู้ใช้และสิทธิ์ก่อน' : 'ผูกแล้วคนขับจะเห็นเฉพาะเที่ยวของตัวเองในหน้า "งานของฉัน"'}
            >
              <Select value={form.user_id} onChange={set('user_id')}>
                <option value="">— ไม่ผูกบัญชี —</option>
                {driverAccounts.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.username})
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="ลบพนักงานขับ"
        message={deleting ? <>ต้องการลบ <b>{deleting.name}</b> ใช่หรือไม่? ถ้ามีประวัติเที่ยวขนส่ง ระบบจะบล็อกการลบ — ให้เปลี่ยนสถานะเป็น "หยุดงาน" แทน</> : ''}
        confirmLabel="ลบ"
        danger
        loading={deleteLoading}
        onConfirm={confirmDelete}
      />
    </>
  )
}
