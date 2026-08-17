import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Field, Input, Select, PageHeader, ErrorBox } from '../components/ui'
import {
  listWarehouses, pullPickingLists, pullRecent, pullTrips, pullRecentTrips,
  pushShipments, pushTrips, tmsBoard,
  POLL_MS, PL_STATUS,
  type Warehouse, type PullResult, type PushResult, type PlStatus, type TmsBoard,
} from '../api/tmsPull'

/**
 * ดึงข้อมูลจาก TMS บริษัท — แทนโปรแกรม extractor ที่เคยแยกต่างหาก
 *
 * ทำไมยุบเข้ามา: โปรแกรมแยกแปลว่าต้องเปิดสองอย่าง จำสองที่ ติดตั้งสองรอบ
 * แล้วสุดท้ายคนจะไม่เปิดตัวที่สอง เดิมแยกเพราะ CORS บังคับ ตอนนี้ tms-gateway
 * รับหน้าที่นั้นไปแล้ว จึงไม่มีเหตุผลให้แยกอีก
 *
 * **สองปุ่มคนละงาน อย่ายุบรวม**
 *   เฝ้าสถานะ (อัตโนมัติทุก 5 นาที) — 2 หน้าแรก ย้อนหลัง 3 วันถึงล่วงหน้า 14 วัน
 *     ตอบคำถาม "งานที่มีอยู่ตอนนี้ถึงไหนแล้ว" ซึ่งเปลี่ยนได้ทั้งวัน
 *   ดึงย้อนหลัง (คนกด) — ระบุช่วงวันเอง ไล่หน้าได้ถึง 60 หน้า
 *     ตอบคำถาม "ของช่วงนั้นหายไปตอนไหน" ซึ่งนาน ๆ ทำครั้ง
 * เอารอบอัตโนมัติไปไล่ทั้งคลังคือดึง ~15,000 ใบทุก 5 นาที = ไปกินทรัพยากร TMS
 * ที่คนทั้งบริษัทใช้อยู่ โดยได้ผลเท่ากับดึง 2 หน้า
 *
 * ส่งขึ้นแล้วยังไม่กลายเป็นงานของคนขับทันที ต้องจับคู่ร้านแล้วกดนำเข้าอีกที (ดู tms.ts)
 * ตั้งใจให้เป็นสองขั้น เพราะชื่อร้านใน TMS ไม่ตรงกับชื่อลูกค้าในระบบเรา
 */

const iso = (offsetDays: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

const clock = (v: string | null): string =>
  v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export default function TmsPull(): React.JSX.Element {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [whCode, setWhCode] = useState('')
  /* ใบสั่งมองไปข้างหน้า — ค่าเริ่มต้นย้อนหลัง 3 วันถึงล่วงหน้า 14 วัน ตรงกับรอบเฝ้าสถานะ */
  const [from, setFrom] = useState(() => iso(-3))
  const [to, setTo] = useState(() => iso(14))
  const [statuses, setStatuses] = useState<PlStatus[]>([...PL_STATUS])

  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PullResult | null>(null)
  const [pushed, setPushed] = useState<PushResult | null>(null)
  const [tripPush, setTripPush] = useState<{ inserted: number; updated: number; skipped_carrier: number } | null>(null)
  const [board, setBoard] = useState<TmsBoard | null>(null)
  const [auto, setAuto] = useState(true)
  const [lastRun, setLastRun] = useState<string>('')

  /* กันรอบซ้อนกัน — รอบก่อนยังไม่จบแล้วรอบใหม่มาถึง คือยิง TMS สองชุดพร้อมกัน
     ใช้ ref ไม่ใช่ state เพราะต้องอ่านค่าล่าสุดตอน timer ยิง ไม่ใช่ค่าตอน render */
  const running = useRef(false)

  const refreshBoard = useCallback((): void => {
    tmsBoard().then(setBoard).catch(() => setBoard(null))
  }, [])

  useEffect(() => {
    listWarehouses()
      .then((list) => {
        setWarehouses(list)
        setWhCode((c) => c || list[0]?.code || '')
        /* ได้รายการว่างต้องบอกให้รู้ ไม่ใช่ปล่อยให้เห็นช่องเลือกว่างกับปุ่มที่กดไม่ได้
           แล้วเดาเองว่าระบบพังหรือยังโหลดไม่เสร็จ */
        if (!list.length) setError('บัญชี TMS นี้ไม่ได้ผูกกับคลังไหนเลย — แจ้งผู้ดูแล TMS ของบริษัท')
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'ดึงรายชื่อคลังไม่ได้'))
    refreshBoard()
  }, [refreshBoard])

  const wh = warehouses.find((w) => w.code === whCode)

  /** ดึง+ส่งในจังหวะเดียว — รอบอัตโนมัติต้องไม่มีขั้นให้คนกด
   *  quiet = รอบเฝ้าสถานะ ไม่มีของเปลี่ยนก็ไม่ต้องขึ้นข้อความ
   *  แจ้ง "สำเร็จ" ทุก 5 นาทีคือฝึกให้คนเลิกอ่านข้อความของระบบ */
  const cycle = useCallback(
    async (mode: 'poll' | 'range'): Promise<void> => {
      const w = warehouses.find((x) => x.code === whCode)
      if (!w || running.current) return
      running.current = true
      setBusy(true)
      setError(null)
      try {
        /* สองแหล่งในรอบเดียว — ใบตอบว่า "มีของต้องส่ง" เที่ยวตอบว่า "ใครวิ่ง ถึงไหน"
           ดึงแหล่งเดียวคือได้ครึ่งเดียวของคำถามที่คนจัดรถถามทุกเช้า */
        const r = mode === 'poll'
          ? await pullRecent(w)
          : await pullPickingLists({ from, to, warehouse: w, statuses }, setLog)
        setResult(r)

        const tr = mode === 'poll'
          ? await pullRecentTrips(w)
          : await pullTrips({ from, to, warehouse: w, maxPages: 6 }, setLog)

        if (!r.rows.length && !tr.trips.length) {
          setLog(mode === 'poll' ? '' : 'ไม่พบใบสั่งหรือเที่ยวในช่วงที่เลือก')
          return
        }

        /* ใบต้องขึ้นก่อนเที่ยว — push_tms_trips ผูกใบเข้าเที่ยวด้วยเลข PL
           ใบที่ยังไม่ขึ้นก็ไม่พัง แค่ไปผูกรอบหน้า แต่รอบนี้กระดานจะโชว์ใบในเที่ยวเป็น 0 */
        const rows = r.rows.length ? r.rows : tr.rows
        const p = rows.length
          ? await pushShipments(rows, (sent, total) =>
              mode === 'range' ? setLog(`ส่งขึ้นระบบ ${sent}/${total} แถว`) : undefined)
          : null
        if (p) setPushed(p)

        const t = await pushTrips(tr.trips)
        setTripPush(t)

        const changed = (p ? p.inserted + p.updated : 0) + t.inserted + t.updated
        setLog(
          changed === 0
            ? mode === 'poll' ? '' : `ไม่มีอะไรเปลี่ยน · ตรวจแล้ว ${r.pickingLists} ใบ · ${tr.trips.length} เที่ยว`
            : `ใบ +${p?.inserted ?? 0}/~${p?.updated ?? 0} แถว · เที่ยว +${t.inserted}/~${t.updated}` +
              (t.skipped_carrier ? ` · ข้ามเที่ยวผู้รับจ้างอื่น ${t.skipped_carrier}` : ''),
        )
        refreshBoard()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'ดึงข้อมูลไม่สำเร็จ')
      } finally {
        setLastRun(new Date().toLocaleTimeString('th-TH', { timeStyle: 'short' }))
        running.current = false
        setBusy(false)
      }
    },
    [warehouses, whCode, from, to, statuses, refreshBoard],
  )

  /* รอบเฝ้าสถานะ — ยิงทันทีที่มีคลังแล้ว จากนั้นทุก 5 นาทีตราบที่เปิดหน้าค้างไว้
     ข้อเสียที่รับไว้: ปิดหน้าแล้วรอบหยุด — จึงมีวันที่ดึงล่าสุดขึ้นบนกระดานให้เห็นว่าข้อมูลเก่าแค่ไหน */
  useEffect(() => {
    if (!auto || !wh) return
    void cycle('poll')
    const t = setInterval(() => void cycle('poll'), POLL_MS)
    return () => clearInterval(t)
  }, [auto, wh, cycle])

  const stale = board && !board.synced_at

  return (
    <>
      <PageHeader
        title="ดึงข้อมูลจาก TMS"
        subtitle="ใบสั่ง (Picking List) จาก TMS บริษัท พร้อมสถานะงานล่าสุด"
      />

      {stale && (
        <div className="tms-stale" role="status">
          ยังไม่มีใครดึงข้อมูลเข้าระบบเลย
        </div>
      )}

      {error && <ErrorBox message={error} />}

      {board && (
        <div className="card" style={{ padding: 18, marginBottom: 16, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'baseline' }}>
            {/* วันล่าสุดมาก่อนทุกอย่าง — คำถามแรกของคนเปิดหน้านี้คือ "ของวันไหน" */}
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>วันที่ล่าสุดที่มีงาน</div>
              <div style={{ fontSize: 22, fontWeight: 660 }}>{board.latest_date ?? '—'}</div>
            </div>
            {/* เที่ยวมาก่อนใบ — คนจัดรถคิดเป็นเที่ยว ยอดใบเป็นตัวรอง */}
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>เที่ยวของกองรถเรา</div>
              <div style={{ fontSize: 22, fontWeight: 660 }} className="num">{board.trips}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>เที่ยวรอนำเข้า</div>
              <div style={{ fontSize: 22, fontWeight: 660 }} className="num">{board.trips_pending_import}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>ใบสั่ง</div>
              <div style={{ fontSize: 22, fontWeight: 660 }} className="num">{board.picking_lists}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>จำนวนคัน</div>
              <div style={{ fontSize: 22, fontWeight: 660 }} className="num">{board.total_qty}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>รอนำเข้าเป็นออเดอร์</div>
              <div style={{ fontSize: 22, fontWeight: 660 }} className="num">{board.pending_import}</div>
            </div>
          </div>

          {board.trips_by_status.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {board.trips_by_status.map((b) => (
                <Badge
                  key={b.status_id}
                  tone={b.status_id === 5 ? 'success' : b.status_id === 6 ? 'danger' : b.status_id === 2 ? 'neutral' : 'accent'}
                  label={`${b.status} — ${b.trips} เที่ยว · ${b.units} คัน`}
                />
              ))}
            </div>
          )}

          {board.by_status.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {board.by_status.map((b) => (
                <Badge
                  key={`${b.pl_status}/${b.trip_status}`}
                  tone={b.pl_status === 'Completed' ? 'success' : b.pl_status === 'New' ? 'neutral' : 'accent'}
                  label={`${b.pl_status}${b.trip_status !== '-' ? ` · ${b.trip_status}` : ''} — ${b.picking_lists} ใบ`}
                />
              ))}
            </div>
          )}

          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            ดึงล่าสุด {clock(board.synced_at)} · สถานะเปลี่ยนล่าสุด {clock(board.last_change_at)}
            {lastRun && ` · รอบล่าสุดในหน้านี้ ${lastRun}`}
          </div>
        </div>
      )}

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

        <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          เฝ้าสถานะให้อัตโนมัติทุก 5 นาที (ตราบที่เปิดหน้านี้ไว้)
        </label>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, display: 'grid', gap: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>ดึงย้อนหลังเอง</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="ตั้งแต่วันที่ (วันวางแผนส่ง)" required>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
            </Field>
            <Field label="ถึงวันที่" required>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} />
            </Field>
          </div>

          <Field
            label="สถานะใบสั่ง"
            hint="เก็บ Completed ไว้ด้วยได้ — ระบบไม่นำใบที่ส่งจบแล้วไปสร้างออเดอร์ ตัดออกแค่ตอนนำเข้า"
          >
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {PL_STATUS.map((st) => (
                <label key={st} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={statuses.includes(st)}
                    disabled={busy}
                    onChange={(e) =>
                      setStatuses((prev) => (e.target.checked ? [...prev, st] : prev.filter((x) => x !== st)))
                    }
                  />
                  {st}
                </label>
              ))}
            </div>
          </Field>

          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={() => void cycle('range')} loading={busy} disabled={!wh}>
              ดึงช่วงนี้แล้วส่งขึ้นระบบ
            </Button>
            <Button variant="outline" onClick={() => void cycle('poll')} disabled={busy || !wh}>
              เช็คสถานะเดี๋ยวนี้
            </Button>
          </div>
        </div>

        {log && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{log}</div>}

        {result && result.missingItems > 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--warn)', lineHeight: 1.7 }}>
            ใบที่ไม่มีรายการสินค้า {result.missingItems} ใบ — ส่งขึ้นระบบได้ ช่องสินค้าจะว่าง
          </div>
        )}

        {pushed && pushed.inserted + pushed.updated > 0 && (
          <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            ขั้นต่อไป: ตรวจการจับคู่ร้าน แล้วกดนำเข้าเป็นออเดอร์
            <br />
            <span style={{ color: 'var(--muted)' }}>
              กดส่งซ้ำได้ ระบบยึด PL No + รหัสสินค้าเป็นตัวตัดสิน แถวที่ค่าเท่าเดิมจะไม่ถูกเขียนทับ
            </span>
          </div>
        )}
      </div>
    </>
  )
}
