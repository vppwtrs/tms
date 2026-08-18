import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Field, Input, PageHeader, ErrorBox } from '../components/ui'
import {
  listWarehouses, pullTrips, pullRecentTrips, pushShipments, pushTrips, tmsBoard,
  POLL_MS,
  type Warehouse, type TmsBoard,
} from '../api/tmsPull'
import { fmtDate, fmtDateTime } from '../utils/format'

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
 * **เที่ยว (Trip) เป็นแหล่งหลัก** ทั้งของสถานะและของเนื้อใบ — ใบที่ติดมากับเที่ยว
 * มีที่อยู่ปลายทางแบบเต็ม ส่วนเส้น Picking List เหลือหน้าที่เดียวคือใบที่ยังไม่ถูกจัดเที่ยว
 * (สถานะ New ไม่โผล่ในหน้า Trip เลย) = ของค้างที่ยังไม่มีใครรับ ซึ่งเป็นงานของคนจัดรถ
 *
 * ส่งขึ้นแล้วยังไม่กลายเป็นงานของคนขับทันที ต้องนำเข้าเที่ยวที่หน้า "เที่ยวจาก TMS" อีกที
 * ตั้งใจให้เป็นสองขั้น เพราะต้องมีคนบอกว่าคนขับชื่อนี้คือใครในระบบเรา
 */

const iso = (offsetDays: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}


export default function TmsPull(): React.JSX.Element {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  /* ดึงย้อนหลังต้องเห็นเที่ยวเก่า/Completed แบบเดียวกับเมนู Trip บริษัท
     รอบอัตโนมัติยังใช้ช่วงสั้นใน pullRecentTrips แยกต่างหาก ไม่กระทบภาระ TMS */
  const [from, setFrom] = useState(() => iso(-90))
  const [to, setTo] = useState(() => iso(14))

  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tripPush, setTripPush] = useState<{ seen: number; inserted: number; updated: number; skipped_carrier: number } | null>(null)
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
        /* ได้รายการว่างต้องบอกให้รู้ ไม่ใช่ปล่อยให้เห็นช่องเลือกว่างกับปุ่มที่กดไม่ได้
           แล้วเดาเองว่าระบบพังหรือยังโหลดไม่เสร็จ */
        if (!list.length) setError('บัญชี TMS นี้ไม่ได้ผูกกับคลังไหนเลย — แจ้งผู้ดูแล TMS ของบริษัท')
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'ดึงรายชื่อคลังไม่ได้'))
    refreshBoard()
  }, [refreshBoard])

  /** ดึง+ส่งในจังหวะเดียว — รอบอัตโนมัติต้องไม่มีขั้นให้คนกด
   *  quiet = รอบเฝ้าสถานะ ไม่มีของเปลี่ยนก็ไม่ต้องขึ้นข้อความ
   *  แจ้ง "สำเร็จ" ทุก 5 นาทีคือฝึกให้คนเลิกอ่านข้อความของระบบ */
  const cycle = useCallback(
    async (mode: 'poll' | 'range'): Promise<void> => {
      if (!warehouses.length || running.current) return
      running.current = true
      setBusy(true)
      setError(null)
      try {
        /* สองแหล่งในรอบเดียว — ใบตอบว่า "มีของต้องส่ง" เที่ยวตอบว่า "ใครวิ่ง ถึงไหน"
           ดึงแหล่งเดียวคือได้ครึ่งเดียวของคำถามที่คนจัดรถถามทุกเช้า */
        const batches = []
        for (const w of warehouses) {
          const tr = mode === 'poll'
            ? await pullRecentTrips(w, (msg) => setLog(`${w.code}: ${msg}`))
            : await pullTrips({ from, to, warehouse: w, maxPages: 6 }, (msg) => setLog(`${w.code}: ${msg}`))
          batches.push(tr)
        }
        const allTrips = batches.flatMap((batch) => batch.trips)

        if (!allTrips.length) {
          setLog(mode === 'poll' ? '' : 'ไม่พบใบสั่งหรือเที่ยวในช่วงที่เลือก')
          return
        }

        /* **เที่ยวเป็นแหล่งหลักของใบ** ใบเดียวกันที่มาจากสองเส้นไม่เหมือนกัน:
           ที่อยู่จากเส้นเที่ยวเป็นแบบเต็ม ("104 หมู่ที่ 7 บางกรวย นนทบุรี THA 11130")
           ส่วนเส้น PL ส่งมาห้วนกว่า ("104 หมู่ที่ 7") ซึ่งกระทบปุ่มนำทางของคนขับตรง ๆ

           ต้องตัดใบซ้ำออก ไม่ใช่ push ทั้งสองชุดแล้วปล่อยให้ทับกัน — สองชุดมีเนื้อต่างกัน
           ถ้าส่งทั้งคู่ทุกรอบ row_hash จะสลับไปมาทุก 5 นาที แล้ว "ไม่มีอะไรเปลี่ยน"
           จะไม่เคยเกิดขึ้นเลย ซึ่งทำลายทั้งกลไกกันเขียนซ้ำและ sync log

           เส้น PL เหลือหน้าที่เดียว: ใบที่ยังไม่ถูกจัดเที่ยว (สถานะ New) ซึ่งไม่โผล่ในหน้า Trip
           = "ของค้างที่ยังไม่มีใครรับ" ซึ่งเป็นงานของคนจัดรถ ไม่ใช่งานคนขับ */
        const t = { seen: 0, inserted: 0, updated: 0, skipped_carrier: 0 }
        for (const batch of batches) {
          /* ใช้รายละเอียดใบที่ติดมากับ Trip เป็นข้อมูลต้นทาง
             ไม่ได้ยิง endpoint Picking List แยกต่างหาก */
          if (batch.rows.length) await pushShipments(batch.rows)
          const pushed = await pushTrips(batch.trips)
          t.inserted += pushed.inserted
          t.updated += pushed.updated
          t.seen += pushed.seen
          t.skipped_carrier += pushed.skipped_carrier
        }
        setTripPush(t)

        /* ไม่มีการสร้างเที่ยว/ออเดอร์อัตโนมัติอีกแล้ว
           รอบดึงข้อมูลมีหน้าที่เดียวคือเอาของจาก TMS มาเก็บไว้ให้ตรง
           การตัดสินว่า "เที่ยวนี้ใครขับ แล้วสั่งงานเมื่อไหร่" เป็นของคนวางแผนงาน
           ของเดิมเดาคนขับจากชื่อใน TMS แล้วสร้างงานให้เอง ซึ่งจับคนผิดสะสมมาเรื่อย ๆ */

        const changed = t.inserted + t.updated
        setLog(
          changed === 0
            ? mode === 'poll'
              ? ''
              : `ไม่มีอะไรเปลี่ยน · ตรวจแล้ว ${allTrips.length} เที่ยวจาก ${warehouses.length} คลัง`
            : `เที่ยว +${t.inserted}/~${t.updated}` +
              (t.skipped_carrier ? ` · ข้ามเที่ยวผู้รับจ้างอื่น ${t.skipped_carrier}` : '') +
              ' · สั่งงานต่อที่หน้า “เที่ยวจาก TMS”',
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
    [warehouses, from, to, refreshBoard],
  )

  /* รอบเฝ้าสถานะ — ยิงทันทีที่มีคลังแล้ว จากนั้นทุก 5 นาทีตราบที่เปิดหน้าค้างไว้
     ข้อเสียที่รับไว้: ปิดหน้าแล้วรอบหยุด — จึงมีวันที่ดึงล่าสุดขึ้นบนกระดานให้เห็นว่าข้อมูลเก่าแค่ไหน */
  useEffect(() => {
    if (!auto || !warehouses.length) return
    void cycle('poll')
    const t = setInterval(() => void cycle('poll'), POLL_MS)
    return () => clearInterval(t)
  }, [auto, warehouses, cycle])

  const stale = board && !board.synced_at

  /* ข้อมูลไหลเข้าเฉพาะตอนหน้านี้เปิดค้าง ถ้าคนปิดแท็บไปแล้วเปิดกลับมา ตัวเลขบนกระดาน
     ยังหน้าตาเหมือนสด — บอกให้ชัดว่าค้างมานานแค่ไหน เกินหนึ่งรอบ (5 นาที) หลายเท่าถือว่าเก่า */
  const STALE_MS = 30 * 60 * 1000
  const syncedAgoMin =
    board?.synced_at != null
      ? Math.floor((Date.now() - new Date(board.synced_at).getTime()) / 60000)
      : null
  const outdated = syncedAgoMin != null && syncedAgoMin * 60000 >= STALE_MS

  return (
    <>
      <PageHeader
        title="ดึงข้อมูลจาก TMS"
        subtitle="เที่ยวของกองรถ + ใบสั่งที่ยังไม่ถูกจัดเที่ยว จาก TMS บริษัท"
      />

      {stale && (
        <div className="tms-stale" role="status">
          ยังไม่มีใครดึงข้อมูลเข้าระบบเลย
        </div>
      )}

      {outdated && (
        <div className="tms-stale" role="status">
          ข้อมูลบนหน้านี้ดึงล่าสุดเมื่อ {syncedAgoMin} นาทีที่แล้ว — กด “เช็ค Trip ทุกคลังเดี๋ยวนี้”
          หรือเปิดการเฝ้าสถานะอัตโนมัติไว้ ตัวเลขถึงจะตรงกับ TMS
        </div>
      )}

      {/* ฐานข้อมูลกรองเที่ยวด้วยตาราง tms_carriers ถ้าชื่อ carrier จาก TMS ไม่มีในนั้น
          เที่ยวจะถูกทิ้งเงียบ ๆ ทั้งชุด ซึ่งหน้าตาเหมือน "ไม่มีงาน" เป๊ะ
          เคยกินเวลาไล่หาสาเหตุมาแล้ว จึงต้องแยกสองกรณีนี้ให้เห็นบนหน้าจอ */}
      {tripPush && tripPush.seen > 0 && tripPush.skipped_carrier === tripPush.seen && (
        <div className="tms-stale" role="alert">
          ดึงเที่ยวมาได้ {tripPush.seen} เที่ยว แต่ถูกกรองทิ้งทั้งหมดเพราะระบบไม่รู้จักชื่อผู้ให้บริการขนส่ง
          — ต้องเพิ่มชื่อ carrier ลงตาราง tms_carriers ก่อน ข้อมูลถึงจะเข้าระบบ
        </div>
      )}

      {error && <ErrorBox message={error} />}

      {board && (
        <div className="card" style={{ padding: 18, marginBottom: 16, display: 'grid', gap: 14 }}>
          {/* ตัวเลขทั้งแถวนับเฉพาะวันที่ระบุ ไม่ใช่ยอดสะสมทั้งระบบ — ป้ายเดิมไม่บอกขอบเขต
              คนอ่านจึงเอาไปเทียบกับยอดในฐานแล้วไม่ตรง และระหว่างดึงข้อมูล เที่ยวของวันใหม่
              ยังเป็น 0 ขณะที่จำนวนคันยังค้างของวันเก่า อ่านได้เป็น "0 เที่ยว 122 คัน" */}
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            ยอดของวันที่ {fmtDate(board.date ?? board.latest_date)}
          </div>

          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'baseline' }}>
            {/* วันล่าสุดมาก่อนทุกอย่าง — คำถามแรกของคนเปิดหน้านี้คือ "ของวันไหน" */}
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>วันที่ล่าสุดที่มีงาน</div>
              <div style={{ fontSize: 22, fontWeight: 660 }}>{fmtDate(board.latest_date)}</div>
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
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>จำนวนคัน</div>
              <div style={{ fontSize: 22, fontWeight: 660 }} className="num">{board.total_qty}</div>
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

          {board.by_kind && board.by_kind.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {board.by_kind.map((b) => (
                <Badge
                  key={b.kind}
                  tone={b.kind === 'box' ? 'accent' : 'neutral'}
                  label={`${b.kind === 'box' ? 'กล่อง' : 'รถ'} — ${b.trips} เที่ยว · ${b.units} คัน`}
                />
              ))}
            </div>
          )}

          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            ดึงล่าสุด {fmtDateTime(board.synced_at)} · สถานะเปลี่ยนล่าสุด {fmtDateTime(board.last_change_at)}
            {lastRun && ` · รอบล่าสุดในหน้านี้ ${lastRun}`}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 18, display: 'grid', gap: 14, maxWidth: 560 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          ระบบจะดึง Trip ครบทุกคลังที่บัญชีนี้มีสิทธิ์ ({warehouses.length} คลัง)
        </div>

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

          <div style={{ display: 'flex', gap: 10 }}>
            <Button onClick={() => void cycle('range')} loading={busy} disabled={!warehouses.length}>
              ดึง Trip ช่วง {fmtDate(from)} – {fmtDate(to)}
            </Button>
            <Button variant="outline" onClick={() => void cycle('poll')} disabled={busy || !warehouses.length}>
              เช็ค Trip ของวันนี้เดี๋ยวนี้
            </Button>
          </div>
        </div>

        {log && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{log}</div>}

      </div>
    </>
  )
}
