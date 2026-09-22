import { useCallback, useEffect, useState } from 'react'
import {
  listVehicles, createVehicle, updateVehicle, setVehicleStatus, removeVehicle,
  latestOdometerByVehicle, totalTollByVehicle, updateOdometerReading, vehicleUsage,
  recentTripsByVehicle, type LatestOdometer, type VehicleUsage, type VehicleUsageGrain, type VehicleTrip,
} from '../api/vehicles'
import { updateTripCosts } from '../api/trips'
import { VehicleUsagePanel } from '../components/vehicles/VehicleUsagePanel'
import type { Paged } from '../api/customers'
import { useUrlSearchTerm } from '../hooks/useUrlSearchTerm'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { VehicleRow } from '../types/database'
import type { VehicleStatus, VehicleType } from '../types'
import { VEHICLE_STATUS_LABEL, VEHICLE_TONE, VEHICLE_TYPE_LABEL } from '../utils/constants'
import { fmtWeight, fmtMoney } from '../utils/format'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal,
  PageHeader, Pagination, SearchInput, Select, TableSkeleton,
} from '../components/ui'
import { IconEdit, IconPlus, IconTrash, IconTruck } from '../components/icons'
import { fmtDate } from '../utils/format'

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
  /* ค่าทางด่วนอยู่ในตาราง trips ไม่ใช่ vehicles — ฐานเช็คสิทธิ์แก้เป็น dispatch.write
     (ดู trips_update policy) คนละสิทธิ์กับ vehicles.write ที่ใช้แก้เลขไมล์ แม้จะอยู่หน้าเดียวกัน */
  const canEditToll = can('dispatch.write')

  const [data, setData] = useState<Paged<VehicleRow> | null>(null)
  const [odometers, setOdometers] = useState<Map<number, LatestOdometer>>(new Map())
  const [tolls, setTolls] = useState<Map<number, number>>(new Map())
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

  const [odoEditing, setOdoEditing] = useState<{ vehicle: VehicleRow; odo: LatestOdometer } | null>(null)
  const [odoValue, setOdoValue] = useState('')
  const [odoSaving, setOdoSaving] = useState(false)

  const [usageVehicle, setUsageVehicle] = useState<VehicleRow | null>(null)
  const [usageGrain, setUsageGrain] = useState<VehicleUsageGrain>('day')
  const [usageData, setUsageData] = useState<VehicleUsage | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState('')

  const [tollVehicle, setTollVehicle] = useState<VehicleRow | null>(null)
  const [tollTrips, setTollTrips] = useState<VehicleTrip[]>([])
  const [tollLoading, setTollLoading] = useState(false)
  const [tollError, setTollError] = useState('')
  const [tollDrafts, setTollDrafts] = useState<Map<number, string>>(new Map())
  const [tollSavingId, setTollSavingId] = useState<number | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const paged = await listVehicles({ q, status: (status || undefined) as VehicleStatus | undefined, page, limit: PAGE_SIZE })
      setData(paged)
      const ids = paged.rows.map((v) => v.id)
      /* เลขไมล์กับค่าทางด่วนแค่ของหน้าที่กำลังดู ไม่ต้องดึงรถทั้งบริษัททุกครั้ง */
      const [odo, toll] = await Promise.all([latestOdometerByVehicle(ids), totalTollByVehicle(ids)])
      setOdometers(odo)
      setTolls(toll)
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

  const openOdoEdit = (v: VehicleRow, odo: LatestOdometer): void => {
    setOdoEditing({ vehicle: v, odo })
    setOdoValue(String(odo.reading_km))
  }

  const saveOdo = async (): Promise<void> => {
    if (!odoEditing) return
    const km = Number(odoValue)
    if (!odoValue.trim() || !Number.isFinite(km) || km < 0) { push('warning', 'กรอกเลขไมล์เป็นตัวเลข'); return }
    setOdoSaving(true)
    try {
      await updateOdometerReading(odoEditing.odo.id, km)
      push('success', `แก้เลขไมล์ ${odoEditing.vehicle.plate_no} เป็น ${km.toLocaleString('th-TH')} กม. แล้ว`)
      setOdoEditing(null)
      await load()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'แก้เลขไมล์ไม่สำเร็จ')
    } finally {
      setOdoSaving(false)
    }
  }

  const loadUsage = useCallback(async (vehicleId: number, grain: VehicleUsageGrain): Promise<void> => {
    setUsageLoading(true)
    setUsageError('')
    try {
      setUsageData(await vehicleUsage(vehicleId, grain))
    } catch (e) {
      setUsageError(e instanceof Error ? e.message : 'โหลดข้อมูลการใช้รถไม่สำเร็จ')
    } finally {
      setUsageLoading(false)
    }
  }, [])

  const openUsage = (v: VehicleRow): void => {
    setUsageVehicle(v)
    setUsageData(null)
    setUsageGrain('day')
    void loadUsage(v.id, 'day')
  }

  const changeUsageGrain = (g: VehicleUsageGrain): void => {
    setUsageGrain(g)
    if (usageVehicle) void loadUsage(usageVehicle.id, g)
  }

  const openTollEdit = (v: VehicleRow): void => {
    setTollVehicle(v)
    setTollTrips([])
    setTollDrafts(new Map())
    setTollError('')
    setTollLoading(true)
    recentTripsByVehicle(v.id)
      .then((trips) => {
        setTollTrips(trips)
        setTollDrafts(new Map(trips.map((t) => [t.id, String(t.toll_cost)])))
      })
      .catch((e: unknown) => setTollError(e instanceof Error ? e.message : 'โหลดรายการเที่ยวไม่สำเร็จ'))
      .finally(() => setTollLoading(false))
  }

  const saveToll = async (tripId: number): Promise<void> => {
    const raw = tollDrafts.get(tripId) ?? ''
    const km = Number(raw)
    if (!raw.trim() || !Number.isFinite(km) || km < 0) { push('warning', 'กรอกค่าทางด่วนเป็นตัวเลข'); return }
    setTollSavingId(tripId)
    try {
      await updateTripCosts(tripId, { toll_cost: km })
      setTollTrips((prev) => prev.map((t) => t.id === tripId ? { ...t, toll_cost: km } : t))
      push('success', `แก้ค่าทางด่วนเป็น ${km.toLocaleString('th-TH')} บาท แล้ว`)
      await load()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'แก้ค่าทางด่วนไม่สำเร็จ')
    } finally {
      setTollSavingId(null)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

  return (
    <>
      <PageHeader
        title="จัดการรถยนต์"
        subtitle="รถทั้งหมดในบริษัท — ทะเบียน ประเภท ความจุ และสถานะ"
        filters={<>
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="ค้นหาทะเบียน / ยี่ห้อ / รุ่น..." />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} style={{ width: 160 }}>
            <option value="">สถานะทั้งหมด</option>
            {(['available', 'on_trip', 'maintenance', 'inactive'] as VehicleStatus[]).map((s) => (
              <option key={s} value={s}>{VEHICLE_STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </>}
        actions={canEdit && <Button variant="accent" icon={<IconPlus size={16} />} onClick={openCreate}>เพิ่มรถ</Button>}
      />


      {error ? (
        <ErrorBox message={error} onRetry={() => void load()} />
      ) : loading || !data ? (
        <TableSkeleton rows={8} cols={8} />
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
                <th className="num">เลขไมล์ล่าสุด</th>
                <th className="num">ค่าทางด่วนสะสม</th>
                <th>สถานะ</th>
                <th className="actions">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((v) => (
                <tr key={v.id}>
                  <td className="text-strong">
                    <button
                      type="button"
                      className="link-button"
                      title="ดูรายละเอียดการใช้งาน"
                      onClick={() => openUsage(v)}
                    >
                      {v.plate_no}
                    </button>
                  </td>
                  <td>
                    {v.brand ?? '—'}
                    {v.model && <span className="text-muted"> {v.model}</span>}
                  </td>
                  <td>{VEHICLE_TYPE_LABEL[v.vehicle_type]}</td>
                  <td className="num">{fmtWeight(v.capacity_kg)}</td>
                  <td className="num">
                    {odometers.has(v.id)
                      ? <>{odometers.get(v.id)!.reading_km.toLocaleString('th-TH')} กม.
                        <span className="text-muted"> ({odometers.get(v.id)!.kind === 'start' ? 'ออกรถ' : 'จบงาน'})</span>
                        {odometers.get(v.id)!.needs_review && (
                          <span className="odo-review-tag" title={odometers.get(v.id)!.review_note ?? undefined}>รอตรวจ</span>
                        )}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="แก้เลขไมล์"
                            onClick={() => openOdoEdit(v, odometers.get(v.id)!)}
                          >
                            <IconEdit size={12} />
                          </Button>
                        )}</>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="num">
                    {fmtMoney(tolls.get(v.id) ?? 0)}
                    {canEditToll && (
                      <Button variant="ghost" size="sm" title="แก้ค่าทางด่วน" onClick={() => openTollEdit(v)}>
                        <IconEdit size={12} />
                      </Button>
                    )}
                  </td>
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

      <Modal
        open={odoEditing !== null}
        onClose={() => setOdoEditing(null)}
        title={odoEditing ? `แก้เลขไมล์ — ${odoEditing.vehicle.plate_no}` : 'แก้เลขไมล์'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOdoEditing(null)}>ยกเลิก</Button>
            <Button variant="accent" onClick={() => void saveOdo()} loading={odoSaving}>บันทึก</Button>
          </>
        }
      >
        {odoEditing && (
          <div className="form-grid">
            <p className="text-muted" style={{ margin: 0 }}>
              ค่าปัจจุบัน: <b>{odoEditing.odo.reading_km.toLocaleString('th-TH')} กม.</b>
              {' '}({odoEditing.odo.kind === 'start' ? 'ออกรถ' : 'จบงาน'} · {fmtDate(odoEditing.odo.reading_date)})
            </p>
            {odoEditing.odo.needs_review && (
              <p className="odo-suspect" style={{ margin: 0 }}>
                คนขับยืนยันเลขนี้ทั้งที่ระบบเตือนว่า{odoEditing.odo.review_note ?? 'ผิดปกติ'} — ตรวจหน้าปัดจริงแล้วบันทึก
                (บันทึกเลขเดิมได้ถ้าถูกต้องแล้ว ป้ายรอตรวจจะหายไป)
              </p>
            )}
            <Field label="เลขไมล์ที่ถูกต้อง (กม.)" required>
              <Input
                type="number"
                min={0}
                value={odoValue}
                onChange={(e) => setOdoValue(e.target.value)}
              />
            </Field>
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              แก้ได้เฉพาะค่าล่าสุดของวันนั้น ระบบยังกันไม่ให้เลขย้อนหลังน้อยกว่าครั้งก่อนหน้า
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={usageVehicle !== null}
        onClose={() => setUsageVehicle(null)}
        title={usageVehicle ? `รายละเอียดการใช้งาน — ${usageVehicle.plate_no}` : 'รายละเอียดการใช้งาน'}
        size="xl"
      >
        {usageVehicle && (
          <VehicleUsagePanel
            data={usageData}
            grain={usageGrain}
            onGrain={changeUsageGrain}
            loading={usageLoading}
            error={usageError}
          />
        )}
      </Modal>

      <Modal
        open={tollVehicle !== null}
        onClose={() => setTollVehicle(null)}
        title={tollVehicle ? `แก้ค่าทางด่วน — ${tollVehicle.plate_no}` : 'แก้ค่าทางด่วน'}
        size="lg"
      >
        {tollVehicle && (
          <>
            <p className="text-muted" style={{ margin: '0 0 12px' }}>
              ยอดสะสมปัจจุบัน: <b>{fmtMoney(tolls.get(tollVehicle.id) ?? 0)}</b> — เลือกเที่ยวที่ยอดผิดแล้วแก้เฉพาะเที่ยวนั้น
            </p>
            {tollError ? (
              <ErrorBox message={tollError} onRetry={() => openTollEdit(tollVehicle)} />
            ) : tollLoading ? (
              <TableSkeleton rows={4} cols={1} />
            ) : tollTrips.length === 0 ? (
              <EmptyState icon={<IconTruck size={28} />} title="ยังไม่มีเที่ยว" desc="คันนี้ยังไม่มีประวัติเที่ยววิ่ง" />
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {tollTrips.map((t) => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{t.trip_no}</b>
                      <span className="text-muted"> · {fmtDate(t.trip_date)}</span>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      style={{ width: 100 }}
                      value={tollDrafts.get(t.id) ?? ''}
                      onChange={(e) => setTollDrafts((prev) => new Map(prev).set(t.id, e.target.value))}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={tollSavingId === t.id}
                      onClick={() => void saveToll(t.id)}
                    >
                      บันทึก
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
              แสดง 10 เที่ยวล่าสุดของคันนี้ — แก้ทีละเที่ยว กดบันทึกแยกแถว ไม่กระทบยอดของเที่ยวอื่น
            </p>
          </>
        )}
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
