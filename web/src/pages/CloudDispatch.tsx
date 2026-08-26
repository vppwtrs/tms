import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getTripBoardDetailed, createTrip, addOrdersToTrip, removeOrderFromTrip, cancelStopOrders,
  startTrip, completeTrip, closeTripPreview, type TripClosePreview, cancelTrip, acceptTrip, clearTripIssue, forceDeleteTrip, type BoardTrip,
} from '../api/trips'
import { listUnassignedOrders, type DispatchOrderRow } from '../api/orders'
import { useRealtime } from '../hooks/useRealtime'
import { listAvailableVehicles, listAvailableDrivers } from '../api/vehicles'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { DriverRow, OrderRow, VehicleRow } from '../types/database'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Modal, MoreMenu,
  PageHeader, SearchInput, Select, TableSkeleton, Textarea,
} from '../components/ui'
import { useFlipBoard } from '../hooks/useFlipBoard'
import {
  CANCEL_STOP_REASONS,
  ORDER_STATUS_LABEL, ORDER_TONE, PRIORITY_LABEL,
  TRIP_STATUS_LABEL, TRIP_TONE, VEHICLE_TYPE_LABEL,
} from '../utils/constants'
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtWeight } from '../utils/format'
import { storeKey } from '../utils/stops'
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

/** เกินเท่านี้แล้วยังไม่มีใครกดรับ = ต้องโทรตาม ไม่ใช่รอต่อ
 *  สองชั่วโมงมาจากรอบงานจริง: งานเช้าที่ยังไม่ถึงมือตอนสาย แปลว่ารอบบ่ายจะเลื่อนตาม */
const WAIT_ALERT_MIN = 120

/** รออยู่นานแค่ไหนแล้ว — ตัวเลขเดียวที่ตัดสินว่าต้องหยิบโทรศัพท์หรือยัง
 *
 *  กระดานเดิมบอกแค่ว่าเที่ยวอยู่ช่อง "รอคนขับรับงาน" ซึ่งจริงแต่ไม่พอ เพราะเที่ยวที่
 *  เพิ่งจ่ายไปหนึ่งนาทีกับเที่ยวที่ค้างมาตั้งแต่เช้าหน้าตาเหมือนกันเป๊ะ */
export function waitedFor(iso: string): { text: string; late: boolean } {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  const late = mins >= WAIT_ALERT_MIN
  if (mins < 60) return { text: `รอ ${mins} นาที`, late }
  return { text: `รอ ${Math.floor(mins / 60)} ชม. ${mins % 60} นาที`, late }
}

/** รวมใบของร้านเดียวกันเป็นจุดเดียว — กติกาเดียวกับหน้าออเดอร์และจอคนขับ
 *
 *  เคยนับ destination ทั้งสตริง ซึ่งมีชื่อคนรับปนอยู่ ร้านเดียวที่สั่งสามใบโดยระบุ
 *  คนรับคนละคนจึงขึ้นเป็นสามร้านบนกระดาน ขณะที่หน้าออเดอร์ข้าง ๆ กันบอกว่าร้านเดียว
 *  ตอนนี้เรียก storeKey ตัวกลางร่วมกัน จะได้ไม่แยกกันเดินอีก */
function byStore<T extends { customer_id: number | null; destination: string }>(
  rows: T[],
): { key: string; rows: T[] }[] {
  const map = new Map<string, T[]>()
  for (const o of rows) {
    const key = storeKey(o)
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
  /* ยกเลิกทั้งร้านในเที่ยว — เก็บใบที่จะยกเลิกกับชื่อร้านไว้ด้วยกัน
     เพราะกล่องต้องบอกได้ว่ากำลังยกเลิกร้านไหน กี่ใบ ไม่ใช่คำเตือนลอย ๆ */
  const [cancelStore, setCancelStore] = useState<{ tripId: number; ids: number[]; name: string } | null>(null)
  const [storeReason, setStoreReason] = useState('')
  const [storeNote, setStoreNote] = useState('')
  /* ปิดเที่ยวจากออฟฟิศเปลี่ยนใบที่ยังไม่ถึงมือลูกค้าให้เป็น "ส่งสำเร็จ" ทันที
     จึงต้องถามก่อน และต้องถามด้วยตัวเลขจริงของเที่ยวนั้น ไม่ใช่คำเตือนลอย ๆ */
  const [closing, setClosing] = useState<{ trip: BoardTrip; preview: TripClosePreview } | null>(null)
  /* ลบถาวร — ของเก็บกวาดข้อมูลทดสอบและข้อมูลที่เสีย ไม่ใช่ทางทำงานปกติ
     จึงเห็นเฉพาะผู้ดูแลระบบ และมีกล่องยืนยันของตัวเองที่บอกว่าอะไรจะหายไปบ้าง
     ลบถึงข้อมูลดิบจาก TMS ด้วย — เก็บซากไว้แล้วมันจะโผล่กลับมาให้กดนำเข้าซ้ำ
     จากข้อมูลชุดเดิมที่มีปัญหาอยู่แล้ว ซึ่งไม่ใช่สิ่งที่คนกดปุ่มนี้ต้องการ */
  const [purging, setPurging] = useState<BoardTrip | null>(null)
  const canPurge = can('users.manage')
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

  /* ถามฐานก่อนว่าการกดครั้งนี้จะกินอะไรบ้าง แล้วค่อยขึ้นกล่องยืนยัน
     ถ้าถามไม่สำเร็จก็ยังให้ปิดได้ แต่ขึ้นกล่องแบบไม่มีตัวเลข ดีกว่าปิดทางออกฉุกเฉินทิ้ง */
  const askClose = async (t: BoardTrip): Promise<void> => {
    try {
      setClosing({ trip: t, preview: await closeTripPreview(t.id) })
    } catch {
      setClosing({ trip: t, preview: { trip_no: null, open_orders: 0, without_pod: 0 } })
    }
  }

  useEffect(() => { void loadAll() }, [loadAll])

  /* เวลาที่รออยู่ต้องเดินเอง ไม่ใช่ค้างที่ค่าตอนโหลด — คนเปิดหน้านี้ค้างไว้ทั้งวัน
     ถ้าตัวเลขไม่ขยับ มันจะโกหกมากขึ้นเรื่อย ๆ ทุกนาทีที่ผ่านไป
     นับเป็นนาทีอยู่แล้ว เดินนาทีละครั้งก็พอ ไม่ต้องถี่กว่านั้น */
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  /* การ์ดที่ย้ายช่องต้องเลื่อนไป ไม่ใช่หายแล้วโผล่ — ดู hooks/useFlipBoard */
  const boardRef = useRef<HTMLDivElement>(null)
  useFlipBoard(boardRef, board)

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
        /* คำถามที่ถูกถามก่อนทุกครั้งที่จะจ่ายงานคือ "ยังมีรถว่างไหม" คำตอบเคยอยู่
           ท้ายกระดาน ซึ่งบนจอแคบต้องเลื่อนลงไปหา ตัวเลขสองตัวนี้เบาพอที่จะอยู่บนหัว
           ได้ตลอด ส่วนรายชื่อว่ามีคันไหนบ้างยังอยู่ที่แผงเดิม
           อยู่ในช่องข้อมูล ไม่ใช่ช่องปุ่ม — ปุ่มหลักต้องอยู่ขวาสุดเสมอตามกติกาของหัวหน้า */
        filters={
          <>
            <span className="ops-res-chip" title="รถที่ยังไม่ถูกจองในเที่ยวไหน">
              <IconTruck size={14} /> รถว่าง <b>{fmtNum(vehicles.length)}</b>
            </span>
            <span className="ops-res-chip" title="คนขับที่ยังไม่ถูกจองในเที่ยวไหน">
              <IconUsers size={14} /> คนขับว่าง <b>{fmtNum(drivers.length)}</b>
            </span>
          </>
        }
        actions={canEdit && (
          /* ล้างของที่เลือกค้างไว้ก่อนเปิด — ปุ่มบนการ์ด "รอจัดคิว" เลือกใบให้ล่วงหน้า
             ถ้าคนกดปุ่มนั้นแล้วปิดหน้าต่างไป แล้วมาเปิดจากตรงนี้ ใบเดิมจะยังติดมาด้วย
             ซึ่งอ่านไม่ออกว่ามาจากไหน และเป็นทางที่สร้างเที่ยวผิดใบได้จริง */
          <Button
            variant="outline"
            icon={<IconPlus size={16} />}
            onClick={() => { setSelected(new Set()); setCreateOpen(true) }}
          >
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
        <div className={`ops-board${pendingOrders.length > 0 ? ' has-queue' : ''}`} ref={boardRef}>
          {/* ออเดอร์ที่ยังไม่เข้าเที่ยว — ช่องนี้โผล่เฉพาะตอนมีของจริง
              งานเกือบทั้งหมดมาจาก TMS พร้อมรถและคนขับแล้ว ช่องนี้จึงว่างเป็นปกติ
              และช่องว่างที่กินพื้นที่ถาวรคือเหตุผลที่มันเคยถูกย้ายเข้าหน้าต่างไป
              แต่ตอนที่มีของ มันเคยมองไม่เห็นเลยจนกว่าจะเปิดหน้าต่างสร้างเที่ยว
              ซึ่งแปลว่าไม่มีใครรู้ว่ามีใบค้างอยู่ */}
          {pendingOrders.length > 0 && (
            <div className="ops-lane" data-lane="queue">
              <h2 className="ops-col-title">
                <IconBox size={18} />
                รอจัดคิว
                <Badge label={fmtNum(pendingOrders.length)} tone="pending" />
              </h2>
              {byStore(pendingOrders).map((store) => {
                const first = store.rows[0] as DispatchOrderRow
                const ids = store.rows.map((o) => o.id)
                return (
                  <div key={store.key} className="queue-card" data-flip-id={`queue-${store.key}`}>
                    <div className="queue-card-head">
                      <span className="trip-no">{billNo(first)}</span>
                      {store.rows.length > 1 && (
                        <span className="text-xs text-muted">· {store.rows.length} ใบ</span>
                      )}
                      {store.rows.some((o) => o.priority === 'urgent') && (
                        <Badge label={PRIORITY_LABEL.urgent} tone="urgent" dot />
                      )}
                    </div>
                    <div className="queue-card-meta">
                      {(first.destination.split('·')[0] ?? '').trim()} · กำหนดส่ง {fmtDate(first.scheduled_at)}
                    </div>
                    {canEdit && (
                      <Button
                        variant="accent"
                        size="sm"
                        onClick={() => { setSelected(new Set(ids)); setCreateOpen(true) }}
                      >
                        สร้างเที่ยวขนส่ง
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="ops-lane" data-lane="wait">
            <h2 className="ops-col-title">
              <IconRoute size={18} />
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
                onPurge={canPurge ? () => setPurging(t) : undefined}
                onClearIssue={() => void act(t.id, () => clearTripIssue(t.id), 'เคลียร์ปัญหาแล้ว')}
                onRemoveOrder={(orderId) => void act(t.id, () => removeOrderFromTrip(t.id, orderId), 'ถอนออเดอร์ออกจากเที่ยวแล้ว')}
                onCancelStore={(ids, name) => { setCancelStore({ tripId: t.id, ids, name }); setStoreReason(''); setStoreNote('') }}
              />
            ))}
          </div>

          <div className="ops-lane" data-lane="run">
            <h2 className="ops-col-title">
              <IconTruck size={18} />
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
                onComplete={(t.status === 'in_progress' || t.status === 'returning')
                  ? () => void askClose(t)
                  : undefined}
                onCancel={() => setCancelling(t)}
                onPurge={canPurge ? () => setPurging(t) : undefined}
                onClearIssue={() => void act(t.id, () => clearTripIssue(t.id), 'เคลียร์ปัญหาแล้ว')}
                /* เที่ยวที่กำลังวิ่งคือจังหวะที่ร้านโดนยกเลิกจริง ๆ ปุ่มต้องมีตรงนี้ */
                onCancelStore={(ids, name) => { setCancelStore({ tripId: t.id, ids, name }); setStoreReason(''); setStoreNote('') }}
              />
            ))}
          </div>

          {/* ทรัพยากรที่เหลือ — คำถามที่ถูกถามทุกครั้งก่อนสร้างเที่ยวคือ "ยังมีรถว่างไหม"
              เดิมตอบได้ทางเดียวคือเปิดหน้าต่างสร้างเที่ยวแล้วดูในรายการเลือก
              ข้อมูลชุดนี้โหลดมาอยู่แล้วตั้งแต่แรกสำหรับหน้าต่างนั้น ตรงนี้แค่เอามาแสดง */}
          <aside className="ops-panel">
            <div className="ops-panel-head">
              <h2 className="ops-panel-title"><IconTruck size={16} /> รถว่าง</h2>
              <span className="ops-panel-count">{fmtNum(vehicles.length)}</span>
            </div>
            <div className="ops-panel-body">
              {vehicles.length === 0 ? (
                <div className="ops-res-empty">ไม่มีรถว่างในตอนนี้</div>
              ) : (
                <ul className="ops-res-list">
                  {vehicles.map((v) => (
                    <li key={v.id}>
                      <span className="ops-res-name">{v.plate_no}</span>
                      <span className="ops-res-meta">{VEHICLE_TYPE_LABEL[v.vehicle_type]} · {fmtWeight(v.capacity_kg)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="ops-panel-head" style={{ borderTop: '1px solid var(--panel-border)' }}>
              <h2 className="ops-panel-title"><IconUsers size={16} /> คนขับว่าง</h2>
              <span className="ops-panel-count">{fmtNum(drivers.length)}</span>
            </div>
            <div className="ops-panel-body">
              {drivers.length === 0 ? (
                <div className="ops-res-empty">ไม่มีคนขับว่างในตอนนี้</div>
              ) : (
                <ul className="ops-res-list">
                  {drivers.map((d) => (
                    <li key={d.id}>
                      <span className="ops-res-name">{d.name}</span>
                      {/* คนขับที่ยังไม่มีบัญชี จ่ายงานไปก็เปิดแอปดูไม่ได้ — ต้องเห็นตั้งแต่ตอนเลือก */}
                      <span className="ops-res-meta">{d.user_id ? d.phone ?? '—' : 'ยังไม่มีบัญชีเข้าแอป'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          {done.length > 0 && (
            <div className="ops-lane" data-lane="done" style={{ gridColumn: '1 / -1' }}>
              <h2 className="ops-col-title" style={{ marginTop: 10 }}>
                <IconCheck size={18} />
                จบวันนี้
                <Badge label={fmtNum(done.length)} tone="success" />
              </h2>
              {/* จบแล้วไม่ต้องการปุ่มอะไร มีไว้ให้เห็นว่าวันนี้ทำอะไรไปบ้าง
                  ประวัติเต็มอยู่ที่หน้าออเดอร์ กระดานนี้เป็นของวันนี้ */}
              {done.map((t) => (
                <TripCard
                  key={t.id}
                  trip={t}
                  busy={busyId === t.id}
                  canEdit={false}
                  onPurge={canPurge ? () => setPurging(t) : undefined}
                />
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
                  {o.origin} → {o.destination} · {fmtDate(o.scheduled_at)}
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

        {/* แถบความจุขึ้นเฉพาะตอนที่ใบที่เลือกมีน้ำหนักจริง — ใบจาก TMS ไม่มีน้ำหนักมาให้
            แถบที่เต็ม 0% ทุกครั้งไม่ได้เตือนอะไร มีแต่ทำให้คนเลิกมองมันไปเลย */}
        {selectedVehicle && selectedWeight > 0 && (
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
                <div className="text-xs text-muted">{o.origin} → {o.destination} · {fmtMoney(o.fee)}</div>
              </div>
              {o.priority === 'urgent' && <Badge label="ด่วน" tone="urgent" dot />}
            </label>
          ))}
          {pendingOrders.length === 0 && <EmptyState icon={<IconBox size={30} />} title="ไม่มีออเดอร์รอจัดคิว" />}
        </div>
      </Modal>

      <ConfirmDialog
        open={purging !== null}
        title="ลบเที่ยวนี้ถาวร"
        message={purging ? <>ลบเที่ยว <b>{tripNo(purging)}</b> ออกจากระบบถาวร รวมออเดอร์ทุกใบ <b>หลักฐานการส่งมอบทั้งหมดของเที่ยวนี้</b> และ<b>ข้อมูลดิบจาก TMS ของเที่ยวนี้</b> — กู้คืนไม่ได้ ใช้กับข้อมูลทดสอบหรือข้อมูลที่เสียเท่านั้น งานจริงที่ส่งไปแล้วให้ปิดงานตามจริงแทน ถ้าต้นทางยังมีเที่ยวนี้อยู่ รอบดึงถัดไปจะพากลับมาให้ใหม่</> : ''}
        confirmLabel="ลบถาวร"
        danger
        onClose={() => setPurging(null)}
        onConfirm={() => {
          const t = purging
          setPurging(null)
          if (t) {
            void act(t.id, async () => {
              const r = await forceDeleteTrip(t.id)
              return r
            }, `ลบเที่ยว ${tripNo(t)} ถาวรแล้ว`)
          }
        }}
      />

      <ConfirmDialog
        open={closing !== null}
        onClose={() => setClosing(null)}
        title="ปิดเที่ยวจากฝั่งออฟฟิศ"
        message={closing ? (
          <>
            ปิดเที่ยว <b>{tripNo(closing.trip)}</b> แทนคนขับ — ใบที่ยังไม่ถึงมือลูกค้า{' '}
            <b>{fmtNum(closing.preview.open_orders)} ใบ</b> จะถูกนับเป็น <b>ส่งสำเร็จ</b> ทันที
            {closing.preview.without_pod > 0 && (
              <>
                {' '}และในเที่ยวนี้มี <b>{fmtNum(closing.preview.without_pod)} ใบที่ยังไม่มีหลักฐานการส่ง</b>{' '}
                — ปิดแล้วจะไม่มีใครกลับไปเก็บให้ ระบบจะบันทึกไว้ว่าใครปิดและขาดใบไหนบ้าง
              </>
            )}
          </>
        ) : ''}
        confirmLabel="ปิดเที่ยว"
        danger={closing !== null && closing.preview.without_pod > 0}
        loading={busyId !== null}
        onConfirm={() => {
          const c = closing
          setClosing(null)
          if (c) {
            void act(c.trip.id, () => completeTrip(c.trip.id),
              `เที่ยว ${tripNo(c.trip)} เสร็จสิ้น — ออเดอร์เป็นส่งสำเร็จ`)
          }
        }}
      />

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

      {/* ยกเลิกทั้งร้านในเที่ยว — ใบยังอยู่ในเที่ยว ไม่ได้ถูกลบ ต่างจากปุ่มถอนใบ
          ที่เอาใบออกไปจัดใหม่ อันนั้นตอบว่า "ยังต้องส่ง แต่ไม่ใช่เที่ยวนี้"
          อันนี้ตอบว่า "ไม่ต้องส่งแล้ว" ซึ่งเป็นคนละคำถาม */}
      {cancelStore && (
        <Modal
          open
          onClose={() => setCancelStore(null)}
          title={`ยกเลิกร้าน — ${cancelStore.name}`}
          footer={
            <div className="form-actions">
              <Button variant="ghost" onClick={() => setCancelStore(null)}>ไม่ยกเลิก</Button>
              <Button
                variant="danger"
                disabled={!storeReason || (storeReason === 'อื่น ๆ' && !storeNote.trim())}
                loading={busyId === cancelStore.tripId}
                onClick={() => {
                  const target = cancelStore
                  const reason = storeReason === 'อื่น ๆ'
                    ? storeNote.trim()
                    : storeNote.trim() ? `${storeReason} — ${storeNote.trim()}` : storeReason
                  setCancelStore(null)
                  void act(target.tripId, () => cancelStopOrders(target.ids, reason),
                    `ยกเลิก ${target.name} แล้ว (${target.ids.length} ใบ)`)
                }}
              >
                ยืนยันยกเลิกร้านนี้
              </Button>
            </div>
          }
        >
          <div className="cancel-stop">
            <p className="cancel-stop-lead">
              ยกเลิก <b>{cancelStore.ids.length} ใบ</b> ของร้านนี้ ใบที่ส่งไปแล้วหรือ
              เก็บหลักฐานแล้วไม่ถูกแตะ · ร้านนี้จะไม่นับเป็นงานค้างของเที่ยวอีก
            </p>
            <p className="cancel-stop-note">
              ใบยังอยู่ในเที่ยว อ่านย้อนหลังได้ว่าเคยสั่งแล้วยกเลิกเพราะอะไร
              ถ้าต้องการปล่อยใบดิบกลับไปสั่งใหม่ ให้ลบใบที่หน้าออเดอร์แทน
            </p>

            <div className="cancel-stop-reasons" role="group" aria-label="เหตุผลที่ยกเลิก">
              {[...CANCEL_STOP_REASONS, 'อื่น ๆ'].map((r) => (
                <button
                  key={r}
                  type="button"
                  className="pod-kind"
                  aria-pressed={storeReason === r}
                  onClick={() => setStoreReason(r)}
                >
                  {r}
                </button>
              ))}
            </div>

            <Field label={storeReason === 'อื่น ๆ' ? 'เหตุผลที่ยกเลิก (จำเป็น)' : 'รายละเอียดเพิ่มเติม (ไม่บังคับ)'}>
              <Textarea rows={2} value={storeNote} onChange={(e) => setStoreNote(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}

function TripCard({
  trip, busy, canEdit, onStart, onComplete, onCancel, onPurge, onAccept, onClearIssue,
  onAddOrders, onRemoveOrder, onCancelStore,
}: {
  trip: BoardTrip
  busy: boolean
  canEdit: boolean
  onStart?: () => void
  onComplete?: () => void
  /* การ์ดในช่อง "จบวันนี้" เป็นของอ่านอย่างเดียว ทุกปุ่มจึงไม่บังคับ */
  onCancel?: () => void
  /** ลบถาวร — ส่งมาเฉพาะผู้ดูแลระบบ (ดูเหตุผลที่ต้นทาง) */
  onPurge?: () => void
  onAccept?: () => void
  onClearIssue?: () => void
  onAddOrders?: () => void
  onRemoveOrder?: (orderId: number) => void
  /* ยกเลิกทั้งร้านในเที่ยว — ต่างจากถอนใบออกจากเที่ยว ตรงที่ใบยังอยู่และอ่าน
     ย้อนหลังได้ว่าเคยสั่งไปแล้วแต่ยกเลิกด้วยเหตุผลอะไร */
  onCancelStore?: (orderIds: number[], storeName: string) => void
}): React.JSX.Element {
  const pct = trip.vehicle_capacity > 0 ? (trip.total_weight / trip.vehicle_capacity) * 100 : 0
  const capClass = pct > 100 ? 'over' : pct > 90 ? 'warn' : ''
  /* จำนวนร้าน ไม่ใช่รายชื่อร้าน — ลำดับการแวะเป็นของคนขับ เขาจัดเองหน้างานอยู่แล้ว
     รายชื่อปลายทางแบบเต็มยาวเป็นย่อหน้าจึงเป็นข้อความที่ไม่มีใครอ่านและไม่มีใครใช้ */
  const stores = byStore(trip.orders)
  const [openStops, setOpenStops] = useState(false)

  /* เที่ยวที่ยังไม่มีใครกดรับเท่านั้นที่ "รอ" อยู่จริง เที่ยวที่รับแล้วเวลาที่ผ่านไป
     ไม่ได้แปลว่าอะไร เพราะมันกำลังเดินทางอยู่ ไม่ได้ค้าง */
  const waiting = !trip.accepted_at && trip.status !== 'completed' ? waitedFor(trip.created_at) : null

  return (
    <div className="trip-card" data-flip-id={`trip-${trip.id}`}>
      <div className="trip-head">
        <span className="trip-no">{tripNo(trip)}</span>
        <Badge label={TRIP_STATUS_LABEL[trip.status]} tone={TRIP_TONE[trip.status]} dot={trip.status === 'in_progress'} />
        {waiting && (
          <Badge label={waiting.text} tone={waiting.late ? 'urgent' : 'planned'} />
        )}
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
        {canEdit && (trip.status === 'in_progress' || trip.status === 'returning') && onComplete && (
          <Button variant="success" size="sm" onClick={onComplete} loading={busy}>
            <IconCheck size={14} /> เสร็จสิ้น
          </Button>
        )}
        {/* งานที่ทำแล้วย้อนยากอยู่ในเมนู ไม่ใช่เรียงปนกับปุ่มที่กดทุกชั่วโมง
            ตัวเลือกข้างในยังเขียนเต็มว่าทำอะไร — ปุ่มที่ลบหลักฐานได้ต้องอ่านออกก่อนนิ้วจะไปถึง */}
        <MoreMenu
          items={[
            ...(canEdit && onCancel
              ? [{ label: 'ยกเลิกเที่ยว', onClick: onCancel, danger: true, disabled: busy }]
              : []),
            ...(onPurge
              ? [{ label: 'ลบถาวร', onClick: onPurge, danger: true, disabled: busy }]
              : []),
          ]}
        />
      </div>

      <div className="trip-meta">
        <span>
          <IconTruck size={14} style={{ verticalAlign: -2 }} /> <b>{trip.vehicle_plate}</b>
          {' · '}{VEHICLE_TYPE_LABEL[trip.vehicle_type as keyof typeof VEHICLE_TYPE_LABEL] ?? trip.vehicle_type}
        </span>
        <span><IconUsers size={14} style={{ verticalAlign: -2 }} /> <b>{trip.driver_name}</b></span>
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
            {canEdit && trip.status !== 'completed' && onCancelStore
              && store.rows.some((o) => (o as OrderRow).status !== 'delivered' && (o as OrderRow).status !== 'cancelled') && (
              <div className="trip-order-cancel">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCancelStore(
                    store.rows
                      .filter((o) => (o as OrderRow).status !== 'delivered' && (o as OrderRow).status !== 'cancelled')
                      .map((o) => (o as OrderRow).id),
                    ((store.rows[0] as OrderRow).destination.split('·')[0] ?? '').trim(),
                  )}
                >
                  ยกเลิกร้านนี้
                </Button>
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
