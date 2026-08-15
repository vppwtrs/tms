import { useCallback, useEffect, useState } from 'react'
import { previewImport, importShipments, listDealerMap, mapDealer, type ImportPreview } from '../api/tms'
import { listAllCustomers } from '../api/customers'
import { useCloudAuth } from '../context/CloudAuthContext'
import { useToast } from '../context/ToastContext'
import type { CustomerRow, TmsDealerMapRow } from '../types/database'
import { Badge, Button, EmptyState, ErrorBox, Field, Input, PageHeader, Select } from '../components/ui'
import { IconTable } from '../components/icons'

/**
 * จับคู่ร้านแล้วนำเข้าเป็นออเดอร์ — ขั้นที่สองต่อจากหน้าดึงข้อมูล
 *
 * ทำไมต้องแยกเป็นสองหน้า ไม่รวบเป็นปุ่มเดียว: ชื่อร้านใน TMS ไม่ตรงกับชื่อลูกค้า
 * ในระบบเรา ใครจับคู่ผิดออเดอร์จะไปโผล่ผิดลูกค้าแบบเงียบ ๆ ไม่มีอะไรฟ้อง
 * การนำเข้าจึงต้องเห็นก่อนว่ากำลังจะเข้าอะไรบ้าง (ดู api/tms.ts — ห้ามข้าม preview)
 *
 * ใบที่ร้านยังไม่จับคู่จะถูก **ข้าม** ไม่ใช่ทำให้ทั้งวันล้ม กดนำเข้าซ้ำวันเดิมได้
 * ของที่เข้าไปแล้วจะไม่ถูกสร้างซ้ำ ตัดสินด้วย PL No
 *
 * ทะเบียนที่ไม่รู้จักไม่ได้กันการนำเข้า — ออเดอร์เข้าได้ แต่จะยังไม่มีรถผูก
 * ต้องไปจัดเที่ยวเอง ตั้งใจให้เป็นแบบนั้น รถของ TMS กับรถในระบบเราเป็นคนละชุด
 */

const yesterday = (): string => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export default function CloudTmsImport(): React.JSX.Element {
  const { can, user } = useCloudAuth()
  const { push } = useToast()
  const canImport = can('orders.write')

  const [date, setDate] = useState(yesterday)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [dealerMap, setDealerMap] = useState<TmsDealerMapRow[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const [p, m] = await Promise.all([previewImport(date), listDealerMap()])
      setPreview(p)
      setDealerMap(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดูข้อมูลก่อนนำเข้าไม่สำเร็จ')
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    listAllCustomers().then(setCustomers).catch(() => setCustomers([]))
  }, [])

  const assign = async (code: string, name: string, customerId: string): Promise<void> => {
    try {
      await mapDealer({
        dealer_code: code,
        dealer_name: name,
        /* ค่าว่าง = เลือก "ข้ามร้านนี้" ซึ่งไม่เหมือนกับยังไม่ได้จับคู่ —
           ignored บอกระบบว่าคนดูแล้วและตั้งใจไม่เอา จะได้ไม่ถูกทวงทุกวัน */
        customer_id: customerId ? Number(customerId) : null,
        ignored: customerId === '',
        mapped_by: user?.id ?? null,
      })
      push('success', 'บันทึกการจับคู่แล้ว')
      await load()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    }
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await importShipments(date)
      push('success', `นำเข้าแล้ว ${r.created} ใบ · ข้าม ${r.skipped} ใบ`)
      await load()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'นำเข้าไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const mappedOf = (code: string): TmsDealerMapRow | undefined =>
    dealerMap.find((m) => m.dealer_code === code)

  const nothing = preview && preview.picking_lists === 0

  return (
    <>
      <PageHeader
        title="นำเข้าเป็นออเดอร์"
        subtitle="จับคู่ร้านของ TMS กับลูกค้าในระบบ แล้วสร้างเป็นออเดอร์"
      />

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      <div className="card" style={{ padding: 18, display: 'grid', gap: 14, maxWidth: 320 }}>
        <Field label="วันที่ส่ง" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
        </Field>
      </div>

      {loading && <div style={{ padding: 18, color: 'var(--muted)' }}>กำลังตรวจข้อมูล…</div>}

      {nothing && (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            icon={<IconTable />}
            title="ยังไม่มีข้อมูลของวันนี้"
            desc="ไปที่หน้า ดึงข้อมูลจาก TMS แล้วกดส่งขึ้นระบบก่อน"
          />
        </div>
      )}

      {preview && !nothing && (
        <div className="card" style={{ padding: 18, marginTop: 16, display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 13.5 }}>
            <span>ใบสั่ง <b>{preview.picking_lists}</b> ใบ</span>
            <span>เที่ยว <b>{preview.trips}</b></span>
            <span style={{ color: 'var(--muted)' }}>นำเข้าไปแล้ว {preview.already_imported} ใบ</span>
          </div>

          {preview.unmapped_dealers.length > 0 && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                ร้านที่ยังไม่จับคู่ ({preview.unmapped_dealers.length}) — ใบของร้านเหล่านี้จะถูกข้าม
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>ร้านใน TMS</th>
                    <th style={{ width: 90 }}>ใบ</th>
                    <th style={{ width: 300 }}>ลูกค้าในระบบ</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.unmapped_dealers.map((d) => (
                    <tr key={d.dealer_code}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{d.dealer_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{d.dealer_code}</div>
                      </td>
                      <td>{d.picking_lists}</td>
                      <td>
                        <Select
                          defaultValue={String(mappedOf(d.dealer_code)?.customer_id ?? '')}
                          disabled={!canImport}
                          onChange={(e) => void assign(d.dealer_code, d.dealer_name, e.target.value)}
                        >
                          <option value="">— ข้ามร้านนี้ —</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.unknown_plates.length > 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--warn)', lineHeight: 1.7 }}>
              ทะเบียนที่ยังไม่มีในระบบ: {preview.unknown_plates.join(', ')}
              <br />
              <span style={{ color: 'var(--muted)' }}>นำเข้าได้ตามปกติ แต่ออเดอร์จะยังไม่มีรถผูก ต้องไปจัดเที่ยวเอง</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Button onClick={() => void run()} loading={busy} disabled={!canImport}>
              นำเข้าเป็นออเดอร์
            </Button>
            {preview.already_imported > 0 && (
              <Badge label="กดซ้ำได้ ของเดิมไม่ถูกสร้างซ้ำ" tone="gray" />
            )}
          </div>
        </div>
      )}
    </>
  )
}
