import { useCallback, useEffect, useState } from 'react'
import { Button, ErrorBox, PageHeader, TableSkeleton } from '../components/ui'
import { loadUsageStats, fmtBytes, PLAN, type UsageStats } from '../api/systemUsage'
import { useCloudAuth } from '../context/CloudAuthContext'
import { fmtDateTime } from '../utils/format'

/** สีของแถบ = ระยะห่างจากเพดาน ไม่ใช่ปริมาณ — 40 MB เป็นตัวเลขที่ไม่มีความหมาย
 *  จนกว่าจะรู้ว่าเพดานอยู่ที่ 500 MB สิ่งที่คนอ่านต้องรู้คือ "ยังเหลือเท่าไหร่" */
function tone(pct: number): string {
  if (pct >= 90) return 'danger'
  if (pct >= 70) return 'warning'
  return 'ok'
}

function Meter({
  label,
  used,
  limit,
  render,
  note,
}: {
  label: string
  used: number | null
  limit: number
  render: (n: number) => string
  note?: string
}): React.JSX.Element {
  /* used = null คือ "วัดจากที่นี่ไม่ได้" ไม่ใช่ "ศูนย์" — สองอย่างนี้ต่างกันคนละเรื่อง
     และการวาดแถบว่างเปล่าให้ค่าที่ไม่รู้ อ่านได้ว่ายังไม่ได้ใช้เลย ซึ่งชวนวางแผนผิด */
  const pct = used == null ? 0 : Math.min(100, (used / limit) * 100)
  return (
    <div className="quota-row">
      <div className="quota-head">
        <span className="quota-label">{label}</span>
        <span className="quota-value">
          {used == null ? <span className="text-muted">ยังวัดไม่ได้</span> : <b>{render(used)}</b>}
          <span className="text-muted"> / {render(limit)}</span>
        </span>
      </div>
      <div className={`quota-bar${used == null ? ' is-unknown' : ''}`}>
        <span className={`quota-fill is-${tone(pct)}`} style={{ width: `${used == null ? 100 : Math.max(pct, 0.6)}%` }} />
      </div>
      {note && <div className="text-xs text-muted quota-note">{note}</div>}
    </div>
  )
}

export default function CloudUsage(): React.JSX.Element {
  const { can } = useCloudAuth()
  const [data, setData] = useState<UsageStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try { setData(await loadUsageStats()); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'อ่านการใช้งานไม่สำเร็จ') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  if (!can('users.manage')) {
    return <div className="card" style={{ margin: 24, padding: 24, textAlign: 'center' }}><h2>ไม่มีสิทธิ์เปิดหน้านี้</h2></div>
  }

  const num = (n: number): string => n.toLocaleString('th-TH')

  return <>
    <PageHeader
      title="การใช้งานระบบ"
      subtitle={`เทียบกับเพดานแพลน ${PLAN.name} ของ Supabase — ใช้ตัดสินใจว่าเก็บข้อมูลย้อนหลังได้แค่ไหน`}
      actions={<Button variant="outline" loading={loading} onClick={() => void load()}>วัดใหม่</Button>}
    />
    {error && <ErrorBox message={error} onRetry={() => void load()} />}

    {!data ? <TableSkeleton rows={4} cols={2} /> : <>
      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <div className="quota-list">
          <Meter
            label="EGRESS"
            used={null}
            limit={PLAN.egressBytes}
            render={fmtBytes}
            note="นับที่ชั้นเครือข่ายของ Supabase ไม่ได้อยู่ในฐานข้อมูล — ดูตัวเลขจริงได้ที่ dashboard เท่านั้น"
          />
          <Meter label="DATABASE SIZE" used={data.db_bytes} limit={PLAN.dbBytes} render={fmtBytes} />
          <Meter
            label="MONTHLY ACTIVE USERS"
            used={data.mau_estimate}
            limit={PLAN.mau}
            render={num}
            note="นับจากการเข้าสู่ระบบล่าสุดย้อนหลัง 30 วัน — ใกล้เคียงของ Supabase แต่ไม่ใช่ตัวเดียวกัน"
          />
          <Meter label="FILE STORAGE" used={data.file_bytes} limit={PLAN.fileBytes} render={fmtBytes} />
        </div>
        <div className="text-xs text-muted" style={{ marginTop: 14 }}>
          วัดเมื่อ {fmtDateTime(data.measured_at)} · ไฟล์ในถังทั้งหมด {num(data.file_objects)} ไฟล์
        </div>
      </div>

      {/* ตัวเลขรวมบอกว่าใกล้เต็มหรือยัง ตารางนี้บอกว่าจะไปลดตรงไหน
          รวมขนาด index ไว้ด้วย เพราะ index กินโควตาเท่ากับข้อมูล */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ padding: '14px 18px 0' }}>
          <b>ตารางที่กินที่มากที่สุด</b>
          <div className="text-xs text-muted">รวมขนาด index แล้ว · จำนวนแถวเป็นค่าประมาณจากตัวนับของ Postgres</div>
        </div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>ตาราง</th><th className="num">ขนาด</th><th className="num">แถว (ประมาณ)</th></tr></thead>
          <tbody>{data.tables.map((t) => (
            <tr key={t.name}>
              <td><code>{t.name}</code></td>
              <td className="num">{fmtBytes(t.bytes)}</td>
              <td className="num">{t.approx_rows < 0 ? '—' : num(t.approx_rows)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>

      <div className="card">
        <div style={{ padding: '14px 18px 0' }}>
          <b>ไฟล์ในถัง</b>
          <div className="text-xs text-muted">รูปหลักฐานการส่งมอบคือของที่โตเร็วที่สุดในระบบนี้</div>
        </div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>ถัง</th><th className="num">จำนวนไฟล์</th><th className="num">ขนาดรวม</th></tr></thead>
          <tbody>{data.buckets.length === 0 ? (
            <tr><td colSpan={3} className="text-muted">ยังไม่มีไฟล์</td></tr>
          ) : data.buckets.map((b) => (
            <tr key={b.name}>
              <td><code>{b.name}</code></td>
              <td className="num">{num(b.objects)}</td>
              <td className="num">{fmtBytes(b.bytes)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </>}
  </>
}
