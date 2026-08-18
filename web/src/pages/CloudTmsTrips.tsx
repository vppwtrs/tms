import { useCallback, useEffect, useState } from 'react'
import { useRealtime } from '../hooks/useRealtime'
import {
  previewTrips, importTrip, createDriverFromTms, linkOrdersToCustomers, tripDetail,
  type TmsTripsPreview, type TmsTripDetail,
} from '../api/tms'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import { Badge, Button, EmptyState, ErrorBox, Field, Input, Modal, PageHeader } from '../components/ui'
import { IconInfo, IconTruck } from '../components/icons'
import { fmtDate, fmtMoney } from '../utils/format'

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

/** แยกชื่อคนขับให้ตรงกับ app.tms_driver_names ฝั่งฐาน — TMS ส่งมาเป็นก้อนเดียว
 *  คั่นด้วยคอมมา และมีคอมมาห้อยท้ายในบางแถว */
/** ค่าขนส่งของเที่ยว — ค่าจ้างตามสัญญาเป็นตัวหลัก ยอดปิดจริงเป็นตัวรอง
 *
 *  แสดงยอดจริงเฉพาะตอนที่ต่างจากสัญญา เพราะส่วนใหญ่มันเท่ากัน
 *  การพิมพ์เลขเดียวกันสองบรรทัดทุกแถวทำให้แถวที่ต่างจริงจมหายไป
 *  null = TMS ยังไม่ลงตัวเลข ไม่ใช่ศูนย์บาท จึงต้องเขียนต่างจาก 0 */
const costCell = (cost: number | null, actual: number | null): React.JSX.Element => {
  if (cost === null && actual === null) return <span className="text-muted">—</span>
  const diff = cost !== null && actual !== null && cost !== actual
  return (
    <>
      <div>{fmtMoney(cost ?? actual ?? 0)}</div>
      {diff && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>จริง {fmtMoney(actual ?? 0)}</div>
      )}
      {cost === null && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ยอดปิดจริง</div>}
      {actual === null && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ยังไม่ปิดยอด</div>}
    </>
  )
}

const driverNames = (raw: string | null): string[] =>
  (raw ?? '').split(',').map((n) => n.trim()).filter(Boolean)

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
  /* เก็บ tms_id ที่กำลังเปิดไว้ด้วย ไม่ใช่แค่ข้อมูลที่โหลดมา — หน้าต่างต้องเปิดทันที
     พร้อมข้อความ "กำลังโหลด" ไม่ใช่ค้างอยู่เฉย ๆ จนกว่า RPC จะตอบ */
  const [detailId, setDetailId] = useState('')
  const [detail, setDetail] = useState<TmsTripDetail | null>(null)
  const [detailError, setDetailError] = useState('')
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

  const openDetail = async (tmsId: string): Promise<void> => {
    setDetailId(tmsId)
    setDetail(null)
    setDetailError('')
    try {
      setDetail(await tripDetail(tmsId))
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'ดูรายละเอียดไม่สำเร็จ')
    }
  }

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
                <th>พนักงานขับ</th>
                <th style={{ width: 120 }}>ใบ · คัน</th>
                <th style={{ width: 120 }}>ค่าขนส่ง</th>
                <th style={{ width: 130 }}>สถานะ TMS</th>
                <th style={{ width: 180 }} />
              </tr>
            </thead>
            <tbody>
              {data.trips.map((t) => {
                /* สองเรื่องคนละเรื่องที่เคยรวมเป็นข้อความเดียว:
                   ไม่มีชื่อคนขับเลย = TMS ยังไม่จ่ายงาน เรารอฝ่ายเดียว ทำอะไรไม่ได้
                   มีชื่อแต่ยังไม่รู้ว่าเป็นใคร = งานของเรา กดจับคู่ได้เดี๋ยวนี้
                   เที่ยวที่ไปสองคนต้องจับคู่ให้ครบทั้งคู่ ไม่ใช่แค่คนแรกที่จับคู่ไปแล้ว */
                const waitingTms = !t.driver_name
                const unmapped = t.unmapped_driver_names ?? []
                const blocked = unmapped.length > 0 || !t.driver_id
                return (
                  <tr key={t.tms_id}>
                    <td>
                      {/* TMS ใช้เลขเที่ยวซ้ำกันได้ข้ามคลัง เห็นสองแถวเลขเดียวกันแล้วดูเหมือนดึงซ้ำ
                          ทะเบียนรถคือตัวที่แยกออกจริง จึงต้องอยู่คู่เลขเที่ยว ไม่ใช่ซ่อนในคอลัมน์ถัดไป */}
                      <div className="cell-no">
                        {t.trip_no}
                        {t.license_plate ? ` · ${t.license_plate}` : ''}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {t.warehouse_code}
                        {t.area ? ` · เขต ${t.area}` : ''}
                        {t.vehicle_type ? ` · ${t.vehicle_type}` : ''}
                      </div>
                    </td>
                    <td>
                      <div>{driverNames(t.driver_name).join(' + ') || '—'}</div>
                      {waitingTms && (
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>TMS ยังไม่ระบุ</div>
                      )}
                    </td>
                    <td className="num">
                      {t.total_pl ?? 0} · {t.total_unit ?? 0}
                      {/* เลขใบเคยพิมพ์ต่อกันอยู่ตรงนี้ ซึ่งอ่านไม่ไหวเมื่อเที่ยวหนึ่งมี 35 ใบ
                          ตารางตอบแค่ "เที่ยวนี้ทำอะไรได้" รายละเอียดของย้ายไปหน้าต่างข้อมูล */}
                      {(t.pls_in_db ?? 0) > 0 && (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => void openDetail(t.tms_id)}
                          title="ดูใบและรายการของในเที่ยวนี้"
                        >
                          <IconInfo size={13} style={{ verticalAlign: -2 }} /> ดูรายละเอียด
                        </button>
                      )}
                      {t.unmapped_pls > 0 && (
                        /* ไม่ใช่คำเตือน — ใบพวกนี้เข้าเป็นออเดอร์ตามปกติ แค่ยังไม่ผูกลูกค้า */
                        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                          ยังไม่ผูกลูกค้า {t.unmapped_pls} ใบ
                        </div>
                      )}
                    </td>
                    <td className="num">{costCell(t.cost, t.actual_cost)}</td>
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
                      ) : waitingTms ? (
                        /* TMS ยังไม่จ่ายคนขับให้เที่ยวนี้ ไม่ใช่ของที่ค้างอยู่ฝั่งเรา
                           บอกให้ตรงว่ารออะไรอยู่ ไม่งั้นคนวางแผนจะไปหาว่าตัวเองลืมทำอะไร */
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          รอ TMS จ่ายพนักงานขับ
                        </span>
                      ) : blocked ? (
                        /* ปุ่มจับคู่อยู่ในแถวของเที่ยวที่ติด ไม่ใช่การ์ดรวมด้านบน —
                           การ์ดรวมทำให้ต้องเดาเองว่าชื่อไหนคู่กับเที่ยวไหน
                           หนึ่งปุ่มต่อหนึ่งคน เพราะสองคนที่ไปด้วยกันคือคนละคนในระบบ */
                        <div style={{ display: 'grid', gap: 6, justifyItems: 'stretch' }}>
                          {unmapped.map((name) => (
                            <Button
                              key={name}
                              variant="outline"
                              disabled={!canDrivers}
                              onClick={() => void addDriver(name)}
                            >
                              จับคู่ {name}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <Button
                          onClick={() => void run(t.tms_id, t.trip_no)}
                          loading={busy === t.tms_id}
                          disabled={!canDispatch}
                        >
                          นำเข้าเที่ยวนี้
                        </Button>
                      )}
                      {blocked && !waitingTms && !t.imported && t.status_id !== 6 && (
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
                          จับคู่แล้วถึงจะนำเข้าได้
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

      <Modal
        open={detailId !== ''}
        onClose={() => { setDetailId(''); setDetail(null); setDetailError('') }}
        title={detail ? `เที่ยว ${detail.trip_no}` : 'รายละเอียดเที่ยว'}
      >
        {detailError ? (
          <div className="text-danger">{detailError}</div>
        ) : !detail ? (
          <div className="text-muted">กำลังโหลด...</div>
        ) : (
          <>
            <div className="form-grid" style={{ marginBottom: 14 }}>
              <Field label="รถ · พนักงานขับ">
                <div>
                  {detail.license_plate ?? '—'}
                  {detail.vehicle_type ? ` · ${detail.vehicle_type}` : ''}
                </div>
                <div className="text-xs text-muted">
                  {detail.driver_names.join(' + ') || 'TMS ยังไม่ระบุ'}
                </div>
              </Field>
              <Field label="คลัง · เขต · วันที่">
                <div>
                  {detail.warehouse_code ?? '—'}
                  {detail.area ? ` · เขต ${detail.area}` : ''}
                </div>
                <div className="text-xs text-muted">{fmtDate(detail.order_date)}</div>
              </Field>
              <Field label="ค่าขนส่ง">
                <div>{costCell(detail.cost, detail.actual_cost)}</div>
              </Field>
              <Field label="สถานะ TMS">
                <div>{detail.status ?? '—'}</div>
                {detail.reason && <div className="text-xs text-muted">{detail.reason}</div>}
              </Field>
            </div>

            <div className="text-strong" style={{ marginBottom: 6 }}>
              ใบทั้งหมด {detail.picking_lists.length} ใบ · รวม {detail.total_unit ?? 0} คัน
            </div>

            {detail.picking_lists.map((pl) => (
              <div key={pl.picking_list_no} className="card" style={{ padding: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className="text-strong">{pl.picking_list_no}</span>
                  {pl.pl_type && <Badge label={pl.pl_type} tone="neutral" />}
                  {/* ใบที่ยังไม่ผูกลูกค้าไม่ได้กันการนำเข้า แต่เป็นของที่ต้องตามเก็บทีหลัง */}
                  {!pl.customer_linked && <Badge label="ยังไม่ผูกลูกค้า" tone="warning" />}
                  <div style={{ flex: 1 }} />
                  <span className="text-xs text-muted">{pl.qty} ชิ้น</span>
                </div>
                <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                  {[pl.ship_to_name ?? pl.dealer_name, pl.province].filter(Boolean).join(' · ') || '—'}
                </div>
                {pl.items.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {pl.items.map((it) => (
                      <div
                        key={it.item_no}
                        style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '2px 0' }}
                      >
                        <span style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>
                          {it.item_no}
                        </span>
                        <span className="text-muted" style={{ flex: 1 }}>{it.item_name ?? ''}</span>
                        <span>×{it.qty}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </Modal>
    </>
  )
}
