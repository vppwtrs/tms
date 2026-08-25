import { useCallback, useEffect, useState } from 'react'
import {
  listVehicles, createVehicle, updateVehicle, setVehicleStatus, removeVehicle,
} from '../api/vehicles'
import type { Paged } from '../api/customers'
import { useUrlSearchTerm } from '../hooks/useUrlSearchTerm'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { VehicleRow } from '../types/database'
import type { VehicleStatus, VehicleType } from '../types'
import { VEHICLE_STATUS_LABEL, VEHICLE_TONE, VEHICLE_TYPE_LABEL } from '../utils/constants'
import { fmtWeight } from '../utils/format'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal,
  PageHeader, Pagination, SearchInput, Select, TableSkeleton,
} from '../components/ui'
import { IconEdit, IconPlus, IconTrash, IconTruck } from '../components/icons'

/**
 * จัดการรถยนต์ ฉบับคลาวด์ — คู่ขนานกับ Vehicles.tsx ที่ยังคุยกับ Express บน LAN
 *
 * หน้าตาเหมือนของเดิมทุกอย่าง ต่างแค่แหล่งข้อมูล (PostgREST) กับที่มาของสิทธิ์
 * (can() จาก role_permissions ไม่ใช่เทียบ role ตรง ๆ อย่างของเดิมที่เขียนว่า
 *  role !== 'viewer' — แบบนั้นสิทธิ์รายคนที่ admin ตั้งให้ไม่มีผล)
 *
 * ช่องสถานะไม่ให้เลือก "กำลังขนส่ง" เอง — สถานะนั้นมาจากการมีเที่ยววิ่งอยู่จริง
 * ให้คนตั้งเองเมื่อไหร่ ตัวเลขรถว่างจะเพี้ยนทันทีโดยไม่มีใครรู้
 */

const PAGE_SIZE = 10

interface VehicleForm {
  plate_no: string
  brand: string
  model: string
  vehicle_type: VehicleType
  capacity_kg: string
}

const emptyForm: VehicleForm = { plate_no: '', brand: '', model: '', vehicle_type: 'pickup', capacity_kg: '' }

export default function CloudVehicles(): React.JSX.Element {
  const { can } = useCloudAuth()
  const { push } = useToast()
  const canEdit = can('vehicles.write')
  const canDelete = can('vehicles.delete')

  const [data, setData] = useState<Paged<VehicleRow> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')

  /* คำค้นที่ส่งมาจากช่องค้นหารวมบนแถบบน */
  useUrlSearchTerm((term) => {
    setQ(term)
    setPage(1)
  })

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<VehicleRow | null>(null)
  const [form, setForm] = useState<VehicleForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<VehicleRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      setData(await listVehicles({ q, status: (status || undefined) as VehicleStatus | undefined, page, limit: PAGE_SIZE }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลรถไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [q, status, page])

  /* หน่วงคำค้น 300 มิลลิวินาที — ยิงทุกตัวอักษรคือยิง PostgREST ทุกตัวอักษร */
  useEffect(() => {
    const t = setTimeout(() => void load(), 300)
    return () => clearTimeout(t)
  }, [load])

  const set = (k: keyof VehicleForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const openCreate = (): void => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (v: VehicleRow): void => {
    setEditing(v)
    setForm({
      plate_no: v.plate_no,
      brand: v.brand ?? '',
      model: v.model ?? '',
      vehicle_type: v.vehicle_type,
      capacity_kg: String(v.capacity_kg),
    })
    setFormOpen(true)
  }

  const save = async (): Promise<void> => {
    if (!form.plate_no.trim()) { push('warning', 'ระบุเลขทะเบียน'); return }
    if (!Number(form.capacity_kg)) { push('warning', 'ระบุความจุ (กก.)'); return }
    setSaving(true)
    try {
      const payload = {
        plate_no: form.plate_no.trim(),
        brand: form.brand.trim() || null,
        model: form.model.trim() || null,
        vehicle_type: form.vehicle_type,
        capacity_kg: Number(form.capacity_kg),
      }
      if (editing) {
        await updateVehicle(editing.id, payload)
        push('success', `แก้ไขรถ ${editing.plate_no} เรียบร้อย`)
      } else {
        await createVehicle(payload)
        push('success', 'เพิ่มรถเรียบร้อย')
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (v: VehicleRow, next: VehicleStatus): Promise<void> => {
    try {
      await setVehicleStatus(v.id, next)
      push('success', `รถ ${v.plate_no}: ${VEHICLE_STATUS_LABEL[next]}`)
      await load()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ')
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await removeVehicle(deleting.id)
      push('success', `ลบรถ ${deleting.plate_no} แล้ว`)
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
        title="จัดการรถยนต์"
        subtitle="รถทั้งหมดในบริษัท — ทะเบียน ประเภท ความจุ และสถานะ"
        actions={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>เพิ่มรถ</Button>}
      />

      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="ค้นหาทะเบียน / ยี่ห้อ / รุ่น..." />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} style={{ width: 160 }}>
          <option value="">สถานะทั้งหมด</option>
          {(['available', 'on_trip', 'maintenance', 'inactive'] as VehicleStatus[]).map((s) => (
            <option key={s} value={s}>{VEHICLE_STATUS_LABEL[s]}</option>
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
            icon={<IconTruck size={40} />}
            title="ไม่พบรถ"
            desc="เพิ่มรถคันแรกของคุณ"
            action={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>เพิ่มรถ</Button>}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table ops-table">
            <thead>
              <tr>
                <th>ทะเบียน</th>
                <th>ยี่ห้อ / รุ่น</th>
                <th>ประเภท</th>
                <th className="num">ความจุ</th>
                <th>สถานะ</th>
                <th className="actions">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((v) => (
                <tr key={v.id}>
                  <td className="text-strong">{v.plate_no}</td>
                  <td>
                    {v.brand ?? '—'}
                    {v.model && <span className="text-muted"> {v.model}</span>}
                  </td>
                  <td>{VEHICLE_TYPE_LABEL[v.vehicle_type]}</td>
                  <td className="num">{fmtWeight(v.capacity_kg)}</td>
                  <td>
                    {canEdit ? (
                      <Select
                        value={v.status}
                        onChange={(e) => void changeStatus(v, e.target.value as VehicleStatus)}
                        style={{ width: 130, padding: '4px 8px', fontSize: 13 }}
                        disabled={v.status === 'on_trip'}
                      >
                        {(['available', 'maintenance', 'inactive'] as VehicleStatus[]).map((s) => (
                          <option key={s} value={s}>{VEHICLE_STATUS_LABEL[s]}</option>
                        ))}
                        {v.status === 'on_trip' && <option value="on_trip">กำลังขนส่ง</option>}
                      </Select>
                    ) : (
                      <Badge label={VEHICLE_STATUS_LABEL[v.status]} tone={VEHICLE_TONE[v.status]} dot={v.status === 'on_trip'} />
                    )}
                  </td>
                  <td>
                    <div className="actions">
                      {canEdit && (
                        <Button variant="ghost" size="sm" title="แก้ไข" onClick={() => openEdit(v)}><IconEdit size={14} /></Button>
                      )}
                      {canDelete && (
                        <Button variant="ghost" size="sm" title="ลบ" className="text-danger" onClick={() => setDeleting(v)}><IconTrash size={14} /></Button>
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
        title={editing ? `แก้ไขรถ ${editing.plate_no}` : 'เพิ่มรถใหม่'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>ยกเลิก</Button>
            <Button variant="accent" onClick={() => void save()} loading={saving}>{editing ? 'บันทึก' : 'เพิ่มรถ'}</Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="เลขทะเบียน" required>
            <Input value={form.plate_no} onChange={set('plate_no')} placeholder="เช่น กท-1234" />
          </Field>
          <Field label="ประเภท" required>
            <Select value={form.vehicle_type} onChange={set('vehicle_type')}>
              {(Object.keys(VEHICLE_TYPE_LABEL) as VehicleType[]).map((t) => (
                <option key={t} value={t}>{VEHICLE_TYPE_LABEL[t]}</option>
              ))}
            </Select>
          </Field>
          <Field label="ยี่ห้อ">
            <Input value={form.brand} onChange={set('brand')} placeholder="Isuzu" />
          </Field>
          <Field label="รุ่น">
            <Input value={form.model} onChange={set('model')} placeholder="D-Max" />
          </Field>
          <Field label="ความจุ (กก.)" required>
            <Input type="number" min={1} value={form.capacity_kg} onChange={set('capacity_kg')} placeholder="1500" />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="ลบรถ"
        message={deleting ? <>ต้องการลบรถ <b>{deleting.plate_no}</b> ({VEHICLE_TYPE_LABEL[deleting.vehicle_type]}) ใช่หรือไม่? ถ้ารถมีประวัติเที่ยวขนส่ง ระบบจะบล็อกการลบ — ให้เปลี่ยนสถานะเป็น &quot;ไม่ใช้งาน&quot; แทน</> : ''}
        confirmLabel="ลบรถ"
        danger
        loading={deleteLoading}
        onConfirm={() => void confirmDelete()}
      />
    </>
  )
}
