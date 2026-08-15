import { useCallback, useEffect, useState } from 'react'
import {
  listDrivers, createDriver, updateDriver, setDriverStatus, removeDriver,
} from '../api/vehicles'
import { listUsers } from '../api/users'
import type { Paged } from '../api/customers'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { DriverRow, UserRow } from '../types/database'
import type { DriverStatus } from '../types'
import { DRIVER_STATUS_LABEL, DRIVER_TONE } from '../utils/constants'
import { fmtDate } from '../utils/format'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal,
  PageHeader, Pagination, SearchInput, Select, TableSkeleton,
} from '../components/ui'
import { IconEdit, IconPlus, IconTrash, IconUsers } from '../components/icons'

/**
 * พนักงานขับ ฉบับคลาวด์ — คู่ขนานกับ Drivers.tsx บน LAN
 *
 * ช่อง "บัญชีผู้ใช้ของคนขับคนนี้" คือสิ่งที่ทำให้หน้างานของฉันรู้ว่าเที่ยวไหนเป็นของใคร
 * ไม่ผูกก็ใช้ระบบได้ตามปกติ แค่คนขับเปิดแอปดูงานตัวเองไม่ได้ — เป็นจุดที่คนลืมบ่อย
 * แล้วมาบอกว่า "แอปคนขับพัง" ทั้งที่แค่ยังไม่ผูกบัญชี
 */

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

export default function CloudDrivers(): React.JSX.Element {
  const { can } = useCloudAuth()
  const { push } = useToast()
  const canEdit = can('drivers.write')
  const canDelete = can('drivers.delete')
  const canManageUsers = can('users.manage')

  const [data, setData] = useState<Paged<DriverRow> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')

  const [driverAccounts, setDriverAccounts] = useState<UserRow[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<DriverRow | null>(null)
  const [form, setForm] = useState<DriverForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<DriverRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      setData(await listDrivers({ q, status: (status || undefined) as DriverStatus | undefined, page, limit: PAGE_SIZE }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลพนักงานขับไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [q, status, page])

  useEffect(() => {
    const t = setTimeout(() => void load(), 300)
    return () => clearTimeout(t)
  }, [load])

  /* โหลดเฉพาะคนที่มีสิทธิ์จัดการผู้ใช้ — คนอื่นยิงไปก็ถูก RLS ตัดทิ้งเปล่า ๆ */
  useEffect(() => {
    if (!canManageUsers) return
    listUsers()
      .then((list) => setDriverAccounts(list.filter((u) => u.role === 'driver' && u.is_active)))
      .catch(() => setDriverAccounts([]))
  }, [canManageUsers])

  const set = (k: keyof DriverForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const openCreate = (): void => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (d: DriverRow): void => {
    setEditing(d)
    setForm({
      name: d.name,
      phone: d.phone ?? '',
      license_no: d.license_no ?? '',
      license_type: d.license_type ?? '',
      joined_at: d.joined_at ?? '',
      user_id: d.user_id ? String(d.user_id) : '',
    })
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
        await updateDriver(editing.id, payload)
        push('success', `แก้ไข ${editing.name} เรียบร้อย`)
      } else {
        await createDriver(payload)
        push('success', 'เพิ่มพนักงานขับเรียบร้อย')
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (d: DriverRow, next: DriverStatus): Promise<void> => {
    try {
      await setDriverStatus(d.id, next)
      push('success', `${d.name}: ${DRIVER_STATUS_LABEL[next]}`)
      await load()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ')
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await removeDriver(deleting.id)
      push('success', `ลบ ${deleting.name} แล้ว`)
      setDeleting(null)
      await load()
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
        <ErrorBox message={error} onRetry={() => void load()} />
      ) : loading || !data ? (
        <TableSkeleton rows={8} cols={6} />
      ) : data.rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<IconUsers size={40} />}
            title="ไม่พบพนักงานขับ"
            desc="เพิ่มพนักงานขับคนแรก"
            action={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>เพิ่มพนักงานขับ</Button>}
          />
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
              {data.rows.map((d) => (
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
                        onChange={(e) => void changeStatus(d, e.target.value as DriverStatus)}
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
                      {canDelete && (
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

      {data && data.total > 0 && (
        <Pagination page={page} totalPages={totalPages} total={data.total} onChange={setPage} />
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `แก้ไข ${editing.name}` : 'เพิ่มพนักงานขับ'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>ยกเลิก</Button>
            <Button variant="accent" onClick={() => void save()} loading={saving}>{editing ? 'บันทึก' : 'เพิ่ม'}</Button>
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
          {canManageUsers && (
            <Field
              label="บัญชีผู้ใช้ของคนขับคนนี้"
              hint={driverAccounts.length === 0
                ? 'ยังไม่มีบัญชีบทบาท "พนักงานขับรถ" — สร้างที่หน้าผู้ใช้และสิทธิ์ก่อน'
                : 'ผูกแล้วคนขับจะเห็นเฉพาะเที่ยวของตัวเองในหน้า "งานของฉัน"'}
            >
              <Select value={form.user_id} onChange={set('user_id')}>
                <option value="">— ไม่ผูกบัญชี —</option>
                {driverAccounts.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.username})</option>
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
        message={deleting ? <>ต้องการลบ <b>{deleting.name}</b> ใช่หรือไม่? ถ้ามีประวัติเที่ยวขนส่ง ระบบจะบล็อกการลบ — ให้เปลี่ยนสถานะเป็น &quot;พักงาน&quot; แทน</> : ''}
        confirmLabel="ลบ"
        danger
        loading={deleteLoading}
        onConfirm={() => void confirmDelete()}
      />
    </>
  )
}
