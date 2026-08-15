import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { api, downloadFile } from '../api/client'
import type { ReportsResult } from '../types'
import { useToast } from '../context/ToastContext'
import { Button, ErrorBox, Field, Input, PageHeader, TableSkeleton } from '../components/ui'
import { BarChart, DonutChart, LineChart } from '../components/charts'
import { ORDER_STATUS_LABEL, STATUS_CHART_COLORS } from '../utils/constants'
import { daysAgoIso, fmtMoney, fmtMonthLabel, fmtNum, todayIso } from '../utils/format'
import { IconDownload, IconPrinter } from '../components/icons'

/** ช่องตัวเลขในแถบเมตริก — ใช้แทนการ์ด KPI ใบเดี่ยว ๆ (4 การ์ด → 1 แถบ) */
function MetricCell({ label, value, foot, tone }: { label: string; value: string; foot?: string; tone?: 'up' | 'down' }): React.JSX.Element {
  return (
    <div className="metric-cell">
      <div className="metric-label">{label}</div>
      <div className="metric-num">{value}</div>
      {foot && <div className="metric-foot">{tone ? <span className={tone}>{foot}</span> : foot}</div>}
    </div>
  )
}

export default function Reports(): React.JSX.Element {
  const { push } = useToast()
  const [from, setFrom] = useState(daysAgoIso(29))
  const [to, setTo] = useState(todayIso())
  const [exporting, setExporting] = useState(false)

  const { data, loading, error, refetch } = useApi<ReportsResult>(
    () => api.get(`/reports?from=${from}&to=${to}`),
    [from, to],
  )

  const exportExcel = async (): Promise<void> => {
    setExporting(true)
    try {
      await downloadFile(`/reports/export?from=${from}&to=${to}`, `tms-report-${from}-${to}.xlsx`)
      push('success', 'ดาวน์โหลดไฟล์ Excel เรียบร้อย')
    } catch {
      push('error', 'ส่งออกรายงานไม่สำเร็จ')
    } finally {
      setExporting(false)
    }
  }

  if (error) return <ErrorBox message={error} onRetry={refetch} />

  return (
    <>
      <PageHeader title="รายงาน" subtitle="สรุปผลการดำเนินงานตามช่วงวันที่ — คำนวณอัตโนมัติจากข้อมูลจริง" />

      <div className="toolbar">
        <Field label="ตั้งแต่วันที่">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} />
        </Field>
        <Field label="ถึงวันที่">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} />
        </Field>
        <div className="spacer" />
        <Button variant="outline" size="sm" icon={<IconDownload size={14} />} onClick={exportExcel} loading={exporting}>Excel</Button>
        <Button variant="outline" size="sm" icon={<IconPrinter size={14} />} onClick={() => window.print()}>พิมพ์ PDF</Button>
      </div>

      {loading || !data ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
        <>
          {/* ชั้น 1 · สุขภาพองค์กร — 4 ตัวเลขในแถบเดียว (เดิมเป็นการ์ด 4 ใบ) */}
          <div className="section-head">
            <h2>สุขภาพองค์กร</h2>
          </div>

          <div className="card metrics-band metrics-band-4">
            <MetricCell
              label="ออเดอร์ทั้งหมด"
              value={fmtNum(data.kpis.total_orders)}
              foot={`ยกเลิก ${fmtNum(data.kpis.cancelled)} ใบ`}
            />
            <MetricCell
              label="ส่งสำเร็จ"
              value={fmtNum(data.kpis.delivered)}
              foot={`ตรงเวลา ${data.kpis.delivered ? Math.round((data.kpis.on_time / data.kpis.delivered) * 100) : 0}% · POD ${fmtNum(data.kpis.pod_collected)}/${fmtNum(data.kpis.delivered)} ใบ`}
            />
            <MetricCell label="รายได้" value={fmtMoney(data.kpis.revenue)} foot={`ค่าใช้จ่าย ${fmtMoney(data.kpis.costs)}`} />
            <MetricCell
              label="กำไรสุทธิ"
              value={fmtMoney(data.kpis.profit)}
              tone={data.kpis.profit >= 0 ? 'up' : 'down'}
              foot={data.kpis.avg_delivery_hours != null ? `เวลาส่งเฉลี่ย ${data.kpis.avg_delivery_hours} ชม.` : 'ยังไม่มีข้อมูล'}
            />
          </div>

          {/* ชั้น 2 · แนวโน้ม */}
          <div className="section-head">
            <h2>แนวโน้ม</h2>
          </div>

          <div className="dash-grid">
            <div className="card">
              <div className="card-title">
                ออเดอร์รายเดือน (12 เดือน)
                <span className="card-subtitle">เดือนไหนงานมาก/น้อย — ใช้วางกำลังคนและรถล่วงหน้า</span>
              </div>
              <BarChart data={data.monthly.map((m) => ({ label: fmtMonthLabel(m.month), value: m.count }))} color="var(--accent)" formatValue={(v) => fmtNum(v)} />
            </div>

            <div className="card">
              <div className="card-title">
                สัดส่วนสถานะออเดอร์
                <span className="card-subtitle">เขียว (ส่งสำเร็จ) ยิ่งมากยิ่งดี</span>
              </div>
              <DonutChart
                segments={data.by_status.map((s) => ({
                  label: ORDER_STATUS_LABEL[s.status as keyof typeof ORDER_STATUS_LABEL] ?? s.status,
                  value: s.count,
                  color: STATUS_CHART_COLORS[s.status] ?? '#9993ab',
                }))}
                centerValue={fmtNum(data.kpis.total_orders)}
                centerLabel="ออเดอร์"
              />
            </div>
          </div>

          <div className="card stack">
            <div className="card-title">
              รายได้รายเดือน (12 เดือน)
              <span className="card-subtitle">เห็นฤดูกาลของงานและผลของการตั้งราคา</span>
            </div>
            <LineChart data={data.monthly.map((m) => ({ label: fmtMonthLabel(m.month), value: m.revenue }))} color="var(--accent)" formatValue={(v) => fmtMoney(v)} label="กราฟรายได้รายเดือน 12 เดือน" />
          </div>

          {/* ชั้น 3 · เจาะรายหน่วย */}
          <div className="section-head">
            <h2>เจาะรายหน่วย</h2>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-title">ลูกค้าอันดับสูงสุด <span className="card-subtitle">ตามรายได้ — กลุ่มที่ควรดูแลเป็นพิเศษ</span></div>
              <div className="table-wrap card-flush">
                <table className="table">
                  <thead>
                    <tr><th>ลูกค้า</th><th className="num">ออเดอร์</th><th className="num">รายได้</th></tr>
                  </thead>
                  <tbody>
                    {data.top_customers.length === 0 && (
                      <tr><td colSpan={3}><div className="empty-state" style={{ padding: 24 }}>ไม่มีข้อมูลในช่วงนี้</div></td></tr>
                    )}
                    {data.top_customers.map((c) => (
                      <tr key={c.name}>
                        <td className="text-strong">{c.name}</td>
                        <td className="num">{fmtNum(c.orders)}</td>
                        <td className="num text-strong">{fmtMoney(c.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-title">เส้นทางยอดนิยม <span className="card-subtitle">ใช้ต่อรองราคา หรือวางเที่ยวรวมให้คุ้มน้ำมัน</span></div>
              <div className="table-wrap card-flush">
                <table className="table">
                  <thead>
                    <tr><th>เส้นทาง</th><th className="num">ออเดอร์</th><th className="num">รายได้</th></tr>
                  </thead>
                  <tbody>
                    {data.lanes.length === 0 && (
                      <tr><td colSpan={3}><div className="empty-state" style={{ padding: 24 }}>ไม่มีข้อมูลในช่วงนี้</div></td></tr>
                    )}
                    {data.lanes.map((l) => (
                      <tr key={`${l.origin}-${l.destination}`}>
                        <td>{l.origin} → {l.destination}</td>
                        <td className="num">{fmtNum(l.orders)}</td>
                        <td className="num text-strong">{fmtMoney(l.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card stack">
            <div className="card-title">
              ประสิทธิภาพพนักงานขับ <span className="card-subtitle">เที่ยวที่เสร็จสิ้น + อัตราตรงเวลาต่อคน</span>
            </div>
            <div className="table-wrap card-flush">
              <table className="table">
                <thead>
                  <tr>
                    <th>พนักงานขับ</th>
                    <th className="num">เที่ยว</th>
                    <th className="num">ออเดอร์</th>
                    <th className="num">ตรงเวลา</th>
                    <th className="num">อัตราตรงเวลา</th>
                    <th className="num">รายได้</th>
                    <th className="num">ค่าใช้จ่าย</th>
                  </tr>
                </thead>
                <tbody>
                  {data.driver_performance.length === 0 && (
                    <tr><td colSpan={7}><div className="empty-state" style={{ padding: 24 }}>ยังไม่มีเที่ยวเสร็จสิ้นในช่วงนี้</div></td></tr>
                  )}
                  {data.driver_performance.map((d) => (
                    <tr key={d.id}>
                      <td className="text-strong">{d.name}</td>
                      <td className="num">{fmtNum(d.trips)}</td>
                      <td className="num">{fmtNum(d.orders)}</td>
                      <td className="num">{fmtNum(d.on_time)}/{fmtNum(d.orders)}</td>
                      <td className="num">
                        <b className={d.orders > 0 && d.on_time / d.orders >= 0.8 ? 'text-success' : 'text-warning'}>
                          {d.orders > 0 ? `${Math.round((d.on_time / d.orders) * 100)}%` : '—'}
                        </b>
                      </td>
                      <td className="num text-strong">{fmtMoney(d.revenue)}</td>
                      <td className="num text-muted">{fmtMoney(d.costs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ชั้น 4 · วินิจฉัยฝ่ายขาย (CRM) */}
          <div className="section-head">
            <h2>วินิจฉัยฝ่ายขาย (CRM)</h2>
          </div>

          <div className="card metrics-band metrics-band-4">
            <MetricCell label="ใบเสนอราคา" value={fmtNum(data.crm.quotes.created)} foot="ตลอดช่วงวันที่เลือก" />
            <MetricCell
              label="อัตราแปลงเป็นออเดอร์"
              value={data.crm.quotes.conversion_rate != null ? `${data.crm.quotes.conversion_rate}%` : '—'}
              foot={`ยอมรับ ${fmtNum(data.crm.quotes.accepted)} · ปฏิเสธ ${fmtNum(data.crm.quotes.rejected)}`}
            />
            <MetricCell
              label="ลูกค้าใหม่"
              value={fmtNum(data.crm.new_vs_repeat.new_customers)}
              foot={`รายได้ ${fmtMoney(data.crm.new_vs_repeat.new_revenue)}`}
            />
            <MetricCell
              label="ลูกค้าซ้ำ"
              value={fmtNum(data.crm.new_vs_repeat.repeat_customers)}
              foot={`รายได้ ${fmtMoney(data.crm.new_vs_repeat.repeat_revenue)}`}
            />
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-title">ลูกค้าเสี่ยง <span className="card-subtitle">เงียบเกิน 30 วัน — โทรตามก่อนเสียให้คู่แข่ง</span></div>
              <div className="table-wrap card-flush">
                <table className="table">
                  <thead>
                    <tr><th>ลูกค้า</th><th>กลุ่ม</th><th className="num">เงียบ (วัน)</th><th className="num">รายได้รวม</th></tr>
                  </thead>
                  <tbody>
                    {data.crm.at_risk.length === 0 && (
                      <tr><td colSpan={4}><div className="empty-state" style={{ padding: 24 }}>ไม่มีลูกค้าเสี่ยงในช่วงนี้</div></td></tr>
                    )}
                    {data.crm.at_risk.map((c) => (
                      <tr key={c.id}>
                        <td className="text-strong">{c.name}</td>
                        <td>{c.segment ?? '—'}</td>
                        <td className="num"><b className="text-danger">{fmtNum(c.days_since)}</b></td>
                        <td className="num text-strong">{fmtMoney(c.total_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-title">ลูกค้าสร้างรายได้สูงสุด <span className="card-subtitle">8 อันดับ — เป้าหมายรักษาความสัมพันธ์ระยะยาว</span></div>
              <BarChart data={data.crm.customer_value.map((c) => ({ label: c.name, value: c.revenue }))} color="var(--accent)" formatValue={(v) => fmtMoney(v)} />
            </div>
          </div>
        </>
      )}
    </>
  )
}
