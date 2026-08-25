import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCloudAuth } from '../context/CloudAuthContext'
import { opsSummary, type OpsSummary } from '../api/opsInsights'
import { Badge, ErrorBox, PageHeader } from '../components/ui'
import { KpiBand } from '../components/ops/KpiBand'
import { InsightPanel } from '../components/ops/InsightPanel'
import { IconBox, IconRoute, IconTable, IconTruckBig } from '../components/icons'

/**
 * หน้าแรก — ศูนย์ควบคุม
 *
 * เดิมเป็นแค่แผงลิงก์: เปิดมาแล้วยังไม่รู้อะไรเลย ต้องเดาเองว่าวันนี้ควรเข้าหน้าไหนก่อน
 * ตอนนี้ตอบสามคำถามแรกของเช้าให้ตั้งแต่หน้าแรก — วันนี้มีกี่เที่ยว ออกไปแล้วกี่คัน
 * และมีอะไรค้างที่ต้องรีบ — แล้วค่อยปล่อยให้เลือกทางเข้าเหมือนเดิม
 *
 * การ์ดทางลัดเดิมยังอยู่ครบ ย้ายลงไปอยู่ล่างตัวเลข ไม่ได้ถูกแทนที่ เพราะเป็นทางเข้า
 * ที่คนใช้จนชินแล้ว
 *
 * คนที่สิทธิ์ไม่ถึงจะได้สรุปเฉพาะส่วนที่ตัวเองเห็น (opsSummary กลืน error ของแต่ละก้อน)
 * ไม่ใช่หน้าเปล่าหรือหน้าพัง
 */

/** โหลดใหม่ทุกหนึ่งนาที — ช้ากว่านี้แล้วตัวเลขบนหน้าแรกจะเก่ากว่าที่คนขับเห็นในแอป */
const REFRESH_MS = 60_000

export default function CloudHome(): React.JSX.Element {
  const { can, user } = useCloudAuth()
  const [sum, setSum] = useState<OpsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  /* เห็นแผนงานหรือออเดอร์ไม่ได้เลย = ไม่มีอะไรให้สรุป (คนขับที่หลงเข้ามาหน้านี้) */
  const wantsSummary = can('dispatch.view') || can('orders.view')

  const load = useCallback(async (): Promise<void> => {
    if (!wantsSummary) { setLoading(false); return }
    try {
      setSum(await opsSummary())
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
    can('dispatch.view') && { to: '/tms-trips', icon: IconTable, title: 'งานจาก TMS', desc: 'ข้อมูลไหลเข้าเองทุก 5 นาที — ตรวจเที่ยวแล้วสั่งงานได้ที่หน้าเดียว', label: 'เปิดงานจาก TMS', tone: 'accent' },
    can('dispatch.view') && { to: '/dispatch', icon: IconRoute, title: 'จัดแผนงาน', desc: 'ตรวจเที่ยว รถ คนขับ และลำดับงานก่อนปล่อยงาน', label: 'เปิดแผนงาน', tone: 'neutral' },
    can('orders.view') && { to: '/orders', icon: IconBox, title: 'ติดตามออเดอร์', desc: 'ดูว่างานอยู่ขั้นตอนไหนและมีอะไรต้องจัดการ', label: 'ดูออเดอร์', tone: 'neutral' },
    can('myjobs.view') && { to: '/my-jobs', icon: IconTruckBig, title: 'งานของฉัน', desc: 'เปิดเที่ยวที่ได้รับมอบหมายและเริ่มส่งงาน', label: 'เปิดงานของฉัน', tone: 'accent' },
  ].filter(Boolean) as Array<{ to: string; icon: React.ComponentType<{ size?: number }>; title: string; desc: string; label: string; tone: 'accent' | 'neutral' }>

  const k = sum?.kpis

  return (
    <>
      <PageHeader title={`สวัสดี${user?.name ? ` คุณ${user.name}` : ''}`} subtitle="ศูนย์ควบคุมงานขนส่ง — สรุปของวันนี้และทางเข้างานที่ต้องทำ" />

      {error && <ErrorBox message={error} onRetry={() => { void load() }} />}

      {wantsSummary && (
        <>
          <KpiBand cells={[
            { label: 'เที่ยววันนี้', value: k?.tripsToday ?? 0, unit: 'เที่ยว', foot: `จบแล้ว ${k?.doneToday ?? 0}` },
            { label: 'กำลังวิ่ง', value: k?.running ?? 0, unit: 'เที่ยว', foot: 'คนขับกดรับแล้ว', tone: 'success' },
            {
              label: 'รอคนขับกดรับ',
              value: k?.waitingAccept ?? 0,
              unit: 'เที่ยว',
              foot: (k?.waitingAccept ?? 0) > 0 ? 'ยังไม่ถึงมือคนขับ' : 'รับครบแล้ว',
              tone: (k?.waitingAccept ?? 0) > 0 ? 'warn' : undefined,
            },
            {
              label: 'รอจัดเที่ยว',
              value: k?.unassigned ?? 0,
              unit: 'ใบ',
              foot: (k?.stopsTotal ?? 0) > 0 ? `ส่งแล้ว ${k?.stopsDone}/${k?.stopsTotal} จุด` : 'ยังไม่มีจุดส่งของวันนี้',
              tone: (k?.unassigned ?? 0) > 0 ? 'warn' : undefined,
            },
          ]} />

          <InsightPanel headline={sum?.headline ?? ''} items={sum?.items ?? []} loading={loading} />
        </>
      )}

      <section className="ops-home-grid" aria-label="งานหลัก">
        {actions.map((action) => {
          const Icon = action.icon
          return <Link key={action.to} to={action.to} className={`ops-action-card ops-action-${action.tone}`}>
            <div className="ops-action-icon"><Icon size={22} /></div>
            <div className="ops-action-body"><h2>{action.title}</h2><p>{action.desc}</p></div>
            <Badge label={action.label} tone={action.tone === 'accent' ? 'accent' : 'neutral'} />
          </Link>
        })}
      </section>
      <div className="ops-home-note"><strong>ลำดับการทำงานแนะนำ</strong><span>งานจาก TMS → ตรวจแผนงาน → ปล่อยงานให้คนขับ</span></div>
    </>
  )
}
