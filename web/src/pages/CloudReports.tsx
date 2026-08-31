import { useState } from 'react'
import { PageHeader, TabPanel, Tabs } from '../components/ui'
import { DayPicker } from '../components/ops/DayPicker'
import { OpsSummaryReport } from '../components/reports/OpsSummaryReport'
import { PickingListReport } from '../components/reports/PickingListReport'
import { ActualShipmentReport } from '../components/reports/ActualShipmentReport'
import { PlanSimulateReport } from '../components/reports/PlanSimulateReport'
import { fmtDate, todayIso, daysAgoIso } from '../utils/format'

/**
 * รายงาน — สี่แท็บ สองแหล่ง
 *
 * "สรุปงาน" อ่านจากฐานของเรา ส่วนอีกสามแท็บอ่าน**สดจาก TMS บริษัท** ผ่าน gateway
 * แบบอ่านอย่างเดียว ไม่เขียนอะไรกลับทั้งสองฝั่ง
 *
 * ช่วงวันอยู่บนหัวหน้าอันเดียว ใช้ร่วมกันทุกแท็บ — คนที่ดูรายงานหนึ่งแล้วสลับไปดู
 * อีกรายงานกำลังถามเรื่องช่วงเวลาเดียวกันเสมอ ถ้าแต่ละแท็บมีตัวเลือกวันของตัวเอง
 * การเทียบสองรายงานจะกลายเป็นการตั้งค่าซ้ำสองรอบและพลาดง่ายโดยไม่มีอะไรฟ้อง
 *
 * แท็บที่ยิง TMS **ไม่ดึงเองตอนเปิด** ต้องกดดึง — หนึ่งครั้งคือคำขอจริงข้ามประเทศ
 * ไปหาระบบที่คนทั้งบริษัทใช้อยู่
 */

type TabKey = 'summary' | 'picking' | 'actual' | 'plan'

const TAB_ITEMS: { key: TabKey; label: string }[] = [
  { key: 'summary', label: 'สรุปงาน (ระบบเรา)' },
  { key: 'picking', label: 'Picking List' },
  { key: 'plan', label: 'Plan Simulate' },
  { key: 'actual', label: 'Actual Shipment' },
]

export default function CloudReports(): React.JSX.Element {
  const [range, setRange] = useState({ from: daysAgoIso(29), to: todayIso() })
  const [tab, setTab] = useState<TabKey>('summary')

  return (
    <>
      <PageHeader
        title="รายงาน"
        subtitle={`${fmtDate(range.from)} – ${fmtDate(range.to)}`}
        filters={<DayPicker value={range} onChange={setRange} />}
      />

      <Tabs items={TAB_ITEMS} value={tab} onChange={(k) => setTab(k as TabKey)} idPrefix="reports" />

      <div style={{ marginTop: 16 }}>
        <TabPanel tabKey="summary" value={tab} idPrefix="reports">
          <OpsSummaryReport range={range} />
        </TabPanel>
        <TabPanel tabKey="picking" value={tab} idPrefix="reports">
          <PickingListReport range={range} />
        </TabPanel>
        <TabPanel tabKey="plan" value={tab} idPrefix="reports">
          <PlanSimulateReport range={range} />
        </TabPanel>
        <TabPanel tabKey="actual" value={tab} idPrefix="reports">
          <ActualShipmentReport range={range} />
        </TabPanel>
      </div>
    </>
  )
}
