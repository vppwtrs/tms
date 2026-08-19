import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  getTripBoardDetailed, createTrip, addOrdersToTrip, removeOrderFromTrip,
  startTrip, completeTrip, cancelTrip, acceptTrip, clearTripIssue, type BoardTrip,
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

/** เลขที่ใช้เรียกใบนี้กับคนนอกระบบ — PL ก่อนเสมอ เหมือนหน้าออเดอร์
 *
 * ORD เป็นเลขที่ระบบเราสร้างเอง คลัง ร้านค้า และคนขับไม่รู้จัก ทุกฝ่ายอ้าง PL
 * ใบที่สร้างเองในระบบไม่มี PL จึงเป็นกรณีเดียวที่ยังต้องใช้ ORD
 */
function billNo(o: { tms_picking_list_no?: string | null; order_no: string }): string {
  return o.tms_picking_list_no ?? o.order_no
}

/** เลขเที่ยวที่คนเรียกกันจริง — ของ TMS ก่อน TRP ของเราเป็นตัวสำรอง */
function tripNo(t: { tms_trip_no?: string | null; trip_no: string }): string {
  return t.tms_trip_no ?? t.trip_no
}

/** รวมใบที่ไปปลายทางเดียวกันเป็นจุดเดียว — หลักเดียวกับหน้าออเดอร์และจอคนขับ
 *  ข้อมูลชุดนี้ไม่มีชื่อลูกค้าติดมา (เป็นแถวดิบของตาราง orders) ปลายทางจึงเป็นตัวแทนร้าน */
function byStore<T extends { destination: string }>(rows: T[]): { key: string; rows: T[] }[] {
  const map = new Map<string, T[]>()
  for (const o of rows) {
    const key = o.destination.trim().toLowerCase().replace(/\s+/g, ' ')
    const found = map.get(key)
    if (found) found.push(o)
    else map.set(key, [o])
  }
  return [...map.entries()].map(([key, group]) => ({ key, rows: group }))
}

export default function CloudDispatch(): React.JSX.Element {
  const { can } = useCloudAuth()
  const { push } = useToast()
  const canEdit = can('dispatch.write')

  const [board, setBoard] = useState<{ waiting: BoardTrip[]; running: BoardTrip[]; done: BoardTrip[] } | null>(null)
  /* ฟอร์มสร้างเที่ยวเองย้ายเข้าหน้าต่าง — งานเกือบทั้งหมดมาจาก TMS พร้อมรถและคนขับแล้ว
     ของเดิมกินครึ่งจอเพื่อรอ "ออเดอร์รอจัดคิว" ที่เป็น 0 ใบตลอด */
  const [createOpen, setCreateOpen] = useState(false)
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
      /* ค้นด้วยเลข PL ได้ด้วย — เป็นเลขที่คนถืออยู่ในมือตอนค้น */
      (o) => billNo(o).toLowerCase().includes(s) || o.order_no.toLowerCase().includes(s)
        || o.destination.toLowerCase().includes(s),
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
      setCreateOpen(false)
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

  const waiting = board?.waiting ?? []
  const running = board?.running ?? []
  const done = board?.done ?? []
  const noAccount = [...waiting, ...running].filter((t) => !t.driver_has_account)

  return (
    <>
      <PageHeader
        title="แผนงานขนส่ง"
        subtitle="งานจาก TMS เข้ามาเองพร้อมรถและคนขับ — หน้านี้ดูว่าถึงมือคนขับแล้วหรือยัง"
        actions={canEdit && (
          <Button variant="outline" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
            สร้างเที่ยวเอง
          </Button>
        )}
      />

      {/* คนขับที่ไม่มีบัญชีผู้ใช้ = จ่ายงานสำเร็จแต่ไม่มีใครเห็น ระบบเคยเงียบสนิทเรื่องนี้
          จึงพังโดยไม่มีใครรู้ว่าพัง — ต้องขึ้นบนสุด ไม่ใช่ซ่อนในหน้าพนักงานขับ */}
      {noAccount.length > 0 && (
        <div className="tms-stale" role="status" style={{ marginBottom: 16 }}>
          <b>{noAccount.length} เที่ยว</b> จ่ายให้คนขับที่ยังไม่มีบัญชีผู้ใช้ —
          เขาเปิดแอปดูงานไม่ได้ ต้องผูกบัญชีที่หน้าพนักงานขับก่อน
          <div className="text-xs" style={{ marginTop: 4 }}>
            {[...new Set(noAccount.map((t) => t.driver_name))].join(', ')}
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={4} cols={4} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
          <div>
            <h2 style={{ fontSize: 17, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <IconRoute size={18} style={{ color: 'var(--info)' }} />
              รอคนขับรับงาน
              <Badge label={fmtNum(waiting.length)} tone="planned" />
            </h2>
            {waiting.length === 0 && (
              <div className="card">
                <EmptyState title="ทุกเที่ยวถึงมือคนขับแล้ว" desc="งานใหม่จาก TMS จะมารออยู่ตรงนี้" />
              </div>
            )}
            {waiting.map((t) => (
              <TripCard
                key={t.id}
                trip={t}
                busy={busyId === t.id}
                canEdit={canEdit}
                /* คนวางแผนกดรับแทนได้เมื่อโทรคุยกันแล้ว — คนขับที่ไม่มีบัญชี
                   หรือไม่ได้เปิดแอป ไม่ควรทำให้งานทั้งเที่ยวค้างอยู่ตรงนี้ */
                onAccept={() => void act(t.id, () => acceptTrip(t.id), `รับงานแทนคนขับใน ${tripNo(t)} แล้ว`)}
                onAddOrders={() => { setAddTo(t); setAddSelected(new Set()) }}
                onCancel={() => setCancelling(t)}
                onClearIssue={() => void act(t.id, () => clearTripIssue(t.id), 'เคลียร์ปัญหาแล้ว')}
                onRemoveOrder={(orderId) => void act(t.id, () => removeOrderFromTrip(t.id, orderId), 'ถอนออเดอร์ออกจากเที่ยวแล้ว')}
              />
            ))}
          </div>

          <div>
            <h2 style={{ fontSize: 17, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <IconTruck size={18} style={{ color: 'var(--warning)' }} />
              คนขับรับแล้ว
              <Badge label={fmtNum(running.length)} tone="in_progress" dot />
            </h2>
            {running.length === 0 && (
              <div className="card">
                <EmptyState title="ยังไม่มีใครรับงาน" desc="เที่ยวที่คนขับกดรับจะย้ายมาที่นี่" />
              </div>
            )}
            {running.map((t) => (
              <TripCard
                key={t.id}
                trip={t}
                busy={busyId === t.id}
                canEdit={canEdit}
                onStart={t.status === 'planned'
                  ? () => void act(t.id, () => startTrip(t.id), `เริ่มเที่ยว ${tripNo(t)} — สถานะออเดอร์เป็นกำลังขนส่ง`)
                  : undefined}
                onComplete={t.status === 'in_progress'
                  ? () => void act(t.id, () => completeTrip(t.id), `เที่ยว ${tripNo(t)} เสร็จสิ้น — ออเดอร์เป็นส่งสำเร็จ`)
                  : undefined}
                onCancel={() => setCancelling(t)}
                onClearIssue={() => void act(t.id, () => clearTripIssue(t.id), 'เคลียร์ปัญหาแล้ว')}
              />
            ))}
          </div>

          {done.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              <h2 style={{ fontSize: 17, margin: '10px 0 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <IconCheck size={18} style={{ color: 'var(--success)' }} />
                จบวันนี้
                <Badge label={fmtNum(done.length)} tone="success" />
              </h2>
              {/* จบแล้วไม่ต้องการปุ่มอะไร มีไว้ให้เห็นว่าวันนี้ทำอะไรไปบ้าง
                  ประวัติเต็มอยู่ที่หน้าออเดอร์ กระดานนี้เป็นของวันนี้ */}
              {done.map((t) => (
                <TripCard key={t.id} trip={t} busy={false} canEdit={false} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* งานนอก TMS — ไม่ใช่ทางหลักอีกต่อไป จึงอยู่ในหน้าต่าง ไม่ใช่กินครึ่งจอ
          เที่ยวที่สร้างจากตรงนี้ถือว่าคนวางแผนคุยกับคนขับแล้ว จึงข้ามประตูรับงาน
          (create_trip ไม่ได้ตั้ง accepted_at ให้ ต้องกด "รับงานแทน" บนการ์ดอีกที
          ซึ่งตั้งใจ — คนวางแผนควรยืนยันว่าคุยแล้วจริง ไม่ใช่ระบบเดาให้) */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="สร้างเที่ยวเอง"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>ยกเลิก</Button>
            <Button variant="accent" loading={creating} onClick={() => void submitCreate()}>
              สร้างเที่ยวขนส่ง
            </Button>
          </>
        }
      >
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

        <Field label={`ออเดอร์รอจัดคิว — เลือกแล้ว ${fmtNum(selected.size)} ใบ`} required>
          <SearchInput value={q} onChange={setQ} placeholder="ค้นหาเลขที่ / ปลายทาง..." />
        </Field>
        <div style={{ display: 'grid', gap: 6, maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
          {filteredPending.map((o) => (
            <label
              key={o.id}
              style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', cursor: 'pointer', background: selected.has(o.id) ? 'var(--accent-050)' : 'var(--surface)' }}
            >
              <input
                type="checkbox"
                checked={selected.has(o.id)}
                onChange={() => toggle(selected, setSelected, o.id)}
                style={{ accentColor: 'var(--accent)' }}
              />
              <div style={{ flex: 1 }}>
                <div className="text-sm text-strong">{o.tms_pl_no ?? o.order_no}</div>
                <div className="text-xs text-muted">
                  {o.origin} → {o.destination} · {fmtWeight(o.weight_kg)} · {fmtDate(o.scheduled_at)}
                </div>
              </div>
              {o.priority === 'urgent' && <Badge label={PRIORITY_LABEL.urgent} tone="urgent" dot />}
            </label>
          ))}
          {filteredPending.length === 0 && (
            <EmptyState
              icon={<IconBox size={30} />}
              title={q ? 'ไม่พบออเดอร์ที่ค้นหา' : 'ไม่มีออเดอร์รอจัดคิว'}
              desc={q ? '' : 'งานจาก TMS เข้ามาพร้อมเที่ยวอยู่แล้ว ช่องนี้จะมีของก็ต่อเมื่อสร้างออเดอร์เองที่หน้าออเดอร์'}
            />
          )}
        </div>

        {selectedVehicle && (
          <>
            <div className="capacity-bar" style={{ marginTop: 12 }}>
              <div className={`fill ${capacityClass}`} style={{ width: `${Math.min(100, capacityPct)}%` }} />
            </div>
            <div className="text-xs text-muted" style={{ marginTop: 5 }}>
              น้ำหนักรวม {fmtWeight(selectedWeight)} / ความจุ {fmtWeight(selectedVehicle.capacity_kg)}
              {capacityPct > 100 && <b className="text-danger"> · เกินความจุ!</b>}
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={addTo !== null}
        onClose={() => setAddTo(null)}
        title={addTo ? `เพิ่มใบส่งของใน ${tripNo(addTo)}` : ''}
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
                <div className="text-sm text-strong" style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{billNo(o)}</div>
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
        message={cancelling ? <>ต้องการยกเลิกเที่ยว <b>{tripNo(cancelling)}</b> ({cancelling.vehicle_plate} · {cancelling.driver_name}) ใช่หรือไม่? ออเดอร์ในเที่ยวจะกลับเป็น <b>รอจัดคิว</b> และรถ/คนขับจะว่างทันที</> : ''}
        confirmLabel="ยกเลิกเที่ยว"
        danger
        loading={busyId !== null}
        onConfirm={() => {
          const t = cancelling
          setCancelling(null)
          if (t) void act(t.id, () => cancelTrip(t.id), `ยกเลิกเที่ยว ${tripNo(t)} แล้ว — รถ/คนขับกลับว่าง`)
        }}
      />
    </>
  )
}

function TripCard({
  trip, busy, canEdit, onStart, onComplete, onCancel, onAccept, onClearIssue,
  onAddOrders, onRemoveOrder,
}: {
  trip: BoardTrip
  busy: boolean
  canEdit: boolean
  onStart?: () => void
  onComplete?: () => void
  /* การ์ดในช่อง "จบวันนี้" เป็นของอ่านอย่างเดียว ทุกปุ่มจึงไม่บังคับ */
  onCancel?: () => void
  onAccept?: () => void
  onClearIssue?: () => void
  onAddOrders?: () => void
  onRemoveOrder?: (orderId: number) => void
}): React.JSX.Element {
  const pct = trip.vehicle_capacity > 0 ? (trip.total_weight / trip.vehicle_capacity) * 100 : 0
  const capClass = pct > 100 ? 'over' : pct > 90 ? 'warn' : ''
  /* จำนวนร้าน ไม่ใช่รายชื่อร้าน — ลำดับการแวะเป็นของคนขับ เขาจัดเองหน้างานอยู่แล้ว
     รายชื่อปลายทางแบบเต็มยาวเป็นย่อหน้าจึงเป็นข้อความที่ไม่มีใครอ่านและไม่มีใครใช้ */
  const stores = byStore(trip.orders)
  const [openStops, setOpenStops] = useState(false)

  return (
    <div className="trip-card">
      <div className="trip-head">
        <span className="trip-no">{tripNo(trip)}</span>
        <Badge label={TRIP_STATUS_LABEL[trip.status]} tone={TRIP_TONE[trip.status]} dot={trip.status === 'in_progress'} />
        <div className="spacer" style={{ flex: 1 }} />
        {canEdit && onAccept && (
          /* คนวางแผนกดรับแทนได้ ไม่ใช่ทางลัดปกติ — มีไว้สำหรับคนขับที่ยังไม่มีบัญชี
             หรือโทรยืนยันกันทางโทรศัพท์แล้ว ไม่งั้นงานจะค้างในช่องรอตลอด */
          <Button variant="accent" size="sm" onClick={onAccept} loading={busy}>
            <IconCheck size={14} /> รับงานแทน
          </Button>
        )}
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
        {canEdit && onCancel && (
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
        {/* ค่าจ้างขนส่งของเที่ยว มาจาก TMS — เที่ยวที่สร้างเองในระบบยังไม่มีตัวเลขนี้
            จึงไม่แสดงช่องเปล่า แทนที่จะขึ้น ฿0 ซึ่งอ่านผิดเป็นงานฟรี */}
        {trip.freight_cost !== null && (
          <span>ค่าขนส่ง <b>{fmtMoney(trip.freight_cost)}</b></span>
        )}
        {trip.accepted_at && <span>คนขับรับงาน <b>{fmtDateTime(trip.accepted_at)}</b></span>}
        {/* เที่ยวที่ไปหลายคน "รับแล้ว" ของคนแรกไม่ได้แปลว่าคนครบ — คำถามคือคนครบหรือยัง */}
        {trip.crew_size > 1 && (
          <span style={trip.crew_accepted < trip.crew_size ? { color: 'var(--danger)' } : undefined}>
            รับงานแล้ว <b>{trip.crew_accepted}/{trip.crew_size}</b> คน
          </span>
        )}
        {trip.status === 'in_progress' && trip.departed_at && <span>ออกเดินทาง <b>{fmtDateTime(trip.departed_at)}</b></span>}
      </div>

      {/* ปัญหาที่คนขับแจ้งต้องเด่นกว่าทุกอย่างในการ์ด — เป็นเรื่องเดียวที่ต้องทำอะไรต่อ */}
      {trip.issue_note && (
        <div className="tms-stale" role="status" style={{ margin: '8px 0' }}>
          <b>คนขับแจ้งปัญหา:</b> {trip.issue_note}
          <span className="text-xs text-muted"> · {fmtDateTime(trip.issue_at)}</span>
          {canEdit && onClearIssue && (
            <Button variant="ghost" size="sm" onClick={onClearIssue} disabled={busy}>
              เคลียร์
            </Button>
          )}
        </div>
      )}

      {!trip.driver_has_account && trip.status !== 'completed' && (
        <div className="text-xs text-danger" style={{ marginTop: 4 }}>
          คนขับยังไม่มีบัญชีผู้ใช้ — เปิดแอปดูงานนี้ไม่ได้
        </div>
      )}

      {/* TMS ไม่ได้ส่งน้ำหนักรายใบมา เที่ยวจาก TMS จึงรวมได้ 0 เสมอ
          แถบที่ขึ้น "ใช้อัตราความจุ 0%" ทุกใบไม่ได้บอกอะไร นอกจากทำให้คนเลิกอ่านแถบนี้
          ตอนที่มันมีความหมายจริง (เที่ยวที่สร้างเองซึ่งกรอกน้ำหนักไว้) */}
      {trip.total_weight > 0 && (
        <>
          <div className="capacity-bar">
            <div className={`fill ${capClass}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 5 }}>
            ใช้อัตราความจุ {Math.round(pct)}% {pct > 100 && <b className="text-danger">· เกินความจุ!</b>}
          </div>
        </>
      )}

      {/* รายละเอียดจุดส่งหุบไว้ — คำถามของหน้านี้คือ "งานถึงมือคนขับแล้วหรือยัง"
          ไม่ใช่ "ใบไหนไปร้านไหน" ซึ่งเป็นเรื่องของคนขับกับหน้าออเดอร์ */}
      <button type="button" className="trip-stops-toggle" aria-expanded={openStops}
        onClick={() => setOpenStops((v) => !v)}>
        <span className={`store-caret${openStops ? ' is-open' : ''}`} aria-hidden="true">›</span>
        {stores.length} ร้าน · {trip.orders.length} ใบ
      </button>

      {openStops && (
      <div className="trip-orders">
        {/* จัดกลุ่มตามปลายทาง — ร้านเดียวสั่งหลายใบเป็นเรื่องปกติ เรียงเป็นใบล้วน
            แล้วชื่อปลายทางซ้ำติดกันจนอ่านไม่ออกว่าเที่ยวนี้แวะกี่จุดจริง */}
        {stores.map((store) => (
          <Fragment key={store.key}>
            {store.rows.length > 1 && (
              <div className="trip-order-store">
                {/* ที่อยู่เต็มยาวเกินกว่าจะเป็นหัวข้อ — ตัดที่คั่นแรก เหลือชื่อร้าน */}
                {((store.rows[0] as OrderRow).destination.split('·')[0] ?? '').trim()}
                <span className="text-xs text-muted"> · {store.rows.length} ใบ</span>
              </div>
            )}
            {store.rows.map((o) => (
              <div key={o.id} className="trip-order-row">
                <span className="text-strong" style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{billNo(o)}</span>
                <span className="text-xs text-muted">
                  {store.rows.length > 1 ? o.origin : `${o.origin} → ${o.destination}`}
                </span>
                {o.priority === 'urgent' && <Badge label="ด่วน" tone="urgent" />}
                <span className="grow" />
                <span className="text-xs text-muted">{fmtWeight(o.weight_kg)}</span>
                <Badge label={ORDER_STATUS_LABEL[o.status]} tone={ORDER_TONE[o.status]} />
                {canEdit && trip.status === 'planned' && onRemoveOrder && (
                  <Button variant="ghost" size="sm" title="ถอนใบนี้ออกจากเที่ยว" onClick={() => onRemoveOrder(o.id)}>
                    <IconX size={13} />
                  </Button>
                )}
              </div>
            ))}
          </Fragment>
        ))}
        {canEdit && trip.status === 'planned' && onAddOrders && (
          <Button variant="ghost" size="sm" onClick={onAddOrders} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
            <IconPlus size={13} /> เพิ่มออเดอร์ในเที่ยวนี้
          </Button>
        )}
      </div>
      )}
    </div>
  )
}
