import { useCallback, useEffect, useState } from 'react'
import { useRealtime } from '../hooks/useRealtime'
import {
  previewTrips, importTrip, createDriverFromTms, linkOrdersToCustomers,
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
 * **เที่ยวไปทั้งก้อน** ทุกใบในเที่ยวกลายเป็นออเดอร์ ไม่มีใบไหนถูกข้าม
 * ใบที่ร้านยังไม่จับคู่ก็ยังเป็นออเดอร์ แค่ยังไม่รู้ว่าเป็นลูกค้ารายไหน (เติมย้อนหลังได้)
 * เที่ยวที่ขาดจุดส่งไปเงียบ ๆ = คนขับไปถึงหน้าร้านแล้วในระบบไม่มีงานนั้น
 *
 * สิ่งเดียวที่กันการนำเข้าคือ **ชื่อคนขับที่ยังไม่จับคู่** เพราะคนขับต้องผูกกับบัญชีผู้ใช้
 * ถึงจะเห็นงานตัวเอง (RLS แขวนอยู่กับ drivers.user_id) เดาผิด = งานไปโผล่ในมือคนที่ไม่ได้วิ่ง
 *
 * **ทะเบียนไม่กัน** ระบบสร้างรถให้เองจากทะเบียนที่ TMS บอกมา และ **ห้ามผูกรถกับคนขับ**
 * ที่ไหนในระบบ — กองรถมี 4W 5 คัน คนขับคนเดิมไม่ได้ใช้คันเดิมทุกวัน
 * รถถูกผูกที่ระดับ "เที่ยว" เท่านั้น ซึ่งเป็นความจริงเฉพาะวันนั้น
 */

export default function CloudTmsTrips(): React.JSX.Element {
  const { can } = useCloudAuth()
  const { push } = useToast()
  const canDispatch = can('dispatch.write')
  const canDrivers = can('drivers.write')
  const canOrders = can('orders.write')

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

  /* หน้านี้คือกระจกส่องข้อมูลที่เพิ่งดึงเข้ามา ต้องขยับทันทีที่ push เสร็จ
     ไม่ใช่รอคนกดรีเฟรช — คนจัดรถเปิดหน้านี้ค้างไว้ระหว่างรอของ */
  useRealtime(['tms_trips', 'tms_shipments'], () => void load(date || undefined))

  const run = async (tmsId: string, tripNo: string): Promise<void> => {
    setBusy(tmsId)
    try {
      const r = await importTrip(tmsId)
      push('success', r.already
        ? `เที่ยว ${tripNo} นำเข้าไปแล้วก่อนหน้านี้`
        : `นำเข้าเที่ยว ${tripNo} แล้ว · ออเดอร์ใหม่ ${r.created_orders} ใบ` +
          (r.linked_orders ? ` · ผูกของเดิม ${r.linked_orders} ใบ` : '') +
          (r.orders_without_customer ? ` · ยังไม่ผูกลูกค้า ${r.orders_without_customer} ใบ` : ''))
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

  /* เติมลูกค้าให้ออเดอร์ที่นำเข้าไปก่อนที่ร้านจะถูกจับคู่
     ทางแก้อื่นคือลบออเดอร์แล้วนำเข้าใหม่ ซึ่งพา POD ที่คนขับเก็บไว้หายไปด้วย */
  const backfill = async (): Promise<void> => {
    try {
      const r = await linkOrdersToCustomers()
      push('success', r.linked ? `เติมลูกค้าให้ออเดอร์ ${r.linked} ใบแล้ว` : 'ไม่มีออเดอร์ที่เติมได้')
      await load(date)
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'เติมลูกค้าไม่สำเร็จ')
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

      {data && data.unmapped_drivers.length > 0 && (
        <div className="card" style={{ padding: 16, marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* คนขับเป็นเรื่องเดียวที่ต้องให้คนยืนยัน — ทะเบียนระบบสร้างให้เองตอนนำเข้า */}
          <span style={{ fontSize: 13, fontWeight: 600 }}>พนักงานขับที่ยังไม่รู้ว่าเป็นใครในระบบ:</span>
          {data.unmapped_drivers.map((d) => (
            <Button key={d} variant="outline" disabled={!canDrivers} onClick={() => void addDriver(d)}>
              เพิ่ม {d}
            </Button>
          ))}
        </div>
      )}

      {data && data.orders_without_customer > 0 && (
        <div className="card" style={{ padding: 16, marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 13 }}>
            ออเดอร์ที่ยังไม่ผูกลูกค้า <b>{data.orders_without_customer}</b> ใบ — งานยังส่งถึงคนขับได้ปกติ
            (ชื่อร้านกับที่อยู่อยู่ในช่องปลายทางแล้ว)
          </span>
          <Button variant="outline" onClick={() => void backfill()} disabled={!canOrders}>
            เติมลูกค้าย้อนหลัง
          </Button>
        </div>
      )}

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
                const blocked = !t.driver_id
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
                        /* ไม่ใช่คำเตือน — ใบพวกนี้เข้าเป็นออเดอร์ตามปกติ แค่ยังไม่ผูกลูกค้า */
                        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                          ยังไม่ผูกลูกค้า {t.unmapped_pls} ใบ
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
                          ยังไม่จับคู่พนักงานขับ
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
