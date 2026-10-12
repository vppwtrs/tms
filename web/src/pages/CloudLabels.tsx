import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listOrders } from '../api/orders'
import { useToast } from '../context/ToastContext'
import { Badge, Button, EmptyState, ErrorBox, Input, Modal, PageHeader, SearchInput, TableSkeleton } from '../components/ui'
import { IconDownload, IconPrinter, IconTable } from '../components/icons'
import { buildLabels, fitLabels, labelHtml, printLabels, type LabelStoreSummary, type LabelUnit } from '../utils/storeLabel'
import { groupOrders, tripLabelSources, type TripGroup } from '../utils/orderGroups'
import { doLockLabelGroups, parseDoLock, type DoLockRow } from '../utils/doLockImport'
import { fmtDate, todayIso } from '../utils/format'

/**
 * พิมพ์ฉลาก 50×35 มม. — แยกออกมาจากปุ่มบนหน้าออเดอร์ ให้พิมพ์ได้ทีละหลายเที่ยว
 *
 * สองแหล่ง:
 *   1. เที่ยวที่จัดแล้วในระบบ (ใบงานที่มีเที่ยว ไม่นับใบที่ยกเลิก)
 *   2. ไฟล์ DO-LOCK — รถ lock ที่ถูกตัดออกจากระบบไปแล้ว พิมพ์ย้อนหลังได้ ไม่เขียนลงฐาน
 */

type Tab = 'system' | 'import'

const logoUrl = (): string => new URL(`${import.meta.env.BASE_URL}vppw-mark.png`, window.location.href).href
const templateUrl = `${import.meta.env.BASE_URL}templates/LOCK-DO-template.xlsx`

function mergeSummary(all: LabelStoreSummary[]): LabelStoreSummary[] {
  const m = new Map<string, LabelStoreSummary>()
  for (const s of all) {
    const cur = m.get(s.store)
    if (!cur) { m.set(s.store, { ...s, models: [...s.models] }); continue }
    cur.total += s.total
    for (const md of s.models) {
      const hit = cur.models.find((x) => x.itemNo === md.itemNo && x.model === md.model)
      if (hit) hit.qty += md.qty
      else cur.models.push({ ...md })
    }
  }
  return [...m.values()]
}

export default function CloudLabels(): React.JSX.Element {
  const { push } = useToast()
  const [tab, setTab] = useState<Tab>('system')

  /* ---- จากระบบ ---- */
  const today = todayIso().slice(0, 10)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [q, setQ] = useState('')
  const [trips, setTrips] = useState<TripGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selTrips, setSelTrips] = useState<Set<string>>(new Set())

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const res = await listOrders({
        q: q || undefined,
        from: from ? `${from}T00:00:00` : undefined,
        to: to ? `${to}T23:59:59` : undefined,
        limit: 1000,
      })
      const live = res.rows.filter((r) => r.trip_id !== null && r.status !== 'cancelled')
      setTrips(groupOrders(live).filter((t) => buildLabels(t.tripNo, '', tripLabelSources(t)).units.length > 0))
      setSelTrips(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดเที่ยวไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [q, from, to])

  useEffect(() => {
    const t = setTimeout(() => void load(), 300)
    return () => clearTimeout(t)
  }, [load])

  const tripCount = (t: TripGroup): number => buildLabels(t.tripNo, '', tripLabelSources(t)).units.length

  /* ---- จากไฟล์ ---- */
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<DoLockRow[]>([])
  const [selRows, setSelRows] = useState<Set<number>>(new Set())
  const [dragOver, setDragOver] = useState(false)

  const readFile = async (file: File): Promise<void> => {
    try {
      const { Workbook } = await import('exceljs')
      const wb = new Workbook()
      await wb.xlsx.load(await file.arrayBuffer())
      const ws = wb.worksheets[0]
      if (!ws) { push('error', 'ไฟล์ไม่มีชีตข้อมูล'); return }
      const grid: unknown[][] = []
      ws.eachRow({ includeEmpty: false }, (r) => {
        const vals = r.values as unknown[]
        grid.push(vals.slice(1))
      })
      const { rows: parsed, missingCols } = parseDoLock(grid)
      if (missingCols.length) { push('error', `ไม่พบคอลัมน์: ${missingCols.join(', ')} — ใช้ template ของระบบ`); return }
      if (parsed.length === 0) { push('error', 'ไฟล์ไม่มีข้อมูล'); return }
      setFileName(file.name)
      setRows(parsed)
      setSelRows(new Set(parsed.filter((r) => r.errors.length === 0).map((r) => r.row)))
    } catch (e) {
      push('error', `อ่านไฟล์ไม่ได้ — ${(e as Error).message}`)
    }
  }

  const clearFile = (): void => {
    setFileName('')
    setRows([])
    setSelRows(new Set())
    if (fileRef.current) fileRef.current.value = ''
  }

  /* ---- รวมของที่จะพิมพ์ ---- */
  const plan = useMemo((): { units: LabelUnit[]; summary: LabelStoreSummary[] } => {
    const parts: { units: LabelUnit[]; summary: LabelStoreSummary[] }[] = []
    if (tab === 'system') {
      for (const t of trips) if (selTrips.has(t.key)) parts.push(buildLabels(t.tripNo, fmtDate(t.scheduled), tripLabelSources(t)))
    } else {
      /* ฉลาก LOCK-DO ใช้วันที่กดพิมพ์ ไม่ใช่วันในไฟล์ — เป็นวันที่รถออกจริง */
      const printDate = fmtDate(new Date().toISOString())
      const picked = rows.filter((r) => selRows.has(r.row) && r.errors.length === 0).map((r) => ({ ...r, date: printDate }))
      for (const g of doLockLabelGroups(picked)) parts.push(buildLabels(g.tripNo, g.date, g.stores))
    }
    return { units: parts.flatMap((p) => p.units), summary: mergeSummary(parts.flatMap((p) => p.summary)) }
  }, [tab, trips, selTrips, rows, selRows])

  const [done, setDone] = useState<LabelStoreSummary[] | null>(null)

  const doPrint = (): void => {
    if (plan.units.length === 0) return
    if (!printLabels(plan.units, logoUrl())) { push('error', 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาตป๊อปอัปของเว็บนี้ก่อน'); return }
    setDone(plan.summary)
  }

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const n = new Set(set)
    if (n.has(v)) n.delete(v)
    else n.add(v)
    return n
  }

  const okRows = rows.filter((r) => r.errors.length === 0)
  const badRows = rows.length - okRows.length
  const first = plan.units[0]

  return (
    <>
      <PageHeader
        title="พิมพ์ฉลาก"
        subtitle="ฉลาก 50×35 มม. หนึ่งดวงต่อรถหนึ่งคัน (TSC TX300)"
        actions={
          <Button variant="accent" icon={<IconPrinter size={16} />} disabled={plan.units.length === 0} onClick={doPrint}>
            พิมพ์ {plan.units.length > 0 ? `${plan.units.length} ดวง` : 'ฉลาก'}
          </Button>
        }
      />

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'system'} className={`tab${tab === 'system' ? ' is-on' : ''}`} onClick={() => setTab('system')}>
          จากเที่ยวในระบบ
        </button>
        <button role="tab" aria-selected={tab === 'import'} className={`tab${tab === 'import' ? ' is-on' : ''}`} onClick={() => setTab('import')}>
          Import LOCK-DO (Excel)
        </button>
      </div>

      <div className="lbl-page">
        <div>
          {tab === 'system' ? (
            <div className="card">
              <div className="lbl-filter">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} title="กำหนดส่ง ตั้งแต่" />
                <span className="text-muted">ถึง</span>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} title="ถึง" />
                <SearchInput value={q} onChange={setQ} placeholder="ค้นเลขทริป / PL / ร้าน..." />
              </div>
              {error ? <ErrorBox message={error} onRetry={() => void load()} /> : loading ? <TableSkeleton rows={5} cols={5} /> : trips.length === 0 ? (
                <EmptyState icon={<IconPrinter size={28} />} title="ไม่มีเที่ยวที่มีรถในช่วงนี้" desc="ลองเปลี่ยนช่วงวัน" />
              ) : (
                <div className="table-wrap">
                  <table className="table ops-table">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>
                          <input type="checkbox" aria-label="เลือกทุกเที่ยว"
                            checked={selTrips.size === trips.length}
                            onChange={(e) => setSelTrips(e.target.checked ? new Set(trips.map((t) => t.key)) : new Set())} />
                        </th>
                        <th>เลขทริป</th><th>วันที่</th><th>ร้าน</th><th className="text-right">รถ (คัน)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trips.map((t) => (
                        <tr key={t.key} onClick={() => setSelTrips((s) => toggle(s, t.key))} style={{ cursor: 'pointer' }}>
                          <td><input type="checkbox" aria-label={`เลือก ${t.tripNo}`} checked={selTrips.has(t.key)} onChange={() => setSelTrips((s) => toggle(s, t.key))} onClick={(e) => e.stopPropagation()} /></td>
                          <td className="text-strong">{t.tripNo}</td>
                          <td>{fmtDate(t.scheduled)}</td>
                          <td>{t.stores.map((s) => s.store).join(', ')}</td>
                          <td className="text-right">{tripCount(t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="card">
              <div className="lbl-filter">
                <b style={{ flex: 1 }}>รถ lock ที่ถูกตัดออกจากระบบ</b>
                <a className="btn btn-ghost btn-sm" href={templateUrl} download>
                  <IconDownload size={14} /> ดาวน์โหลด template
                </a>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f) }} />
              {rows.length === 0 ? (
                <div
                  className={`lbl-drop${dragOver ? ' is-over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) void readFile(f) }}
                >
                  <IconTable size={28} />
                  <div><b>ลากไฟล์ .xlsx มาวาง</b> หรือ</div>
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>เลือกไฟล์</Button>
                  <div className="text-xs text-muted">ไฟล์ LOCK-DO ของทีม TRS · ตรวจทุกแถวก่อนพิมพ์ · ไม่บันทึกลงระบบ</div>
                </div>
              ) : (
                <>
                  <div className="lbl-filter">
                    <b style={{ flex: 1 }}>{fileName}</b>
                    <Badge label={`ผ่าน ${okRows.length} แถว`} tone="success" />
                    {badRows > 0 && <Badge label={`ผิด ${badRows} แถว`} tone="urgent" />}
                    <Button variant="ghost" size="sm" onClick={clearFile}>ล้างไฟล์</Button>
                  </div>
                  <div className="table-wrap">
                    <table className="table ops-table">
                      <thead>
                        <tr>
                          <th style={{ width: 40 }}>
                            <input type="checkbox" aria-label="เลือกทุกแถวที่ผ่าน"
                              checked={okRows.length > 0 && selRows.size === okRows.length}
                              onChange={(e) => setSelRows(e.target.checked ? new Set(okRows.map((r) => r.row)) : new Set())} />
                          </th>
                          <th>ลำดับ</th><th>เลขตัวถัง</th><th>PL</th><th>วันที่ตัดจ่าย</th><th>ร้าน</th><th>ประเภทรถ</th><th>รุ่นรถ</th><th className="text-right">คัน</th><th>ตรวจ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => {
                          const ok = r.errors.length === 0
                          return (
                            <tr key={r.row}>
                              <td><input type="checkbox" aria-label={`เลือกแถว ${r.row}`} disabled={!ok} checked={selRows.has(r.row)} onChange={() => setSelRows((s) => toggle(s, r.row))} /></td>
                              <td className="text-muted" title={`แถว ${r.row} ใน Excel`}>{i + 1}</td>
                              <td className="text-strong">{r.chassis || '—'}</td>
                              <td>{r.pl || '—'}</td>
                              <td>{r.date || '—'}</td>
                              <td>{r.store || '—'}</td>
                              <td>{r.kind || '—'}</td>
                              <td>{r.model || '—'}</td>
                              <td className="text-right">{r.qty || '—'}</td>
                              <td>{ok ? <Badge label="ผ่าน" tone="success" /> : <Badge label={r.errors.join(', ')} tone="urgent" />}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {badRows > 0 && <p className="text-xs text-muted" style={{ padding: '8px 12px' }}>แถวที่ผิดจะไม่ถูกพิมพ์ — แก้ในไฟล์แล้ว import ใหม่</p>}
                </>
              )}
            </div>
          )}
        </div>

        <aside className="lbl-side">
          <div className="card lbl-total">
            <div className="text-muted">จะพิมพ์</div>
            <div><span className="lbl-total-num">{plan.units.length}</span> ดวง</div>
            {plan.summary.length > 0 && (
              <ul>
                {plan.summary.map((s) => <li key={s.store}><span>{s.store}</span><b>{s.total}</b></li>)}
              </ul>
            )}
          </div>
          <div className="card lbl-total">
            <div className="text-muted">ตัวอย่างฉลากดวงแรก</div>
            {/* ใช้ HTML ชุดเดียวกับที่ส่งพิมพ์ — ตัวอย่างต้องตรงกับดวงที่ออกจากเครื่องจริง */}
            {first ? (
              <iframe
                className="lbl-preview"
                title="ตัวอย่างฉลาก"
                srcDoc={labelHtml([first], logoUrl(), true)}
                onLoad={(e) => { const d = e.currentTarget.contentDocument; if (d) fitLabels(d) }}
              />
            ) : <p className="text-xs text-muted">เลือกรายการเพื่อดูตัวอย่าง</p>}
          </div>
        </aside>
      </div>

      <Modal
        open={done !== null}
        onClose={() => setDone(null)}
        title={done ? `ส่งพิมพ์แล้ว · ${done.reduce((n, s) => n + s.total, 0)} ดวง` : 'ฉลาก'}
        footer={<Button variant="accent" onClick={() => setDone(null)}>ปิด</Button>}
      >
        <div className="lbl-sum">
          {done?.map((s) => (
            <section key={s.store} className="lbl-sum-store">
              <div className="lbl-sum-head"><b>{s.store}</b><span>{s.total} คัน</span></div>
              <ul>
                {s.models.map((m) => <li key={`${m.itemNo}|${m.model}`}><span>{m.model}</span><b>× {m.qty}</b></li>)}
              </ul>
            </section>
          ))}
        </div>
      </Modal>
    </>
  )
}
