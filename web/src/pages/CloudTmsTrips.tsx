import { useCallback, useEffect, useState } from 'react'
import {
  previewTrips, importTrip, createDriverFromTms, createVehicleFromTms,
  type TmsTripsPreview,
} from '../api/tms'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import { Badge, Button, EmptyState, ErrorBox, Field, Input, PageHeader } from '../components/ui'
import { IconTruck } from '../components/icons'

/**
 * เที่ยวของ TMS -> เที่ยวของเรา
 *
 * วัดของจริงก่อนทำหน้านี้: กองรถบริษัทวิ่ง **วันละ 2–6 เที่ยว** ไม่ใช่ 23 ใบจากทุกเจ้า
 * เที่ยวที่ carrier เป็น ATM/NGCH/KTS/TOLL/VES/Naphat คือ outsource ที่บริษัทจ้างวิ่ง
 * ไม่ใช่งานของคนขับเรา และถูกกรองออกตั้งแต่ตอนดึง (ดู OUR_CARRIERS + ตาราง tms_carriers)
 *
 * ทำไมนำเข้าทีละเที่ยว ไม่ใช่ปุ่มเดียวจบทั้งวัน: หนึ่งเที่ยวคือรถหนึ่งคันกับคนหนึ่งคน
 * ผูกผิดคนคืองานไปโผล่ในมือคนขับที่ไม่ได้วิ่ง แล้วคนที่วิ่งจริงมองไม่เห็นงานตัวเอง
 *
 * ทะเบียน/คนขับที่ยังไม่จับคู่ **กันการนำเข้า** (ต่างจากร้านที่ยังไม่จับคู่ ซึ่งข้ามใบนั้นได้)
 * เพราะเที่ยวที่ไม่มีรถกับคนขับไม่ใช่เที่ยว มันคือแถวเปล่าในตาราง
 */

export default function CloudTmsTrips(): React.JSX.Element {
  const { can } = useCloudAuth()
  const { push } = useToast()
  const canDispatch = can('dispatch.write')
  const canDrivers = can('drivers.write')
  const canVehicles = can('vehicles.write')

  const [date, setDate] = useState('')
  const [data, setData] = useState<TmsTripsPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (d?: string): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const p = await previewTrips(d)
      setData(p)
      /* วันไหนก่อน แล้วค่อยแสดง — ไม่เดาจากปฏิทินเครื่อง เพราะวันที่ไม่มีงาน
         กับวันที่ระบบยังไม่ดึงข้อมูล หน้าจอหน้าตาเหมือนกันเป๊ะ */
      if (!d && p.date) setDate(p.date)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดูข้อมูลเที่ยวไม่สำเร็จ')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (tmsId: string, tripNo: string): Promise<void> => {
    setBusy(tmsId)
    try {
      const r = await importTrip(tmsId)
      push('success', r.already
        ? `เที่ยว ${tripNo} นำเข้าไปแล้วก่อนหน้านี้`
        : `นำเข้าเที่ยว ${tripNo} แล้ว · ออเดอร์ใหม่ ${r.created_orders} ใบ` +
          (r.skipped_pls ? ` · ข้ามใบที่ร้านยังไม่จับคู่ ${r.skipped_pls} ใบ` : ''))
      await load(date)
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'นำเข้าเที่ยวไม่สำเร็จ')
    } finally {
      setBusy('')
    }
  }

  const addDriver = async (name: string): Promise<void> => {
    try {
      await createDriverFromTms(name)
      push('success', `เพิ่มพนักงานขับ ${name} แล้ว — ยังไม่มีบัญชีเข้าแอป ต้องสร้างให้ที่หน้าผู้ใช้`)
      await load(date)
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'เพิ่มพนักงานขับไม่สำเร็จ')
    }
  }

  const addVehicle = async (plate: string): Promise<void> => {
    try {
      await createVehicleFromTms(plate)
      push('success', `เพิ่มรถ ${plate} แล้ว — ตรวจความจุบรรทุกที่หน้ารถยนต์ด้วย`)
      await load(date)
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'เพิ่มรถไม่สำเร็จ')
    }
  }

  const tone = (id: number | null): string =>
    id === 5 ? 'success' : id === 6 ? 'danger' : id === 2 ? 'neutral' : 'accent'

  const nothing = data && data.trips.length === 0

  return (
    <>
      <PageHeader
        title="เที่ยวจาก TMS"
        subtitle="เที่ยวของกองรถบริษัท (Fleet Owner) — นำเข้าเป็นเที่ยววิ่งของระบบ"
      />

      {error && <ErrorBox message={error} onRetry={() => void load(date)} />}

      <div className="card" style={{ padding: 18, display: 'grid', gap: 14, maxWidth: 320 }}>
        <Field label="วันที่ของเที่ยว" required>
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              void load(e.target.value)
            }}
          />
        </Field>
      </div>

      {/* เที่ยวที่ TMS ยกเลิกหลังจากเรานำเข้าไปแล้ว — ขึ้นบนสุดเสมอ ไม่ใช่ซ่อนท้ายหน้า
          ระบบไม่ยกเลิกให้เอง เพราะรถอาจวิ่งออกไปแล้ว คนต้องตัดสินเอง */}
      {data && data.cancelled_after_import.length > 0 && (
        <div className="card" style={{ padding: 16, marginTop: 16, borderLeft: '3px solid var(--danger)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            TMS ยกเลิกเที่ยวที่นำเข้าไปแล้ว {data.cancelled_after_import.length} เที่ยว
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
            {data.cancelled_after_import.map((c) => (
              <div key={c.trip_no}>
                เที่ยว {c.trip_no}
                {c.reason ? ` — ${c.reason}` : ''}
                <span style={{ color: 'var(--muted)' }}> · เที่ยวในระบบเรา #{c.our_trip_id} ยังเปิดอยู่</span>
              </div>
            ))}
            <span style={{ color: 'var(--muted)' }}>
              ระบบไม่ยกเลิกให้เอง — รถอาจออกไปแล้ว ไปจัดการที่หน้าแผนงานขนส่ง
            </span>
          </div>
        </div>
      )}

      {(data?.unmapped_plates.length || data?.unmapped_drivers.length) ? (
        <div className="card" style={{ padding: 16, marginTop: 16, display: 'grid', gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>ยังจับคู่ไม่ครบ — เที่ยวที่เกี่ยวข้องจะยังนำเข้าไม่ได้</div>
          {data.unmapped_plates.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 13 }}>ทะเบียน:</span>
              {data.unmapped_plates.map((p) => (
                <Button key={p} variant="outline" disabled={!canVehicles} onClick={() => void addVehicle(p)}>
                  เพิ่มรถ {p}
                </Button>
              ))}
            </div>
          )}
          {data.unmapped_drivers.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 13 }}>พนักงานขับ:</span>
              {data.unmapped_drivers.map((d) => (
                <Button key={d} variant="outline" disabled={!canDrivers} onClick={() => void addDriver(d)}>
                  เพิ่ม {d}
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {loading && <div style={{ padding: 18, color: 'var(--muted)' }}>กำลังตรวจข้อมูล…</div>}

      {nothing && !loading && (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            icon={<IconTruck />}
            title="วันนี้ยังไม่มีเที่ยวของกองรถเรา"
            desc="ไปที่หน้า ดึงข้อมูลจาก TMS แล้วกดส่งขึ้นระบบก่อน · เที่ยวของผู้รับจ้างรายอื่นไม่ถูกดึงเข้ามาโดยตั้งใจ"
          />
        </div>
      )}

      {data && data.trips.length > 0 && (
        <div className="card" style={{ padding: 18, marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th>เที่ยว</th>
                <th>รถ / พนักงานขับ</th>
                <th style={{ width: 90 }}>ใบ · คัน</th>
                <th style={{ width: 130 }}>สถานะ TMS</th>
                <th style={{ width: 180 }} />
              </tr>
            </thead>
            <tbody>
              {data.trips.map((t) => {
                const blocked = !t.vehicle_id || !t.driver_id
                return (
                  <tr key={t.tms_id}>
                    <td>
                      <div className="cell-no">{t.trip_no}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {t.warehouse_code}
                        {t.area ? ` · เขต ${t.area}` : ''}
                        {t.vehicle_type ? ` · ${t.vehicle_type}` : ''}
                      </div>
                    </td>
                    <td>
                      <div>{t.license_plate ?? '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.driver_name ?? '—'}</div>
                    </td>
                    <td className="num">
                      {t.total_pl ?? 0} · {t.total_unit ?? 0}
                      {t.unmapped_pls > 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>
                          ร้านยังไม่จับคู่ {t.unmapped_pls} ใบ
                        </div>
                      )}
                    </td>
                    <td>
                      <Badge label={t.status ?? '—'} tone={tone(t.status_id)} />
                      {t.reason && (
                        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t.reason}</div>
                      )}
                    </td>
                    <td>
                      {t.imported ? (
                        <Badge label="นำเข้าแล้ว" tone="neutral" />
                      ) : t.status_id === 6 ? (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>ยกเลิกที่ TMS</span>
                      ) : (
                        <Button
                          onClick={() => void run(t.tms_id, t.trip_no)}
                          loading={busy === t.tms_id}
                          disabled={!canDispatch || blocked}
                        >
                          นำเข้าเที่ยวนี้
                        </Button>
                      )}
                      {blocked && !t.imported && t.status_id !== 6 && (
                        <div style={{ fontSize: 11.5, color: 'var(--warn)', marginTop: 4 }}>
                          {!t.vehicle_id && !t.driver_id
                            ? 'ยังไม่จับคู่รถและพนักงานขับ'
                            : !t.vehicle_id ? 'ยังไม่จับคู่รถ' : 'ยังไม่จับคู่พนักงานขับ'}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
