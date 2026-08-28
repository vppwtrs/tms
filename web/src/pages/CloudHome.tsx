import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCloudAuth } from '../context/CloudAuthContext'
import { opsSummary, type OpsSummary } from '../api/opsInsights'
import { opsOverview, type OpsOverview } from '../api/opsOverview'
import { opsToday, opsVolume, type OpsToday, type OpsVolume, type VolumeGrain } from '../api/opsToday'
import { ErrorBox } from '../components/ui'
import { DayProgress } from '../components/ops/DayProgress'
import { FleetNow } from '../components/ops/FleetNow'
import { TodayStats } from '../components/ops/TodayStats'
import { FleetTable } from '../components/ops/FleetTable'
import { VolumeTrend } from '../components/ops/VolumeTrend'
import { CancelReasons } from '../components/ops/CancelReasons'
import { InsightPanel } from '../components/ops/InsightPanel'
import { IconBox, IconRoute, IconTable, IconTruckBig } from '../components/icons'
import { fmtLongToday, todayIso } from '../utils/format'

/**
 * หน้าแรก — ศูนย์ควบคุม
 *
 * หน้านี้มีคำถามข้อเดียว: **วันนี้ไปถึงไหน และอะไรกำลังจะมา**
 *
 * จัดวางเป็น **เนื้อซ้าย รางขวา** ไม่ใช่เรียงเต็มความกว้างซ้อนลงมา — แบบหลัง
 * เป็นลำดับของเอกสาร ต้องเลื่อนสามจอถึงเห็นครบ ซึ่งทำให้หน้านี้อ่านเป็นรายงาน
 * ไม่ใช่หน้าจอที่กวาดตารอบเดียวจบ ของที่ต้องลงมือคาอยู่รางขวาตลอดเวลา
 * โดยไม่แย่งพื้นที่ของตัวเลข
 *
 * คำอธิบายวิธีคิดทั้งหมดอยู่ใน tooltip ไม่ใช่ย่อหน้าบนหน้าจอ — คนอ่านทุกวัน
 * ไม่ควรถูกบังคับให้อ่านเชิงอรรถทุกวัน แต่คนที่สงสัยต้องหาคำตอบได้โดยไม่ต้องถามใคร
 *
 * ลำดับบนหน้าคือลำดับที่คำถามถูกถามจริงตอนเช้า: **งานวันนี้** (ใช้รถกี่คัน
 * ได้กี่เที่ยว กี่ใบ กี่จุด ค่าขนส่งเท่าไร) แล้วค่อย **ไปถึงไหนแล้ว** แล้วจึง
 * **รถแต่ละคันถึงไหน** ก่อนหน้านี้บนสุดเป็นความคืบหน้า ซึ่งเป็นคำถามที่สอง
 *
 * ตัวเลขทั้งหน้ามาจากฝั่งฐาน — หน้านี้ไม่นับอะไรเอง
 * เพราะการจับกลุ่มร้านมีกติกาของมันอยู่แล้ว (storeKey) ถ้านับเองจะได้เลขไม่ตรงกับ
 * หน้าออเดอร์โดยไม่มีอะไรฟ้อง
 *
 * ส่วน "ต้องจัดการตอนนี้" มาจาก opsSummary ซึ่งเป็นกฎฝั่งเบราว์เซอร์จากข้อมูลที่
 * หน้าอื่นดึงอยู่แล้ว ไม่ใช่ AI สองตัวนี้ตอบคนละคำถาม จึงอยู่คู่กันได้
 */

/** โหลดใหม่ทุกหนึ่งนาที — ช้ากว่านี้แล้วตัวเลขบนหน้าแรกจะเก่ากว่าที่คนขับเห็นในแอป */
const REFRESH_MS = 60_000

export default function CloudHome(): React.JSX.Element {
  const { can } = useCloudAuth()
  const [sum, setSum] = useState<OpsSummary | null>(null)
  const [now, setNow] = useState<OpsOverview | null>(null)
  const [today, setToday] = useState<OpsToday | null>(null)
  const [volume, setVolume] = useState<OpsVolume | null>(null)
  /* ช่วงเวลาของกราฟอยู่ใน state ของหน้า ไม่ใช่ใน URL — เป็นการมองชั่วคราว
     ไม่ใช่ที่ที่ต้องส่งลิงก์ให้กัน ต่างจากแท็บของหน้าผู้ใช้ */
  const [grain, setGrain] = useState<VolumeGrain>('day')
  const [at, setAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  /* เห็นแผนงานหรือออเดอร์ไม่ได้เลย = ไม่มีอะไรให้สรุป (คนขับที่หลงเข้ามาหน้านี้) */
  const wantsSummary = can('dispatch.view') || can('orders.view')

  const load = useCallback(async (): Promise<void> => {
    if (!wantsSummary) { setLoading(false); return }
    const iso = todayIso()
    try {
      /* ช่วงก่อนหน้าเป็นแค่ตัวเทียบ พังแล้วไม่ควรทำให้ทั้งหน้าพัง — ไทล์จะขึ้นว่า
         "ยังไม่มีช่วงก่อนให้เทียบ" แทน ซึ่งตรงกับความจริงมากกว่าหน้าว่าง */
      /* ทุกก้อนยกเว้นภาพรวมล้มได้โดยไม่ทำให้ทั้งหน้าพัง — ส่วนที่ล้มจะขึ้นสถานะ
         ของตัวเอง ซึ่งตรงกับความจริงมากกว่าหน้าว่างทั้งหน้า */
      const [overview, day, vol, insights] = await Promise.all([
        opsOverview(iso, iso),
        opsToday(iso).catch(() => null),
        opsVolume(grain).catch(() => null),
        opsSummary().catch(() => null),
      ])
      setNow(overview)
      setToday(day)
      setVolume(vol)
      if (insights) setSum(insights)
      setAt(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดสรุปประจำวันไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [wantsSummary, grain])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const actions = [
    can('dispatch.view') && { to: '/tms-trips', icon: IconTable, title: 'งานจาก TMS', desc: 'ไหลเข้าเองทุก 5 นาที' },
    can('dispatch.view') && { to: '/dispatch', icon: IconRoute, title: 'จัดแผนงาน', desc: 'รถ คนขับ ลำดับงาน' },
    can('orders.view') && { to: '/orders', icon: IconBox, title: 'ติดตามออเดอร์', desc: 'งานอยู่ขั้นไหน' },
    can('myjobs.view') && { to: '/my-jobs', icon: IconTruckBig, title: 'งานของฉัน', desc: 'เที่ยวที่ได้รับมอบหมาย' },
  ].filter(Boolean) as Array<{ to: string; icon: React.ComponentType<{ size?: number }>; title: string; desc: string }>

  return (
    <>
      {/* หัวหน้าเตี้ยกว่าหน้าอื่นโดยตั้งใจ ทุกแถวที่ประหยัดได้ตรงนี้ไปอยู่กับแผนภูมิ
          ซึ่งเป็นสิ่งที่ต้องอยู่ในจอเดียวกับรางขวาให้ได้ */}
      <div className="ops-overview-head">
        <div>
          <h1>ภาพรวมงานขนส่ง</h1>
          <span className="ops-overview-date">{fmtLongToday()}</span>
        </div>
        {at && <span className="ops-fresh"><i />อัปเดต {at} น.</span>}
      </div>

      {error && <ErrorBox message={error} onRetry={() => { void load() }} />}

      {wantsSummary ? (
        /* ตะแกรงสูงเท่าจอ — ของที่ยาวไม่จำกัดเลื่อนอยู่ในกล่องของตัวเอง
           ตัวเลขสรุปของวันจึงอยู่ในสายตาตลอดเวลาที่ไล่ดูรถทีละคัน */
        <div className="ops-screen">
          <TodayStats data={today} />

          <div className="ops-deck">
            {/* ซ้าย = ของที่ดูเป็นภาพ: ความคืบหน้าวันนี้ แล้วกราฟปริมาณงานเป็นตัวหลัก
                ปิดท้ายด้วย Issues ซึ่งเป็นสาเหตุที่ทำให้เส้นในกราฟไม่ขึ้น */}
            <div className="ops-col is-main">
              <DayProgress data={now?.progress ?? null} strip />

              <section className="ops-panel">
                <div className="ops-panel-head">
                  <h2 className="ops-panel-title">ปริมาณงาน</h2>
                </div>
                <div className="ops-panel-body ops-chart-fit">
                  <VolumeTrend data={volume} grain={grain} onGrain={setGrain} />
                </div>
              </section>

              <section className="ops-panel">
                <div className="ops-panel-head">
                  <h2 className="ops-panel-title" title="เหตุผลที่คนขับเลือกจากรายการที่มีอยู่จริง ไม่ใช่หมวดที่คิดขึ้นเอง">
                    Issues
                  </h2>
                </div>
                <div className="ops-panel-body">
                  <CancelReasons rows={now?.cancel_reasons ?? []} />
                </div>
              </section>
            </div>

            {/* ขวา = ของที่ต้องลงมือ เรียงตามลำดับที่ลงมือจริง:
                ใบสั่งงานบอกว่าต้องตามอะไร · หน่วยงานบอกว่างานวันนี้เป็นแบบไหนและรถพอไหม
                · ตารางรถบอกว่าตอนนี้ใครถึงไหน ซึ่งเป็นที่ที่ไปตามต่อ */}
            <aside className="ops-col is-side">
              <InsightPanel headline={sum?.headline ?? ''} items={sum?.items ?? []} loading={loading} />

              <div className="ops-mini">
                <FleetNow capacity={now?.capacity ?? null} units={today?.units} />
              </div>

              <section className="ops-panel">
                <div className="ops-panel-head">
                  <h2 className="ops-panel-title" title="จุดที่คนขับกดปิดแล้ว ไม่ใช่ตำแหน่ง GPS — บนเว็บ ตำแหน่งหยุดส่งทันทีที่คนขับล็อกหน้าจอ">
                    รถแต่ละคันถึงไหนแล้ว
                  </h2>
                  <span className="ops-panel-sub">อัปเดตจากที่คนขับกดปิดจุด</span>
                </div>
                <div className="ops-panel-body">
                  <FleetTable data={today} />
                </div>
              </section>
            </aside>
          </div>
        </div>
      ) : (
        <nav className="ops-shortcuts" aria-label="งานหลัก">
          {actions.map((a) => {
            const Icon = a.icon
            return (
              <Link key={a.to} to={a.to} className="ops-shortcut">
                <Icon size={17} />
                <b>{a.title}</b>
                <span>{a.desc}</span>
              </Link>
            )
          })}
        </nav>
      )}
    </>
  )
}
