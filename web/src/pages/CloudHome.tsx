import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCloudAuth } from '../context/CloudAuthContext'
import { opsSummary, type OpsSummary } from '../api/opsInsights'
import { opsOverview, type OpsOverview } from '../api/opsOverview'
import { ErrorBox } from '../components/ui'
import { DayProgress } from '../components/ops/DayProgress'
import { FleetNow } from '../components/ops/FleetNow'
import { KpiTiles } from '../components/ops/KpiTiles'
import { VolumeChart } from '../components/ops/VolumeChart'
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
 * ตัวเลขทั้งหน้ามาจาก `ops_overview` การเรียกครั้งเดียว — หน้านี้ไม่นับอะไรเอง
 * เพราะการจับกลุ่มร้านมีกติกาของมันอยู่แล้ว (storeKey) ถ้านับเองจะได้เลขไม่ตรงกับ
 * หน้าออเดอร์โดยไม่มีอะไรฟ้อง
 *
 * ส่วน "ต้องจัดการตอนนี้" มาจาก opsSummary ซึ่งเป็นกฎฝั่งเบราว์เซอร์จากข้อมูลที่
 * หน้าอื่นดึงอยู่แล้ว ไม่ใช่ AI สองตัวนี้ตอบคนละคำถาม จึงอยู่คู่กันได้
 */

/** โหลดใหม่ทุกหนึ่งนาที — ช้ากว่านี้แล้วตัวเลขบนหน้าแรกจะเก่ากว่าที่คนขับเห็นในแอป */
const REFRESH_MS = 60_000

/** ตัวเทียบคือ **วันเดียวกันของสัปดาห์ก่อน** ไม่ใช่เมื่อวาน
 *
 *  ปริมาณงานขึ้นกับวันในสัปดาห์อย่างแรง จันทร์เทียบกับอาทิตย์แล้วลูกศรจะชี้ผิดทุกวันจันทร์
 *  ฐานคิดประมาณการด้วยหลักเดียวกัน ระบบจึงเทียบด้วยเกณฑ์เดียวกันทั้งหน้า */
function weekBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() - 7)
  return todayIso(d)
}

export default function CloudHome(): React.JSX.Element {
  const { can } = useCloudAuth()
  const [sum, setSum] = useState<OpsSummary | null>(null)
  const [now, setNow] = useState<OpsOverview | null>(null)
  const [prev, setPrev] = useState<OpsOverview | null>(null)
  const [at, setAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  /* เห็นแผนงานหรือออเดอร์ไม่ได้เลย = ไม่มีอะไรให้สรุป (คนขับที่หลงเข้ามาหน้านี้) */
  const wantsSummary = can('dispatch.view') || can('orders.view')

  const load = useCallback(async (): Promise<void> => {
    if (!wantsSummary) { setLoading(false); return }
    const today = todayIso()
    try {
      /* ช่วงก่อนหน้าเป็นแค่ตัวเทียบ พังแล้วไม่ควรทำให้ทั้งหน้าพัง — ไทล์จะขึ้นว่า
         "ยังไม่มีช่วงก่อนให้เทียบ" แทน ซึ่งตรงกับความจริงมากกว่าหน้าว่าง */
      const [overview, before, insights] = await Promise.all([
        opsOverview(today, today),
        opsOverview(weekBefore(today), weekBefore(today)).catch(() => null),
        opsSummary().catch(() => null),
      ])
      setNow(overview)
      setPrev(before)
      if (insights) setSum(insights)
      setAt(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดสรุปประจำวันไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [wantsSummary])

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
        <div className="ops-board">
          <div className="ops-board-main">
            <div className="ops-hero">
              <DayProgress data={now?.progress ?? null} />
              <FleetNow capacity={now?.capacity ?? null} />
            </div>

            {now && <KpiTiles kpis={now.kpis} prev={prev?.kpis ?? null} trend={now.kpi_trend} />}

            {now && (
              <section className="ops-panel">
                <div className="ops-panel-head">
                  <h2 className="ops-panel-title" title="ประมาณการคือค่าเฉลี่ย 4 สัปดาห์ล่าสุด แยกตามวันในสัปดาห์ · ขีดคร่อมคือช่วงที่เคยแกว่งจริง ไม่ใช่ช่วงความเชื่อมั่นทางสถิติ">
                    ปริมาณงาน
                  </h2>
                </div>
                <div className="ops-panel-body">
                  <VolumeChart chart={now.chart} capacity={now.capacity} />
                </div>
              </section>
            )}

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
          </div>

          <aside className="ops-board-rail">
            <InsightPanel headline={sum?.headline ?? ''} items={sum?.items ?? []} loading={loading} />

            {now && (
              <section className="ops-panel">
                <div className="ops-panel-head">
                  <h2 className="ops-panel-title" title="เหตุผลที่คนขับเลือกจากรายการที่มีอยู่จริง ไม่ใช่หมวดที่คิดขึ้นเอง">
                    ทำไมงานไม่จบในวัน
                  </h2>
                </div>
                <div className="ops-panel-body">
                  <CancelReasons rows={now.cancel_reasons} />
                </div>
              </section>
            )}
          </aside>
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
