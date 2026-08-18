import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getTripBoardDetailed, createTrip, addOrdersToTrip, removeOrderFromTrip,
  startTrip, completeTrip, cancelTrip, type BoardTrip,
} from '../api/trips'
import { listUnassignedOrders, type DispatchOrderRow } from '../api/orders'
import { useRealtime } from '../hooks/useRealtime'
import { listAvailableVehicles, listAvailableDrivers } from '../api/vehicles'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { DriverRow, OrderRow, VehicleRow } from '../types/database'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Modal,
  PageHeader, SearchInput, Select, TableSkeleton, Textarea,
} from '../components/ui'
import {
  ORDER_STATUS_LABEL, ORDER_TONE, PRIORITY_LABEL,
  TRIP_STATUS_LABEL, TRIP_TONE, VEHICLE_TYPE_LABEL,
} from '../utils/constants'
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtWeight } from '../utils/format'
import { IconBox, IconCheck, IconPlus, IconRoute, IconTruck, IconUsers, IconX } from '../components/icons'

/**
 * แผนงานขนส่ง ฉบับคลาวด์ — คู่ขนานกับ Dispatch.tsx บน LAN
 *
 * ทุกปุ่มในหน้านี้ยิง RPC ไม่ใช่แก้ตารางตรง เพราะการกระทำเดียวแตะหลายตาราง
 * (สร้างเที่ยว = insert trips + update orders + update vehicles + update drivers)
 * ยิงทีละตารางแล้วเน็ตหลุดกลางทางจะได้เที่ยวที่มีออเดอร์แต่รถยังว่าง
 * ซึ่งเป็นสถานะที่ไม่มีทางเกิดตอนอยู่บน Express — ดู api/trips.ts
 *
 * น้ำหนักเกินความจุ **เตือน ไม่ห้าม** คนจัดรถรู้หน้างานดีกว่าตัวเลขที่กรอกไว้ในระบบ
 */

export default function CloudDispatch(): React.JSX.Element {
  const { can } = useCloudAuth()
  const { push } = useToast()
  const canEdit = can('dispatch.write')

  const [board, setBoard] = useState<{ planned: BoardTrip[]; in_progress: BoardTrip[] } | null>(null)
  const [pendingOrders, setPendingOrders] = useState<DispatchOrderRow[]>([])
  const [vehicles, setVehicles] = useState<VehicleRow[]>([])
  const [drivers, setDrivers] = useState<DriverRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [cancelling, setCancelling] = useState<BoardTrip | null>(null)
  const [addTo, setAddTo] = useState<BoardTrip | null>(null)
  const [addSelected, setAddSelected] = useState<Set<number>>(new Set())

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const [b, p, v, d] = await Promise.all([
        getTripBoardDetailed(),
        listUnassignedOrders(),
        listAvailableVehicles(),
        listAvailableDrivers(),
      ])
      setBoard(b); setPendingOrders(p); setVehicles(v); setDrivers(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดแผนงานไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])

  /* กระดานจัดรถเป็นหน้าที่คนหลายคนแก้พร้อมกันมากที่สุด — คนหนึ่งลากออเดอร์เข้าเที่ยว
     อีกคนต้องเห็นทันที ไม่ใช่ลากซ้ำแล้วเจอ error ว่าออเดอร์ถูกจัดไปแล้ว */
  useRealtime(['trips', 'orders'], () => void loadAll())

  const filteredPending = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return pendingOrders
    return pendingOrders.filter(
      (o) => o.order_no.toLowerCase().includes(s) || o.destination.toLowerCase().includes(s),
    )
  }, [pendingOrders, q])

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, id: number): void => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
  }

  const selectedOrders = pendingOrders.filter((o) => selected.has(o.id))
  const selectedWeight = selectedOrders.reduce((s, o) => s + o.weight_kg, 0)
  const selectedVehicle = vehicles.find((v) => v.id === Number(vehicleId))
  const capacityPct = selectedVehicle && selectedVehicle.capacity_kg > 0
    ? (selectedWeight / selectedVehicle.capacity_kg) * 100
    : 0
  const capacityClass = capacityPct > 100 ? 'over' : capacityPct > 90 ? 'warn' : ''

  const submitCreate = async (): Promise<void> => {
    if (!vehicleId) { push('warning', 'เลือก รถ ที่จะใช้ในเที่ยวนี้'); return }
    if (!driverId) { push('warning', 'เลือก พนักงานขับ สำหรับเที่ยวนี้'); return }
    if (selected.size === 0) { push('warning', 'เลือกอย่างน้อย 1 ออเดอร์'); return }
    setCreating(true)
    try {
      const res = await createTrip({
        vehicleId: Number(vehicleId),
        driverId: Number(driverId),
        orderIds: [...selected],
        notes: notes.trim() || null,
      })
      if (res.warning) push('warning', res.warning)
      else push('success', `สร้างเที่ยว ${res.trip_no} เรียบร้อย`)
      setSelected(new Set()); setVehicleId(''); setDriverId(''); setNotes('')
      await loadAll()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'สร้างเที่ยวไม่สำเร็จ')
    } finally {
      setCreating(false)
    }
  }

  const act = async (id: number, fn: () => Promise<unknown>, okMsg: string): Promise<void> => {
    setBusyId(id)
    try {
      await fn()
      push('success', okMsg)
      await loadAll()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusyId(null)
    }
  }

  const submitAddOrders = async (): Promise<void> => {
    if (!addTo || addSelected.size === 0) return
    const trip = addTo
    setAddTo(null)
    await act(trip.id, async () => {
      const res = await addOrdersToTrip(trip.id, [...addSelected])
      if (res.warning) push('warning', res.warning)
    }, 'เพิ่มออเดอร์เข้าเที่ยวเรียบร้อย')
    setAddSelected(new Set())
  }

  if (error) return <ErrorBox message={error} onRetry={() => void loadAll()} />

  const planned = board?.planned ?? []
  const inProgress = board?.in_progress ?? []

  return (
    <>
      <PageHeader title="แผนงานขนส่ง" subtitle="เลือกออเดอร์รอจัดคิว → จับคู่รถ + พนักงานขับ → สร้างเที่ยวขนส่ง" />

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title">สร้างเที่ยวขนส่งใหม่</div>
        {!canEdit ? (
          <div className="text-muted text-sm">บัญชีนี้เป็นโหมดดูอย่างเดียว</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24, alignItems: 'start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <SearchInput value={q} onChange={setQ} placeholder="ค้นหาออเดอร์รอจัดคิว..." />
                <span className="text-sm text-muted">เหลือรอจัดคิว {fmtNum(pendingOrders.length)} ใบ</span>
              </div>
              <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }} />
                      <th>เลขที่</th>
                      <th>เส้นทาง</th>
                      <th className="num">น้ำหนัก</th>
                      <th>กำหนด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPending.map((o) => (
                      <tr
                        key={o.id}
                        style={{ cursor: 'pointer', background: selected.has(o.id) ? 'var(--accent-050)' : undefined }}
                        onClick={() => toggle(selected, setSelected, o.id)}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(o.id)}
                            onChange={() => toggle(selected, setSelected, o.id)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                            aria-label={`เลือก ${o.order_no}`}
                          />
                        </td>
                        <td>
                          <div className="cell-no">
                            <span className="text-strong">{o.tms_pl_no ?? o.order_no}</span>
                            {o.priority === 'urgent' && <Badge label={PRIORITY_LABEL.urgent} tone="urgent" dot />}
                          </div>
                          <div className="text-xs text-muted">
                            {o.tms_pl_no ? `ออเดอร์ ${o.order_no} · ${o.tms_kind === 'box' ? 'กล่อง' : 'รถ'}` : o.goods_desc}
                            {o.tms_units != null && ` · ${o.tms_units} หน่วย`}
                          </div>
                        </td>
                        <td>{o.origin} → {o.destination}</td>
                        <td className="num">{fmtWeight(o.weight_kg)}</td>
                        <td className="text-sm cell-date">{fmtDate(o.scheduled_at)}</td>
                      </tr>
                    ))}
                    {filteredPending.length === 0 && (
                      <tr>
                        <td colSpan={5}>
                          <EmptyState
                            icon={<IconBox size={30} />}
                            title={q ? 'ไม่พบออเดอร์ที่ค้นหา' : 'ไม่มีออเดอร์รอจัดคิว'}
                            desc={q ? '' : 'นำเข้าออเดอร์จาก TMS หรือสร้างเองที่หน้าออเดอร์'}
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                <Field label="รถ (เฉพาะคันที่ว่าง)" required>
                  <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">— เลือกรถ —</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate_no} · {VEHICLE_TYPE_LABEL[v.vehicle_type]} ({fmtWeight(v.capacity_kg)})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="พนักงานขับ (เฉพาะคนที่ว่าง)" required>
                  <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                    <option value="">— เลือกพนักงานขับ —</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="หมายเหตุเที่ยว">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="เช่น ลำดับส่งสินค้า / จุดพักรถ"
                    style={{ minHeight: 52 }}
                  />
                </Field>
              </div>

              <div style={{ margin: '14px 0', padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--line)' }}>
                <div className="text-sm text-strong">ออเดอร์ที่เลือก: {fmtNum(selected.size)} ใบ</div>
                {selectedOrders.slice(0, 4).map((o) => (
                  <div key={o.id} className="text-xs text-muted" style={{ marginTop: 4 }}>
                    {o.order_no} · {o.origin}→{o.destination} · {fmtWeight(o.weight_kg)}
                  </div>
                ))}
                {selectedOrders.length > 4 && (
                  <div className="text-xs text-muted" style={{ marginTop: 4 }}>และอีก {selectedOrders.length - 4} ใบ...</div>
                )}
                <div className="capacity-bar">
                  <div className={`fill ${capacityClass}`} style={{ width: `${Math.min(100, capacityPct)}%` }} />
                </div>
                <div className="text-xs text-muted" style={{ marginTop: 5 }}>
                  น้ำหนักรวม {fmtWeight(selectedWeight)}
                  {selectedVehicle && <span> / ความจุ {fmtWeight(selectedVehicle.capacity_kg)}</span>}
                  {capacityPct > 100 && <b className="text-danger"> · เกินความจุ!</b>}
                </div>
              </div>

              <Button variant="accent" size="lg" style={{ width: '100%' }} icon={<IconPlus size={16} />} loading={creating} onClick={() => void submitCreate()}>
                สร้างเที่ยวขนส่ง
              </Button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
          <div>
            <h2 style={{ fontSize: 17, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <IconRoute size={18} style={{ color: 'var(--info)' }} />
              วางแผนแล้ว
              <Badge label={fmtNum(planned.length)} tone="planned" />
            </h2>
            {planned.length === 0 && <div className="card"><EmptyState title="ยังไม่มีเที่ยวที่วางแผน" desc="สร้างเที่ยวจากออเดอร์ด้านบน" /></div>}
            {planned.map((t) => (
              <TripCard
                key={t.id}
                trip={t}
                busy={busyId === t.id}
                canEdit={canEdit}
                onStart={() => void act(t.id, () => startTrip(t.id), `เริ่มเที่ยว ${t.trip_no} — สถานะออเดอร์เป็นกำลังขนส่ง`)}
                onAddOrders={() => { setAddTo(t); setAddSelected(new Set()) }}
                onCancel={() => setCancelling(t)}
                onRemoveOrder={(orderId) => void act(t.id, () => removeOrderFromTrip(t.id, orderId), 'ถอนออเดอร์ออกจากเที่ยวแล้ว')}
              />
            ))}
          </div>

          <div>
            <h2 style={{ fontSize: 17, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <IconTruck size={18} style={{ color: 'var(--warning)' }} />
              กำลังขนส่ง
              <Badge label={fmtNum(inProgress.length)} tone="in_progress" dot />
            </h2>
            {inProgress.length === 0 && <div className="card"><EmptyState title="ไม่มีเที่ยวกำลังขนส่ง" desc="เที่ยวที่เริ่มแล้วจะแสดงที่นี่" /></div>}
            {inProgress.map((t) => (
              <TripCard
                key={t.id}
                trip={t}
                busy={busyId === t.id}
                canEdit={canEdit}
                onComplete={() => void act(t.id, () => completeTrip(t.id), `เที่ยว ${t.trip_no} เสร็จสิ้น — ออเดอร์เป็นส่งสำเร็จ`)}
                onCancel={() => setCancelling(t)}
              />
            ))}
          </div>
        </div>
      )}

      <Modal
        open={addTo !== null}
        onClose={() => setAddTo(null)}
        title={addTo ? `เพิ่มออเดอร์ใน ${addTo.trip_no}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddTo(null)}>ปิด</Button>
            <Button variant="primary" onClick={() => void submitAddOrders()} disabled={addSelected.size === 0}>
              เพิ่ม {addSelected.size > 0 ? `(${addSelected.size} ใบ)` : ''}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
          {pendingOrders.map((o) => (
            <label
              key={o.id}
              style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', cursor: 'pointer', background: addSelected.has(o.id) ? 'var(--primary-050)' : 'var(--surface)' }}
            >
              <input
                type="checkbox"
                checked={addSelected.has(o.id)}
                onChange={() => toggle(addSelected, setAddSelected, o.id)}
                style={{ accentColor: 'var(--accent)' }}
              />
              <div style={{ flex: 1 }}>
                <div className="text-sm text-strong" style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{o.order_no}</div>
                <div className="text-xs text-muted">{o.origin} → {o.destination} · {fmtWeight(o.weight_kg)} · {fmtMoney(o.fee)}</div>
              </div>
              {o.priority === 'urgent' && <Badge label="ด่วน" tone="urgent" dot />}
            </label>
          ))}
          {pendingOrders.length === 0 && <EmptyState icon={<IconBox size={30} />} title="ไม่มีออเดอร์รอจัดคิว" />}
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="ยกเลิกเที่ยวขนส่ง"
        message={cancelling ? <>ต้องการยกเลิกเที่ยว <b>{cancelling.trip_no}</b> ({cancelling.vehicle_plate} · {cancelling.driver_name}) ใช่หรือไม่? ออเดอร์ในเที่ยวจะกลับเป็น <b>รอจัดคิว</b> และรถ/คนขับจะว่างทันที</> : ''}
        confirmLabel="ยกเลิกเที่ยว"
        danger
        loading={busyId !== null}
        onConfirm={() => {
          const t = cancelling
          setCancelling(null)
          if (t) void act(t.id, () => cancelTrip(t.id), `ยกเลิกเที่ยว ${t.trip_no} แล้ว — รถ/คนขับกลับว่าง`)
        }}
      />
    </>
  )
}

function TripCard({
  trip, busy, canEdit, onStart, onComplete, onCancel, onAddOrders, onRemoveOrder,
}: {
  trip: BoardTrip
  busy: boolean
  canEdit: boolean
  onStart?: () => void
  onComplete?: () => void
  onCancel: () => void
  onAddOrders?: () => void
  onRemoveOrder?: (orderId: number) => void
}): React.JSX.Element {
  const pct = trip.vehicle_capacity > 0 ? (trip.total_weight / trip.vehicle_capacity) * 100 : 0
  const capClass = pct > 100 ? 'over' : pct > 90 ? 'warn' : ''
  const routes = [...new Set(trip.orders.map((o) => `${o.origin} → ${o.destination}`))].join(' · ')

  return (
    <div className="trip-card">
      <div className="trip-head">
        <span className="trip-no">{trip.trip_no}</span>
        <Badge label={TRIP_STATUS_LABEL[trip.status]} tone={TRIP_TONE[trip.status]} dot={trip.status === 'in_progress'} />
        <div className="spacer" style={{ flex: 1 }} />
        {canEdit && trip.status === 'planned' && onStart && (
          <Button variant="outline" size="sm" onClick={onStart} loading={busy}>
            <IconCheck size={14} /> เริ่มเที่ยว
          </Button>
        )}
        {canEdit && trip.status === 'in_progress' && onComplete && (
          <Button variant="success" size="sm" onClick={onComplete} loading={busy}>
            <IconCheck size={14} /> เสร็จสิ้น
          </Button>
        )}
        {canEdit && (
          <Button variant="ghost" size="sm" className="text-danger" onClick={onCancel} disabled={busy}>
            ยกเลิกเที่ยว
          </Button>
        )}
      </div>

      <div className="trip-meta">
        <span>
          <IconTruck size={14} style={{ verticalAlign: -2 }} /> <b>{trip.vehicle_plate}</b>
          {' · '}{VEHICLE_TYPE_LABEL[trip.vehicle_type as keyof typeof VEHICLE_TYPE_LABEL] ?? trip.vehicle_type}
        </span>
        <span><IconUsers size={14} style={{ verticalAlign: -2 }} /> <b>{trip.driver_name}</b></span>
        <span>น้ำหนักรวม <b>{fmtWeight(trip.total_weight)}</b> / {fmtWeight(trip.vehicle_capacity)}</span>
        {trip.status === 'in_progress' && trip.departed_at && <span>ออกเดินทาง <b>{fmtDateTime(trip.departed_at)}</b></span>}
      </div>

      <div className="capacity-bar">
        <div className={`fill ${capClass}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="text-xs text-muted" style={{ marginTop: 5 }}>
        ใช้อัตราความจุ {Math.round(pct)}% {pct > 100 && <b className="text-danger">· เกินความจุ!</b>}
      </div>

      {routes && <div className="text-sm" style={{ marginTop: 8 }}>{routes}</div>}

      <div className="trip-orders">
        {trip.orders.map((o) => (
          <div key={o.id} className="trip-order-row">
            <span className="text-strong" style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{o.order_no}</span>
            <span className="text-xs text-muted">{o.origin} → {o.destination}</span>
            {o.priority === 'urgent' && <Badge label="ด่วน" tone="urgent" />}
            <span className="grow" />
            <span className="text-xs text-muted">{fmtWeight(o.weight_kg)}</span>
            <Badge label={ORDER_STATUS_LABEL[o.status]} tone={ORDER_TONE[o.status]} />
            {canEdit && trip.status === 'planned' && onRemoveOrder && (
              <Button variant="ghost" size="sm" title="ถอนออเดอร์" onClick={() => onRemoveOrder(o.id)}>
                <IconX size={13} />
              </Button>
            )}
          </div>
        ))}
        {canEdit && trip.status === 'planned' && onAddOrders && (
          <Button variant="ghost" size="sm" onClick={onAddOrders} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
            <IconPlus size={13} /> เพิ่มออเดอร์ในเที่ยวนี้
          </Button>
        )}
      </div>
    </div>
  )
}
