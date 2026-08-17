import { useCallback, useEffect, useState } from 'react'
import { Button, ErrorBox, PageHeader, TableSkeleton } from '../components/ui'
import { loadDataSummary, type DataSummary } from '../api/systemData'
import { useCloudAuth } from '../context/CloudAuthContext'
import { IconTable } from '../components/icons'
import { manageTestDataset } from '../api/testDataset'

export default function CloudData(): React.JSX.Element {
  const { can } = useCloudAuth()
  const [data, setData] = useState<DataSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [datasetBusy, setDatasetBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try { setData(await loadDataSummary()); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'โหลดสรุปข้อมูลไม่สำเร็จ') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const datasetAction = async (action: 'seed' | 'clear'): Promise<void> => {
    setDatasetBusy(true)
    try { await manageTestDataset(action); setError(null); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'จัดการชุดข้อมูลทดสอบไม่สำเร็จ') }
    finally { setDatasetBusy(false) }
  }

  if (!can('users.manage')) {
    return <div className="card" style={{ margin: 24, padding: 24, textAlign: 'center' }}><h2>ไม่มีสิทธิ์เปิดหน้านี้</h2></div>
  }

  return <>
    <PageHeader title="ข้อมูลระบบ" subtitle="ตรวจสอบข้อมูลที่เว็บใช้งานอยู่จาก Supabase ของเรา" />
    {error && <ErrorBox message={error} onRetry={() => void load()} />}
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconTable size={18} />
        <div><b>ภาพรวมข้อมูล</b><div className="text-xs text-muted">หน้านี้เป็นแบบตรวจสอบอย่างเดียว ยังไม่มีการล้างข้อมูลจริง</div></div>
        <Button variant="outline" size="sm" loading={loading} onClick={() => void load()} style={{ marginLeft: 'auto' }}>รีเฟรช</Button>
      </div>
    </div>
    <div className="card" style={{ padding: 18, marginBottom: 18, borderLeft: '3px solid var(--warning)' }}>
      <b>ชุดข้อมูลทดสอบ</b>
      <p className="text-xs text-muted" style={{ margin: '6px 0 12px' }}>ระบบจะสร้างและจำเฉพาะรายการที่สร้างจากปุ่มนี้ การล้างจะไม่แตะข้อมูลจริงหรือข้อมูลจาก TMS</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="outline" loading={datasetBusy} onClick={() => void datasetAction('seed')}>สร้างชุดข้อมูลทดสอบ</Button>
        <Button variant="outline" loading={datasetBusy} onClick={() => { if (window.confirm('ล้างเฉพาะชุดข้อมูลทดสอบที่ระบบสร้างไว้ใช่ไหม')) void datasetAction('clear') }}>ล้างชุดข้อมูลทดสอบ</Button>
      </div>
    </div>
    {!data ? <TableSkeleton rows={8} cols={3} /> : <div className="card"><div className="table-wrap"><table className="table">
      <thead><tr><th>ชุดข้อมูล</th><th>ตาราง</th><th className="num">จำนวนรายการ</th></tr></thead>
      <tbody>{data.map((row) => <tr key={row.table}><td><b>{row.label}</b></td><td><code>{row.table}</code></td><td className="num">{row.count.toLocaleString('th-TH')}</td></tr>)}</tbody>
    </table></div></div>}
  </>
}
