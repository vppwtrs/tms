import { useEffect, useState } from 'react'
import { Button, Field, Input, Select, PageHeader, ErrorBox } from '../components/ui'
import {
  listWarehouses, pullShipments, pushShipments, syncStatus,
  type Warehouse, type PullResult,
} from '../api/tmsPull'

/**
 * ดึงข้อมูลจาก TMS บริษัท — แทนโปรแกรม extractor ที่เคยแยกต่างหาก
 *
 * ทำไมยุบเข้ามา: โปรแกรมแยกแปลว่าต้องเปิดสองอย่าง จำสองที่ ติดตั้งสองรอบ
 * แล้วสุดท้ายคนจะไม่เปิดตัวที่สอง เดิมแยกเพราะ CORS บังคับ ตอนนี้ tms-gateway
 * รับหน้าที่นั้นไปแล้ว จึงไม่มีเหตุผลให้แยกอีก
 *
 * ค่าเริ่มต้นเป็น **เมื่อวาน** ไม่ใช่วันนี้ — รอบข้อมูลของ TMS ปิดและส่งหลังเที่ยงคืน
 * ข้อมูลของวันปัจจุบันจึงยังไม่ actual เหมือนที่หน้า TMS ตั้งไว้
 *
 * ส่งขึ้นแล้วยังไม่กลายเป็นงานของคนขับทันที ต้องจับคู่ร้านแล้วกดนำเข้าอีกที (ดู tms.ts)
 * ตั้งใจให้เป็นสองขั้น เพราะชื่อร้านใน TMS ไม่ตรงกับชื่อลูกค้าในระบบเรา
 */

const yesterday = (): string => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export default function TmsPull(): React.JSX.Element {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [whCode, setWhCode] = useState('')
  const [from, setFrom] = useState(yesterday)
  const [to, setTo] = useState(yesterday)
  const [withItems, setWithItems] = useState(true)

  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PullResult | null>(null)
  const [pushed, setPushed] = useState<{ rows: number; dates: string[] } | null>(null)
  const [status, setStatus] = useState<{ synced_at: string | null; picking_lists: number } | null>(null)

  useEffect(() => {
    listWarehouses()
      .then((list) => {
        setWarehouses(list)
        setWhCode((c) => c || list[0]?.code || '')
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'ดึงรายชื่อคลังไม่ได้'))
  }, [])

  useEffect(() => {
    syncStatus(from).then(setStatus).catch(() => setStatus(null))
  }, [from, pushed])

  const wh = warehouses.find((w) => w.code === whCode)

  const run = async (): Promise<void> => {
    if (!wh) return
    setBusy(true)
    setError(null)
    setResult(null)
    setPushed(null)
    try {
      const r = await pullShipments({ from, to, warehouse: wh, withItems }, setLog)
      setResult(r)
      setLog(
        r.rows.length
          ? `ดึงมา ${r.rows.length} แถว · ${r.pickingLists} PL · ${r.trips} เที่ยว`
          : 'ไม่พบข้อมูลในช่วงที่เลือก',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ดึงข้อมูลไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const send = async (): Promise<void> => {
    if (!result?.rows.length) return
    setBusy(true)
    setError(null)
    try {
      const r = await pushShipments(result.rows, (sent, total) => setLog(`ส่งขึ้นระบบ ${sent}/${total} แถว`))
      setPushed(r)
      setLog(`ส่งขึ้นระบบแล้ว ${r.rows} แถว · ${r.dates.length} วัน`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ส่งข้อมูลไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const stale = status && !status.synced_at

  return (
    <>
      <PageHeader title="ดึงข้อมูลจาก TMS" subtitle="ดึงรายงาน Actual Shipment แล้วส่งเข้าระบบ" />

      {stale && (
        <div className="tms-stale" role="status">
          ข้อมูลของวันที่ {from} ยังไม่มีใครดึงเข้าระบบ
        </div>
      )}

      {error && <ErrorBox message={error} />}

      <div className="card" style={{ padding: 18, display: 'grid', gap: 14, maxWidth: 560 }}>
        <Field label="คลัง" required>
          <Select value={whCode} onChange={(e) => setWhCode(e.target.value)} disabled={busy}>
            {warehouses.map((w) => (
              <option key={w.code} value={w.code}>
                {w.description ? `${w.code} — ${w.description}` : w.code}
              </option>
            ))}
          </Select>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="ตั้งแต่วันที่" required>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
          </Field>
          <Field label="ถึงวันที่" required>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} />
          </Field>
        </div>

        <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={withItems} onChange={(e) => setWithItems(e.target.checked)} disabled={busy} />
          ดึงชื่อสินค้ามาด้วย (ช้ากว่า แต่ได้รายละเอียดครบ)
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <Button onClick={() => void run()} loading={busy} disabled={!wh}>
            ดึงข้อมูล
          </Button>
          <Button variant="outline" onClick={() => void send()} disabled={busy || !result?.rows.length}>
            ส่งขึ้นระบบ
          </Button>
        </div>

        {log && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{log}</div>}

        {result && (result.missingItems > 0 || result.qtyMismatch > 0) && (
          <div style={{ fontSize: 12.5, color: 'var(--warn)', lineHeight: 1.7 }}>
            {result.missingItems > 0 && <>หาชื่อสินค้าไม่เจอ {result.missingItems} ใบ (ส่งขึ้นได้ ช่องสินค้าจะว่าง)<br /></>}
            {result.qtyMismatch > 0 && <>ยอดสินค้าไม่ตรงกับจำนวนคัน {result.qtyMismatch} ใบ — ควรให้คนดู</>}
          </div>
        )}

        {pushed && (
          <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            ขั้นต่อไป: ตรวจการจับคู่ร้าน แล้วกดนำเข้าเป็นออเดอร์
            <br />
            <span style={{ color: 'var(--muted)' }}>กดส่งซ้ำได้ ข้อมูลไม่ซ้ำ ระบบยึด PL No + รหัสสินค้าเป็นตัวตัดสิน</span>
          </div>
        )}
      </div>
    </>
  )
}
