import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import type { DashboardSummary, DailyInsight } from '../types'
import { useAuth } from '../context/AuthContext'
import { Badge, ErrorBox, Skeleton, TableSkeleton } from '../components/ui'
import { LineChart, DonutChart } from '../components/charts'
import { useCountUp } from '../hooks/useCountUp'
import { ORDER_STATUS_LABEL, ORDER_TONE, STATUS_CHART_COLORS, VEHICLE_STATUS_LABEL, DRIVER_STATUS_LABEL } from '../utils/constants'
import { fmtDateTime, fmtMoney, fmtNum } from '../utils/format'
import { IconSparkle } from '../components/icons'

/** เปรียบเทียบ 7 วันล่าสุด กับ 7 วันก่อนหน้า จาก data รายวัน */
function trendDelta(data: { d: string; count: number; revenue: number }[], pick: (p: { d: string; count: number; revenue: number }) => number): { dir: 'up' | 'down' | 'flat'; text: string } | undefined {
  if (data.length < 2) return undefined
  const a = data.slice(-7).reduce((s, p) => s + pick(p), 0)
  const b = data.slice(-14, -7).reduce((s, p) => s + pick(p), 0)
  if (b <= 0) return undefined
  const pct = Math.round(((a - b) / b) * 100)
  if (pct === 0) return { dir: 'flat', text: 'เท่าเดิม เทียบ 7 วันก่อน' }
  return { dir: pct > 0 ? 'up' : 'down', text: `${Math.abs(pct)}% ${pct > 0 ? 'เพิ่ม' : 'ลด'} เทียบ 7 วันก่อน` }
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return 'สวัสดีตอนดึก'
  if (h < 12) return 'สวัสดีตอนเช้า'
  if (h < 17) return 'สวัสดีตอนบ่าย'
  return 'สวัสดีตอนเย็น'
}

export default function Dashboard(): React.JSX.Element {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useApi<DashboardSummary>(() => api.get('/dashboard/summary'), [])
  const {
    data: insight,
    loading: insightLoading,
    error: insightError,
  } = useApi<DailyInsight>(() => api.get('/insights/daily'), [])

  // ตัวเลข count-up — เรียกก่อนเงื่อนไข return เพื่อไม่ผิดกฎ hooks
  const ordersToday = useCountUp(data?.kpis.orders_today ?? 0)
  const inTransit = useCountUp(data?.kpis.in_transit ?? 0)
  const deliveredMonth = useCountUp(data?.kpis.delivered_month ?? 0)

  if (error) return <ErrorBox message={error} onRetry={refetch} />
  if (loading || !data) return <PageSkeleton />

  const { kpis, trend, orders_by_status, vehicles_by_status, drivers_by_status, recent_orders } = data
  const statusSegments = orders_by_status.map((s) => ({
    label: ORDER_STATUS_LABEL[s.status as keyof typeof ORDER_STATUS_LABEL] ?? s.status,
    value: s.count,
    color: STATUS_CHART_COLORS[s.status] ?? '#9993ab',
  }))
  const trendData = trend.map((t) => ({ label: t.d, value: t.revenue }))

  const revenueTrend = trendDelta(trend, (p) => p.revenue)
  const deliveredTrend = trendDelta(trend, (p) => p.count)

  const vehicleTotal = vehicles_by_status.reduce((s, v) => s + v.count, 0)
  const driverTotal = drivers_by_status.reduce((s, v) => s + v.count, 0)
  const availableVehicles = vehicles_by_status.find((v) => v.status === 'available')?.count ?? 0
  const availableDrivers = drivers_by_status.find((d) => d.status === 'available')?.count ?? 0

  return (
    <>
      {/* North-star metric — สำคัญสุดบนซ้าย (F-pattern) */}
      <div className="dash-hero">
        <div>
          <div className="hero-greet">{greeting()}, {user?.name ?? 'ผู้ดูแลระบบ'}</div>
          {/* ไม่ซ้ำวันที่ตรงนี้ — topbar แสดงอยู่แล้วบรรทัดบน */}
          <div className="hero-sub">สรุปสถานะการขนส่งจากข้อมูลจริง</div>
        </div>
        <div className="hero-metric">
          <div className="metric-label">รายได้เดือนนี้</div>
          <div className="metric-value">
            {fmtNum(kpis.revenue_month)}
            <span className="metric-currency">฿</span>
          </div>
          {revenueTrend && (
            <span className={`metric-chip${revenueTrend.dir === 'down' ? ' down' : revenueTrend.dir === 'flat' ? ' flat' : ''}`}>
              {revenueTrend.dir === 'up' ? '▲' : revenueTrend.dir === 'down' ? '▼' : '•'} {revenueTrend.text}
            </span>
          )}
        </div>
      </div>

      {/* ชั้น 1 · ต้องตัดสินใจ — คิวงานมาก่อน KPI เสมอ */}
      <div className="section-head">
        <h2>คิวงานที่ต้องตัดสินใจ</h2>
      </div>

      {/* แถบเมตริกเดียว — 3 ตัวในหนึ่งการ์ด แบ่งด้วย hairline (ลดกล่อง = ลด visual complexity) */}
      <div className="card metrics-band">
        <div className="metric-cell">
          <div className="metric-label">ออเดอร์วันนี้ (กำหนดส่ง)</div>
          <div className="metric-num">{fmtNum(ordersToday)}</div>
          <div className="metric-foot">รอจัดคิว {fmtNum(kpis.pending)} ใบ</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">กำลังขนส่ง</div>
          <div className="metric-num">{fmtNum(inTransit)}</div>
          <div className={`metric-foot${kpis.urgent_unassigned > 0 ? ' warn' : ''}`}>ด่วนค้าง {fmtNum(kpis.urgent_unassigned)} ใบ</div>
        </div>
        <div className="metric-cell">
          <div className="metric-label">ส่งสำเร็จเดือนนี้</div>
          <div className="metric-num">{fmtNum(deliveredMonth)}</div>
          {deliveredTrend ? (
            <div className="metric-foot">
              <span className={deliveredTrend.dir === 'up' ? 'up' : deliveredTrend.dir === 'down' ? 'down' : 'flat'}>
                {deliveredTrend.dir === 'up' ? '▲' : deliveredTrend.dir === 'down' ? '▼' : '•'} {deliveredTrend.text}
              </span>
            </div>
          ) : (
            <div className="metric-foot">—</div>
          )}
        </div>
      </div>

      {/* AI สรุปประจำวัน — สังเคราะห์จากข้อมูลจริง + next-best-action (ตาม Attio/Hex) */}
      {!insightError && (
        <div className="card ai-card">
          <div className="card-title">
            <span className="ai-title">
              <IconSparkle size={16} /> AI สรุปประจำวัน
            </span>
            <span className="card-subtitle">คำนวณอัตโนมัติจากข้อมูลจริง · ไม่ใช้บริการภายนอก</span>
          </div>
          {insightLoading || !insight ? (
            <Skeleton height={96} />
          ) : (
            <>
              <div className="ai-headline">{insight.headline}</div>
              <div className="ai-list">
                {insight.items.map((item, i) => (
                  <div key={i} className={`ai-item ai-${item.tone}`}>
                    <div className="ai-item-main">
                      <b>{item.title}</b>
                      <span className="ai-detail">{item.detail}</span>
                    </div>
                    {item.action && (
                      <Link to={item.action.to} className="ai-action">
                        {item.action.label} →
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ชั้น 2 · แนวโน้ม */}
      <div className="section-head">
        <h2>แนวโน้ม</h2>
      </div>

      {/* Bento — กราฟรายได้ (กว้าง 2) + สัดส่วนสถานะ (แคบ) */}
      <div className="dash-bento">
        <div className="card bento-wide">
          <div className="card-title">
            รายได้ 30 วันล่าสุด
            <span className="card-subtitle">จากออเดอร์ที่ส่งสำเร็จ</span>
          </div>
          {trendData.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              <div>ยังไม่มีข้อมูลส่งสำเร็จในช่วงนี้</div>
            </div>
          ) : (
            <LineChart data={trendData} color="var(--accent)" formatValue={(v) => fmtMoney(v)} label="กราฟรายได้ 30 วันล่าสุด" />
          )}
        </div>

        <div className="card">
          <div className="card-title">สถานะออเดอร์ทั้งหมด</div>
          <DonutChart segments={statusSegments} centerValue={fmtNum(orders_by_status.reduce((s, x) => s + x.count, 0))} centerLabel="ออเดอร์" />
        </div>
      </div>

      {/* ชั้น 3 · เจาะรายหน่วย */}
      <div className="section-head">
        <h2>เจาะรายหน่วย</h2>
      </div>

      {/* Bento — ตารางออเดอร์ล่าสุด (กว้าง 2) + ความพร้อมทรัพยากร (แคบ) */}
      <div className="dash-bento">
        <div className="card bento-wide">
          <div className="card-title">
            ออเดอร์ล่าสุด
            <Link to="/orders" className="text-sm">ดูทั้งหมด →</Link>
          </div>
          {recent_orders.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>ยังไม่มีออเดอร์</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>เลขที่</th>
                    <th>ปลายทาง</th>
                    <th>สถานะ</th>
                    <th>สร้างเมื่อ</th>
                  </tr>
                </thead>
                <tbody>
                  {recent_orders.map((o) => (
                    <tr key={o.id}>
                      <td className="text-strong" style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{o.order_no}</td>
                      <td>{o.destination}</td>
                      <td><Badge label={ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL]} tone={ORDER_TONE[o.status as keyof typeof ORDER_TONE]} dot={o.status === 'in_transit'} /></td>
                      <td className="text-muted text-sm">{fmtDateTime(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">ความพร้อมของทรัพยากร</div>
          <ResourceBlock
            title="รถยนต์"
            unit="คัน"
            total={vehicleTotal}
            available={availableVehicles}
            rows={vehicles_by_status.map((v) => ({
              key: v.status,
              label: VEHICLE_STATUS_LABEL[v.status as keyof typeof VEHICLE_STATUS_LABEL] ?? v.status,
              count: v.count,
            }))}
          />
          <ResourceBlock
            title="พนักงานขับ"
            unit="คน"
            total={driverTotal}
            available={availableDrivers}
            rows={drivers_by_status.map((d) => ({
              key: d.status,
              label: DRIVER_STATUS_LABEL[d.status as keyof typeof DRIVER_STATUS_LABEL] ?? d.status,
              count: d.count,
            }))}
          />
        </div>
      </div>
    </>
  )
}

/** บล็อกความพร้อมทรัพยากร — ใช้ซ้ำกับทั้งรถและคนขับ (เดิมเขียน markup ซ้ำสองชุด) */
function ResourceBlock({
  title,
  unit,
  total,
  available,
  rows,
}: {
  title: string
  unit: string
  total: number
  available: number
  rows: { key: string; label: string; count: number }[]
}): React.JSX.Element {
  return (
    <div className="res-block">
      <div className="res-head">
        <span className="text-sm text-muted">{title} ({fmtNum(total)} {unit})</span>
        <b className="text-sm text-success">ว่าง {fmtNum(available)}</b>
      </div>
      <div className="capacity-bar">
        <div className="fill" style={{ width: `${Math.round((available / Math.max(1, total)) * 100)}%` }} />
      </div>
      <div className="res-list">
        {rows.map((r) => (
          <div key={r.key} className="res-row">
            <span className="text-muted">{r.label}</span>
            <b>{fmtNum(r.count)}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

function PageSkeleton(): React.JSX.Element {
  return (
    <>
      <div style={{ marginBottom: 20 }}><div className="skeleton" style={{ height: 84, borderRadius: 20 }} /></div>
      <div className="card" style={{ marginBottom: 20 }}><div className="skeleton" style={{ height: 88 }} /></div>
      <TableSkeleton rows={5} cols={5} />
    </>
  )
}
