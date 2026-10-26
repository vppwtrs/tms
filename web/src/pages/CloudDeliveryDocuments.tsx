import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ALLOWED_WAREHOUSES, listWarehouses, scanTripsForPreDispatch, type PreDispatchTmsTrip } from '../api/tmsPull'
import { Badge, Button, EmptyState, ErrorBox, Input, PageHeader, Select, TableSkeleton } from '../components/ui'
import { IconPrinter } from '../components/icons'
import { useToast } from '../context/ToastContext'
import { fmtDate, todayIso } from '../utils/format'
import { groupPreDispatchShipTos, preDispatchShipToHtml, preDispatchTripHtml, type PreDispatchShipTo, printPreDispatchHtml } from '../utils/preDispatchDocument'

const logoUrl = (): string => new URL(`${import.meta.env.BASE_URL}vppw-mark.png`, window.location.href).href

export default function CloudDeliveryDocuments(): React.JSX.Element {
  const { push } = useToast()
  const today = todayIso().slice(0, 10)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [trips, setTrips] = useState<PreDispatchTmsTrip[]>([])
  const [warehouses, setWarehouses] = useState<Awaited<ReturnType<typeof listWarehouses>>>([])
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const availableWarehouses = (await listWarehouses()).filter((warehouse) => ALLOWED_WAREHOUSES.includes(warehouse.code))
      setWarehouses(availableWarehouses)
      const scans = await Promise.all(availableWarehouses.map((warehouse) => scanTripsForPreDispatch({ from, to, warehouse })))
      setTrips(scans.flat().sort((a, b) => b.orderDate.localeCompare(a.orderDate) || a.tripNo.localeCompare(b.tripNo)))
      setExpanded(new Set())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'โหลดเที่ยวจาก TMS ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timer)
  }, [load])

  const visibleTrips = useMemo(
    () => trips.filter((trip) => !warehouseFilter || trip.warehouse === warehouseFilter),
    [trips, warehouseFilter],
  )
  const totalStops = useMemo(() => visibleTrips.reduce((sum, trip) => sum + groupPreDispatchShipTos(trip).length, 0), [visibleTrips])

  const print = (html: string): void => {
    if (!printPreDispatchHtml(html)) push('error', 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาตป๊อปอัปของเว็บนี้ก่อน')
  }

  const toggle = (tripId: string): void => setExpanded((previous) => {
    const next = new Set(previous)
    if (next.has(tripId)) next.delete(tripId)
    else next.add(tripId)
    return next
  })

  return (
    <>
      <PageHeader title="พิมพ์ใบส่งสินค้า" subtitle="เอกสารเตรียมจัดส่งจากข้อมูล TMS ล่าสุด · ก่อนรถออกจากคลัง" />
      <div className="card">
        <div className="lbl-filter">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={{ width: 160 }} title="ตั้งแต่วันที่" />
          <span className="text-muted">ถึง</span>
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} style={{ width: 160 }} title="ถึงวันที่" />
          {warehouses.length > 1 && <>
            <span className="text-muted">คลัง</span>
            <Select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} aria-label="กรองตามคลัง">
              <option value="">ทุกคลัง ({trips.length})</option>
              {warehouses.map((warehouse) => {
                const count = trips.filter((trip) => trip.warehouse === warehouse.code).length
                const label = warehouse.description ? `${warehouse.code} · ${warehouse.description}` : warehouse.code
                return <option key={warehouse.code} value={warehouse.code}>{label} ({count})</option>
              })}
            </Select>
          </>}
          <span className="text-muted" style={{ flex: 1 }}>แสดงเฉพาะสถานะ Confirm และ Handling</span>
          <Button variant="outline" size="sm" onClick={() => void load()} loading={loading}>โหลดใหม่</Button>
        </div>
        {error ? <ErrorBox message={error} onRetry={() => void load()} /> : loading ? <TableSkeleton rows={5} cols={6} /> : visibleTrips.length === 0 ? (
          <EmptyState icon={<IconPrinter size={28} />} title="ไม่มีเที่ยวก่อนออกจากคลังในช่วงนี้" desc={warehouseFilter ? 'ลองเลือกทุกคลังหรือเปลี่ยนช่วงวันที่' : 'ลองเปลี่ยนช่วงวันที่ หรือตรวจสอบการเชื่อมต่อบัญชี TMS'} />
        ) : (
          <>
            <div className="text-muted" style={{ margin: '4px 0 12px' }}>{visibleTrips.length} เที่ยว · {totalStops} Ship To · อ่านสดจาก TMS</div>
            <div className="table-wrap">
              <table className="table ops-table">
                <thead><tr><th>เลข Trip</th><th>วันที่</th><th>คลัง</th><th>ขนส่ง / รถ</th><th>Ship To</th><th>สถานะ</th><th className="text-right">พิมพ์</th></tr></thead>
                <tbody>{visibleTrips.map((trip) => {
                  const shipTos = groupPreDispatchShipTos(trip)
                  const isExpanded = expanded.has(trip.id)
                  return <Fragment key={trip.id}>
                    <tr key={trip.id} className="is-clickable" onClick={() => toggle(trip.id)}>
                      <td className="text-strong">{trip.tripNo || '—'}</td>
                      <td>{fmtDate(trip.orderDate)}</td><td>{trip.warehouse}</td>
                      <td>{[trip.carrierName, trip.licensePlate, trip.vehicleTypeName].filter(Boolean).join(' · ') || '—'}</td>
                      <td>{shipTos.length} จุด · {trip.rows.length} รายการ</td>
                      <td><Badge label={trip.status} tone={trip.statusId === 2 ? 'pending' : 'neutral'} /></td>
                      <td className="text-right" onClick={(event) => event.stopPropagation()}>
                        <Button variant="accent" size="sm" icon={<IconPrinter size={14} />} onClick={() => print(preDispatchTripHtml(trip, logoUrl()))}>พิมพ์ทั้ง Trip</Button>
                      </td>
                    </tr>
                    {isExpanded && shipTos.map((shipTo: PreDispatchShipTo) => <tr key={`${trip.id}-${shipTo.key}`}>
                      <td colSpan={4} style={{ paddingLeft: 28 }}><b>{shipTo.name}</b><div className="text-xs text-muted">{[shipTo.address, shipTo.province, shipTo.postCode].filter(Boolean).join(' ') || '—'}</div></td>
                      <td colSpan={2}>{new Set(shipTo.rows.map((row) => row.pickingListNo)).size} ใบ · {shipTo.rows.length} รายการ</td>
                      <td className="text-right"><Button variant="outline" size="sm" icon={<IconPrinter size={14} />} onClick={() => print(preDispatchShipToHtml(trip, shipTo, logoUrl()))}>พิมพ์ Ship To นี้</Button></td>
                    </tr>)}
                  </Fragment>
                })}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  )
}
