import { useCallback, useEffect, useMemo, useState } from 'react'
import { ALLOWED_WAREHOUSES, listWarehouses, loadTripForReprint, scanTripsForReprint, type PreDispatchTmsTrip, type PreDispatchTripArchiveSummary, type Warehouse } from '../api/tmsPull'
import { Badge, Button, EmptyState, ErrorBox, Input, PageHeader, Select, TableSkeleton } from '../components/ui'
import { IconPrinter } from '../components/icons'
import { DeliveryDocumentModeNav } from '../components/DeliveryDocumentModeNav'
import { useToast } from '../context/ToastContext'
import { fmtDate, todayIso } from '../utils/format'
import { groupPreDispatchShipTos, preDispatchAllShipTosHtml, preDispatchDocumentTypeLabels, preDispatchShipToHtml, preDispatchTripHtml, type PreDispatchShipTo, printPreDispatchHtml } from '../utils/preDispatchDocument'

const logoUrl = (): string => new URL(`${import.meta.env.BASE_URL}vppw-mark.png`, window.location.href).href

function DocumentTypeBadges({ rows }: { rows: PreDispatchTmsTrip['rows'] }): React.JSX.Element {
  const labels = preDispatchDocumentTypeLabels(rows)
  if (labels.length === 0) return <span className="text-muted">ไม่ระบุ</span>
  if (labels.length > 1) return <Badge label="Dealer + Transfer" tone="warning" />
  return <Badge label={labels[0]!} tone={labels[0] === 'Dealer' ? 'success' : 'accent'} />
}

function daysAgoIso(days: number): string {
  const date = new Date(`${todayIso().slice(0, 10)}T00:00:00`)
  date.setDate(date.getDate() - days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function CloudDeliveryDocumentsArchive(): React.JSX.Element {
  const { push } = useToast()
  const [from, setFrom] = useState(() => daysAgoIso(30))
  const [to, setTo] = useState(() => todayIso().slice(0, 10))
  const [tripQuery, setTripQuery] = useState('')
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [trips, setTrips] = useState<PreDispatchTripArchiveSummary[]>([])
  const [incompleteWarehouses, setIncompleteWarehouses] = useState<string[]>([])
  const [selectedTrip, setSelectedTrip] = useState<PreDispatchTmsTrip | null>(null)
  const [retryTrip, setRetryTrip] = useState<PreDispatchTripArchiveSummary | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [loadingWarehouses, setLoadingWarehouses] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loadingTripId, setLoadingTripId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void listWarehouses().then((items) => {
      if (active) setWarehouses(items.filter((warehouse) => ALLOWED_WAREHOUSES.includes(warehouse.code)))
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'โหลดรายชื่อคลังจาก TMS ไม่สำเร็จ')
    }).finally(() => {
      if (active) setLoadingWarehouses(false)
    })
    return () => { active = false }
  }, [])

  const search = useCallback(async (): Promise<void> => {
    if (!from || !to || from > to) {
      setError('กรุณาเลือกช่วงวันที่ให้ถูกต้อง')
      return
    }
    const targets = warehouseFilter
      ? warehouses.filter((warehouse) => warehouse.code === warehouseFilter)
      : warehouses
    if (targets.length === 0) {
      setError('ไม่พบคลังที่ได้รับอนุญาตให้ค้นหา')
      return
    }
    setLoading(true)
    setError('')
    setSelectedTrip(null)
    setRetryTrip(null)
    setTrips([])
    setIncompleteWarehouses([])
    setHasSearched(true)
    try {
      const results = await Promise.all(targets.map((warehouse) => scanTripsForReprint({ from, to, warehouse, maxPages: 60 })))
      setTrips(results.flatMap((result) => result.trips).sort((a, b) => b.orderDate.localeCompare(a.orderDate) || a.tripNo.localeCompare(b.tripNo)))
      setIncompleteWarehouses(targets.filter((_, index) => !results[index]?.complete).map((warehouse) => warehouse.code))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ค้นหา Trip จาก TMS ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [from, to, warehouseFilter, warehouses])

  const visibleTrips = useMemo(() => {
    const query = tripQuery.trim().toLocaleLowerCase()
    return trips.filter((trip) => !query || trip.tripNo.toLocaleLowerCase().includes(query))
  }, [tripQuery, trips])

  const selectTrip = async (summary: PreDispatchTripArchiveSummary): Promise<void> => {
    setLoadingTripId(summary.id)
    setSelectedTrip(null)
    setRetryTrip(summary)
    setError('')
    try {
      const rows = await loadTripForReprint(summary.id)
      if (rows.length === 0) {
        setError(`Trip ${summary.tripNo} ไม่มีรายละเอียด Shipment ที่อ่านได้จาก TMS จึงยังพิมพ์ไม่ได้`)
        return
      }
      setSelectedTrip({
        id: summary.id,
        tripNo: summary.tripNo,
        orderDate: summary.orderDate,
        statusId: summary.statusId,
        status: summary.status,
        carrierName: summary.carrierName,
        warehouse: summary.warehouse,
        area: summary.area,
        driver: summary.driver,
        licensePlate: summary.licensePlate,
        vehicleTypeName: summary.vehicleTypeName,
        rows,
      })
      setRetryTrip(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `อ่านรายละเอียด Trip ${summary.tripNo} จาก TMS ไม่สำเร็จ`)
    } finally {
      setLoadingTripId('')
    }
  }

  const print = (html: string): void => {
    if (!printPreDispatchHtml(html)) push('error', 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาตป๊อปอัปของเว็บนี้ก่อน')
  }

  const selectedShipTos = selectedTrip ? groupPreDispatchShipTos(selectedTrip) : []

  return (
    <>
      <PageHeader title="พิมพ์ใบส่งสินค้า (ย้อนหลัง)" subtitle="ค้น Trip ที่ Confirm แล้วขึ้นไป · อ่านข้อมูลปัจจุบันจาก TMS · ไม่เปลี่ยนสถานะ Trip" />
      <DeliveryDocumentModeNav />
      <div className="card">
        <div className="lbl-filter">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={{ width: 160 }} title="ตั้งแต่วันที่" />
          <span className="text-muted">ถึง</span>
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} style={{ width: 160 }} title="ถึงวันที่" />
          <Select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} aria-label="กรองคลัง">
            <option value="">ทุกคลัง</option>
            {warehouses.map((warehouse) => <option key={warehouse.code} value={warehouse.code}>{warehouse.code}{warehouse.description ? ` · ${warehouse.description}` : ''}</option>)}
          </Select>
          <Input value={tripQuery} onChange={(event) => setTripQuery(event.target.value)} placeholder="ค้นหาเลข Trip" aria-label="ค้นหาเลข Trip" style={{ width: 170 }} />
          <Button variant="accent" size="sm" icon={<IconPrinter size={14} />} onClick={() => void search()} loading={loading} disabled={loadingWarehouses || warehouses.length === 0 || Boolean(loadingTripId)}>ค้นหา Trip</Button>
        </div>

        <div className="text-xs text-muted" style={{ margin: '0 0 12px' }}>
          เลือก Trip เพื่อโหลดรายการ Shipment แล้วจึงพิมพ์ · ค้นได้สูงสุด 60 หน้าต่อคลัง หากยังไม่พบ Trip เก่าให้ลดช่วงวันที่
        </div>

        {error && <ErrorBox message={error} onRetry={() => void (retryTrip ? selectTrip(retryTrip) : search())} />}
        {incompleteWarehouses.length > 0 && <div role="status" className="text-xs" style={{ margin: '8px 0 12px', color: 'var(--warning, #b7791f)' }}>
          ค้นได้ไม่ครบ 60 หน้าของคลัง {incompleteWarehouses.join(', ')} — ปรับช่วงวันที่ให้แคบลงแล้วค้นหาใหม่เพื่อให้แน่ใจว่าเจอ Trip ครบ
        </div>}

        {loading || loadingWarehouses ? <TableSkeleton rows={4} cols={6} /> : trips.length === 0 ? (
          <EmptyState icon={<IconPrinter size={28} />} title={hasSearched ? 'ไม่พบ Trip ในช่วงนี้' : 'ค้นหา Trip ย้อนหลัง'} desc={hasSearched ? 'ลองขยายช่วงวันที่ เปลี่ยนคลัง หรือตรวจว่า Trip ยังอยู่ใน TMS' : 'เลือกช่วงวันที่และคลัง แล้วกดค้นหา Trip — แสดงสถานะ Confirm, Handling, OnDelivery และ Completed'} />
        ) : visibleTrips.length === 0 ? (
          <EmptyState icon={<IconPrinter size={28} />} title="ไม่พบเลข Trip ที่ค้นหา" desc="ลองตรวจเลข Trip หรือขยายช่วงวันที่แล้วค้นหาใหม่" />
        ) : (
          <>
            <div className="text-muted" style={{ margin: '4px 0 12px' }}>{visibleTrips.length} Trip · อ่านข้อมูล Trip จาก TMS ล่าสุด</div>
            <div className="table-wrap">
              <table className="table ops-table">
                <thead><tr><th>เลข Trip</th><th>วันที่</th><th>คลัง</th><th>ขนส่ง / รถ</th><th>สถานะ</th><th className="text-right">รายการ</th></tr></thead>
                <tbody>{visibleTrips.map((trip) => <tr key={trip.id}>
                  <td className="text-strong">{trip.tripNo || '—'}</td>
                  <td>{fmtDate(trip.orderDate)}</td>
                  <td>{trip.warehouse}</td>
                  <td>{[trip.carrierName, trip.licensePlate, trip.vehicleTypeName].filter(Boolean).join(' · ') || '—'}</td>
                  <td><Badge label={trip.status} tone={trip.statusId === 2 ? 'pending' : 'neutral'} /></td>
                  <td className="text-right"><Button variant={selectedTrip?.id === trip.id ? 'success' : 'outline'} size="sm" onClick={() => void selectTrip(trip)} loading={loadingTripId === trip.id} disabled={Boolean(loadingTripId)}>
                    {selectedTrip?.id === trip.id ? 'โหลดแล้ว' : trip.totalPL ? `${trip.totalPL} ใบ · เลือก Trip` : 'เลือก Trip'}
                  </Button></td>
                </tr>)}</tbody>
              </table>
            </div>
          </>
        )}

        {selectedTrip && <section className="card" style={{ marginTop: 18, border: '1px solid var(--border)' }}>
          <PageHeader title={`Trip ${selectedTrip.tripNo}`} subtitle={`${selectedTrip.warehouse} · ${selectedTrip.rows.length} รายการ · ${selectedShipTos.length} Ship To · ข้อมูลอ่านจาก TMS เมื่อเลือก Trip`} />
          <div className="lbl-filter" style={{ marginBottom: 12 }}>
            <span className="text-muted">ประเภทเอกสาร</span><DocumentTypeBadges rows={selectedTrip.rows} />
            <Button variant="accent" size="sm" icon={<IconPrinter size={14} />} onClick={() => print(preDispatchTripHtml(selectedTrip, logoUrl()))}>พิมพ์ทั้ง Trip</Button>
            <Button variant="outline" size="sm" icon={<IconPrinter size={14} />} onClick={() => print(preDispatchAllShipTosHtml(selectedTrip, logoUrl()))}>พิมพ์แยกทั้งหมด</Button>
          </div>
          <div className="table-wrap">
            <table className="table ops-table">
              <thead><tr><th>Ship To / Location</th><th>จำนวนใบ</th><th>ประเภทเอกสาร</th><th className="text-right">พิมพ์</th></tr></thead>
              <tbody>{selectedShipTos.map((shipTo: PreDispatchShipTo) => <tr key={`${selectedTrip.id}-${shipTo.key}`}>
                <td><b>{shipTo.name}</b><div className="text-xs text-muted">{[shipTo.address, shipTo.province, shipTo.postCode].filter(Boolean).join(' ') || '—'}</div></td>
                <td>{new Set(shipTo.rows.map((row) => row.pickingListNo)).size} ใบ · {shipTo.rows.length} รายการ</td>
                <td><DocumentTypeBadges rows={shipTo.rows} /></td>
                <td className="text-right"><Button variant="outline" size="sm" icon={<IconPrinter size={14} />} onClick={() => print(preDispatchShipToHtml(selectedTrip, shipTo, logoUrl()))}>พิมพ์ Ship To นี้</Button></td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>}
      </div>
    </>
  )
}

