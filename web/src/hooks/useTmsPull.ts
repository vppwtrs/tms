import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listWarehouses, pullTrips, pullRecentTrips, pushShipments, pushTrips, tmsBoard,
  logPullRun, pullCoverage, reconcileTrips,
  POLL_MS,
  type Warehouse, type TmsBoard, type PullCoverage,
} from '../api/tmsPull'
import { autoImportReadyTrips } from '../api/tms'
import { tmsTokenSecondsLeft } from '../api/tmsAuth'

/**
 * เครื่องดึงข้อมูลจาก TMS — เดิมเป็นหน้าแยกชื่อ "รับงานจาก TMS"
 *
 * หน้าแยกแปลว่าต้องเปิดสองแท็บ แล้วรอบดึงจะหยุดทันทีที่คนสลับไปดูหน้าอื่น
 * ซึ่งเป็นสิ่งที่เกิดตลอด เพราะหน้าที่คนจ้องจริง ๆ คือหน้าตรวจเที่ยว
 * ย้ายมาเป็น hook แล้วรอบดึงจึงเดินอยู่บนหน้าที่คนเปิดค้างไว้จริง
 *
 * **สองโหมดคนละงาน อย่ายุบรวม**
 *   poll (อัตโนมัติทุก 5 นาที) — เที่ยวของวันนี้ 2 หน้าแรก
 *     ตอบคำถาม "งานที่มีอยู่ตอนนี้ถึงไหนแล้ว" ซึ่งเปลี่ยนได้ทั้งวัน
 *   range (คนกด) — ระบุช่วงวันเอง ไล่หน้าได้ลึกกว่า
 *     ตอบคำถาม "ของช่วงนั้นหายไปตอนไหน" ซึ่งนาน ๆ ทำครั้ง
 *   เอารอบอัตโนมัติไปไล่ทั้งคลังคือดึง ~15,000 ใบทุก 5 นาที ไปกินทรัพยากร TMS
 *   ที่คนทั้งบริษัทใช้อยู่ โดยได้ผลเท่ากับดึง 2 หน้า
 *
 * **เที่ยว (Trip) เป็นแหล่งหลัก** ทั้งของสถานะและของเนื้อใบ — ใบที่ติดมากับเที่ยว
 * มีที่อยู่ปลายทางแบบเต็ม ต่างจากเส้น Picking List ที่ส่งมาห้วนกว่า
 */

const iso = (offsetDays: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export interface TmsPullEngine {
  warehouses: Warehouse[]
  board: TmsBoard | null
  coverage: PullCoverage | null
  busy: boolean
  /** true เฉพาะรอบที่คนกดเอง — รอบเฝ้าสถานะต้องไม่ขวางจอ */
  blocking: boolean
  log: string
  error: string | null
  lastRun: string
  tokenLeft: number | null
  tripPush: { seen: number; inserted: number; updated: number; skipped_carrier: number } | null
  auto: boolean
  setAuto: (v: boolean) => void
  from: string
  to: string
  setFrom: (v: string) => void
  setTo: (v: string) => void
  cycle: (mode: 'poll' | 'range') => Promise<void>
}

export function useTmsPull(): TmsPullEngine {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  /* เปิดหน้ามาตั้งไว้ที่ "วันนี้" — งานที่คนจัดรถทำอยู่คือของวันนี้เกือบทุกครั้ง
     ค่าเดิม -90 ถึง +14 วันลากเที่ยวเก่าเป็นพันมาทุกครั้งที่กด ช้าและไปกินทรัพยากร TMS
     ย้อนหลังยังทำได้ แค่ต้องเลือกวันเอง ซึ่งเป็นการตัดสินใจ ไม่ใช่ค่าเริ่มต้น */
  const [from, setFrom] = useState(() => iso(0))
  const [to, setTo] = useState(() => iso(0))

  const [busy, setBusy] = useState(false)
  /* รอบที่คนกดเองต้องมีจอบอกว่ากำลังทำอะไรอยู่ ส่วนรอบเฝ้าสถานะต้องเงียบ
     ถ้าเด้งจอทับทุก 5 นาที คนจะเลิกเปิดหน้านี้ทิ้งไว้ แล้วข้อมูลก็หยุดไหล */
  const [blocking, setBlocking] = useState(false)
  const [log, setLog] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tripPush, setTripPush] = useState<{ seen: number; inserted: number; updated: number; skipped_carrier: number } | null>(null)
  const [board, setBoard] = useState<TmsBoard | null>(null)
  const [auto, setAuto] = useState(true)
  const [lastRun, setLastRun] = useState<string>('')
  /* รอบดึงของทั้งวัน ไม่ใช่แค่ของแท็บนี้ — คนที่เปิดหน้านี้ต้องรู้ว่าคนอื่นดึงคลังไหนไปแล้ว */
  const [coverage, setCoverage] = useState<PullCoverage | null>(null)
  /* อายุที่เหลือของ token TMS — วัดไว้ตอบคำถามเดียว: ย้ายรอบซิงก์ไปฝั่งเซิร์ฟเวอร์
     โดยเก็บ token แทนรหัสผ่านได้ไหม สั้นเกินก็ไม่คุ้ม ยาวพอก็ไม่ต้องเก็บรหัสใคร */
  const [tokenLeft, setTokenLeft] = useState<number | null>(() => tmsTokenSecondsLeft())

  /* กันรอบซ้อนกัน — รอบก่อนยังไม่จบแล้วรอบใหม่มาถึง คือยิง TMS สองชุดพร้อมกัน
     ใช้ ref ไม่ใช่ state เพราะต้องอ่านค่าล่าสุดตอน timer ยิง ไม่ใช่ค่าตอน render */
  const running = useRef(false)

  const refreshBoard = useCallback((): void => {
    tmsBoard().then(setBoard).catch(() => setBoard(null))
    pullCoverage(24).then(setCoverage).catch(() => setCoverage(null))
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
      if (mode === 'range') setBlocking(true)
      setError(null)
      /* เก็บไว้นอก try เพราะรอบที่ล้มกลางทางก็ต้องถูกบันทึก — รอบที่ล้ม
         คือรอบที่ครอบคลุมไม่ครบ ซึ่งเป็นสิ่งที่บันทึกนี้มีไว้เพื่อบอก */
      let seen = 0
      let ours = 0
      let changed = 0
      let failed: string | null = null
      try {
        /* สองแหล่งในรอบเดียว — ใบตอบว่า "มีของต้องส่ง" เที่ยวตอบว่า "ใครวิ่ง ถึงไหน"
           ดึงแหล่งเดียวคือได้ครึ่งเดียวของคำถามที่คนจัดรถถามทุกเช้า */
        /* เก็บคู่กับคลังไว้ด้วย — ขั้นเทียบข้อมูลต้องรู้ว่าผลชุดไหนมาจากคลังไหน
           ลบข้ามคลังคือลบเที่ยวที่รอบนี้ไม่ได้อ่านเลย */
        const runs: { w: Warehouse; tr: Awaited<ReturnType<typeof pullRecentTrips>> }[] = []
        for (const w of warehouses) {
          const tr = mode === 'poll'
            ? await pullRecentTrips(w, (msg) => setLog(`${w.code}: ${msg}`))
            : await pullTrips({ from, to, warehouse: w, maxPages: 6 }, (msg) => setLog(`${w.code}: ${msg}`))
          runs.push({ w, tr })
        }
        const batches = runs.map((r) => r.tr)
        const allTrips = batches.flatMap((batch) => batch.trips)
        seen = batches.reduce((n, b) => n + b.scanned, 0)
        ours = allTrips.length

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

        /* เทียบของในฐานกับของที่เพิ่งอ่านมา แล้วลบเที่ยวที่ TMS ไม่มีแล้ว
           รอบดึงเป็น upsert อย่างเดียวมาตลอด เที่ยวที่ถูกลบหรือย้ายไปผู้รับจ้างรายอื่น
           จึงค้างอยู่ในหน้าจอเป็นเที่ยวที่กดสั่งงานได้ ทั้งที่ต้นทางไม่มีอยู่แล้ว

           เทียบเฉพาะรอบที่อ่านครบช่วงวันนั้น (complete) และเทียบทีละคลังตามที่อ่านมาจริง
           รอบที่อ่านไม่ครบแล้วเอาไปเทียบ จะลบเที่ยวที่ยังไม่ทันอ่านทิ้ง */
        let goneNote = ''
        for (const { w, tr } of runs) {
          if (!tr.complete) continue
          try {
            const day = mode === 'poll' ? iso(0) : from
            const until = mode === 'poll' ? iso(0) : to
            const seen = tr.trips.map((t) => t.id).filter((id): id is string => !!id)
            const gone = await reconcileTrips(day, until, [w.code], seen)
            if (gone.deleted > 0) goneNote += ` · ${w.code} ลบเที่ยวที่ TMS ไม่มีแล้ว ${gone.deleted}`
            /* เที่ยวที่นำเข้าเป็นงานไปแล้วฐานไม่ลบให้ — คนขับอาจรับไปแล้วหรือมี POD แล้ว
               ต้องขึ้นให้คนเห็นแล้วตัดสินใจเอง ไม่ใช่หายเงียบ */
            if (gone.keptImported.length > 0) {
              goneNote += ` · TMS ไม่มีเที่ยวที่สั่งงานไปแล้ว ${gone.keptImported.length} เที่ยว (${gone.keptImported.map((k) => k.trip_no).join(', ')}) — ตรวจที่หน้าแผนงานขนส่ง`
            }
          } catch (e) {
            goneNote += ` · เทียบข้อมูล ${w.code} ไม่สำเร็จ: ${e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ'}`
          }
        }

        /* เที่ยวที่ข้อมูลครบแล้วส่งถึงคนขับเองในรอบเดียวกับที่ดึงมา
           "ครบ" ที่ฐานตรวจให้: TMS Confirm แล้ว ชื่อคนขับทุกชื่อจับคู่แล้ว และมีใบอย่างน้อยหนึ่งใบ
           ขาดข้อไหนเที่ยวนั้นค้างรอคนกดที่หน้า "เที่ยวจาก TMS" เหมือนเดิม ไม่มีการเดาชื่อคนขับ
           คนขับยังต้องกดรับงานเองอยู่ นำเข้าแล้วไม่ได้แปลว่ารับแล้ว */
        let autoNote = ''
        try {
          const auto = await autoImportReadyTrips()
          if (auto.imported > 0) {
            autoNote = ` · ส่งถึงคนขับอัตโนมัติ ${auto.imported} เที่ยว (${auto.createdOrders} ใบงาน)`
          }
          /* เที่ยวที่ติดต้องดังพอให้เห็น ไม่งั้นคนวางแผนเชื่อว่าอัตโนมัติจัดการหมดแล้ว
             แล้วงานที่ค้างจะไม่มีใครไปกด */
          if (auto.waitingForDriver > 0) autoNote += ` · รอจับคู่ชื่อคนขับ ${auto.waitingForDriver} เที่ยว`
          if (auto.failed > 0) autoNote += ` · นำเข้าไม่สำเร็จ ${auto.failed} เที่ยว`
        } catch (e) {
          /* นำเข้าอัตโนมัติล้มไม่ควรทำให้รอบดึงข้อมูลกลายเป็นล้มเหลว
             ของจาก TMS ถูกเก็บลงฐานเรียบร้อยแล้วตั้งแต่ก่อนถึงบรรทัดนี้ */
          autoNote = ` · นำเข้าอัตโนมัติไม่สำเร็จ: ${e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ'}`
        }

        changed = t.inserted + t.updated
        setLog(
          changed === 0
            ? mode === 'poll'
              /* รอบเฝ้าสถานะเงียบไว้ตามเดิม ยกเว้นรอบที่ส่งงานถึงคนขับจริง
                 ซึ่งเป็นเรื่องที่คนดูหน้านี้ต้องรู้ว่าเกิดขึ้นแล้ว */
              ? `${autoNote}${goneNote}`.trim().replace(/^· /, '')
              : `ไม่มีอะไรเปลี่ยน · ตรวจแล้ว ${allTrips.length} เที่ยวจาก ${warehouses.length} คลัง${autoNote}${goneNote}`
            : `เที่ยว +${t.inserted}/~${t.updated}` +
              (t.skipped_carrier ? ` · ข้ามเที่ยวผู้รับจ้างอื่น ${t.skipped_carrier}` : '') +
              (autoNote || '') + goneNote || ' · ข้อมูลอัปเดตแล้ว',
        )
        refreshBoard()
      } catch (e) {
        failed = e instanceof Error ? e.message : 'ดึงข้อมูลไม่สำเร็จ'
        setError(failed)
      } finally {
        await logPullRun({
          mode,
          from: mode === 'poll' ? iso(0) : from,
          to: mode === 'poll' ? iso(0) : to,
          warehouses: warehouses.map((w) => w.code),
          tripsSeen: seen,
          tripsOurs: ours,
          rowsChanged: changed,
          ok: failed === null,
          error: failed,
        })
        pullCoverage(24).then(setCoverage).catch(() => {})
        setLastRun(new Date().toLocaleTimeString('th-TH', { timeStyle: 'short' }))
        running.current = false
        setBusy(false)
        setBlocking(false)
      }
    },
    [warehouses, from, to, refreshBoard],
  )

  /* รอบเฝ้าสถานะ — ยิงทันทีที่มีคลังแล้ว จากนั้นทุก 5 นาทีตราบที่เปิดหน้าค้างไว้
     ข้อเสียที่รับไว้: ปิดหน้าแล้วรอบหยุด — จึงมีวันที่ดึงล่าสุดขึ้นบนกระดานให้เห็นว่าข้อมูลเก่าแค่ไหน */
  /* นับถอยหลังทุกนาที ไม่ใช่คำนวณครั้งเดียวตอนเปิดหน้า — ค่าที่ค้างอยู่
     ตอบคำถามผิดทันทีที่เปิดหน้าค้างไว้ครึ่งชั่วโมง */
  useEffect(() => {
    const t = setInterval(() => setTokenLeft(tmsTokenSecondsLeft()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!auto || !warehouses.length) return
    void cycle('poll')
    const t = setInterval(() => void cycle('poll'), POLL_MS)
    return () => clearInterval(t)
  }, [auto, warehouses, cycle])


  return {
    warehouses, board, coverage, busy, blocking, log, error, lastRun, tokenLeft, tripPush,
    auto, setAuto, from, to, setFrom, setTo, cycle,
  }
}
