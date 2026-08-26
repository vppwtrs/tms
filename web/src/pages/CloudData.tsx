import { useCallback, useEffect, useState } from 'react'
import { Button, EmptyState, ErrorBox, PageHeader, TableSkeleton } from '../components/ui'
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
    /* บอกด้วยว่าต้องมีสิทธิ์อะไรและขอจากใคร — ข้อความว่า "ไม่มีสิทธิ์" เฉย ๆ
       ทำให้คนไปเดาว่าระบบพัง แล้วแจ้งมาเป็นบั๊ก ทั้งที่มันทำงานถูกแล้ว */
    return (
      <div className="card" style={{ margin: 24, padding: 24 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>ไม่มีสิทธิ์เปิดหน้านี้</h2>
        <p className="text-sm text-muted" style={{ margin: 0 }}>
          หน้านี้ต้องมีสิทธิ์ <b>จัดการผู้ใช้</b> ติดต่อผู้ดูแลระบบเพื่อขอเปิดให้
        </p>
      </div>
    )
  }

  return <>
    {/* ปุ่มรีเฟรชเคยอยู่ในการ์ดของตัวเองที่กินเต็มแถวเพื่อบรรจุปุ่มเดียว
        มันคือการกระทำของทั้งหน้า ที่ของมันคือหัวหน้าจอเหมือนปุ่มหลักของหน้าอื่น */}
    <PageHeader
      title="ข้อมูลระบบ"
      subtitle="ตรวจสอบข้อมูลที่เว็บใช้งานอยู่จาก Supabase ของเรา"
      actions={<Button variant="outline" size="sm" loading={loading} onClick={() => void load()}>รีเฟรช</Button>}
    />
    {error && <ErrorBox message={error} onRetry={() => void load()} />}
    {/* คำอธิบายว่าตารางข้างล่างอ่านยังไง กับกล่องชุดข้อมูลทดสอบ วางเคียงกัน
        ทั้งคู่เป็นของประกอบของตารางเดียวกัน การซ้อนกันลงล่างทำให้ตารางจริง
        ถูกดันตกจอทั้งที่ทั้งสองกล่องรวมกันยังใช้ความกว้างไม่ถึงครึ่ง */}
    <div className="data-tools">
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconTable size={18} />
        <div><b>ภาพรวมข้อมูล</b><div className="text-xs text-muted">ตารางด้านล่างเป็นตัวเลขอย่างเดียว ปุ่มที่ลบได้มีเฉพาะชุดข้อมูลทดสอบ</div></div>
      </div>
    </div>
    <div className="card" style={{ padding: 18, borderLeft: '3px solid var(--warning)' }}>
      <b>ชุดข้อมูลทดสอบ</b>
      <p className="text-xs text-muted" style={{ margin: '6px 0 12px' }}>ระบบจะสร้างและจำเฉพาะรายการที่สร้างจากปุ่มนี้ การล้างจะไม่แตะข้อมูลจริงหรือข้อมูลจาก TMS</p>
      {/* สองข้อนี้เคยกินเวลาไล่หาจริงมาแล้ว เขียนไว้บนปุ่มดีกว่าให้คนไปเจอเอง
          ข้อแรก: ของที่สร้างมาใช้ไม่ได้ทันที ข้อสอง: ปุ่มล้างไม่ได้ล้างทุกอย่างที่เกิดตอนทดสอบ */}
      <ul className="text-xs text-muted" style={{ margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.75 }}>
        <li>รถที่สร้างมาเป็นสถานะ <b>ไม่ใช้งาน</b> และคนขับเป็น <b>พักงาน</b> — ต้องเปลี่ยนสถานะเองก่อน ไม่งั้นจะไม่ขึ้นในฟอร์มสร้างเที่ยว</li>
        <li>ปุ่มล้าง<b>ไม่ลบ</b>ออเดอร์กับเที่ยวที่เกิดระหว่างทดสอบ ต้องลบเที่ยวด้วย “ลบถาวร” บนการ์ดก่อน แล้วค่อยกดล้าง</li>
      </ul>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="outline" loading={datasetBusy} onClick={() => void datasetAction('seed')}>สร้างชุดข้อมูลทดสอบ</Button>
        <Button variant="outline" loading={datasetBusy} onClick={() => { if (window.confirm('ล้างเฉพาะชุดข้อมูลทดสอบที่ระบบสร้างไว้ใช่ไหม')) void datasetAction('clear') }}>ล้างชุดข้อมูลทดสอบ</Button>
      </div>
    </div>
    </div>
    {!data ? <TableSkeleton rows={8} cols={3} /> : data.length === 0 ? (
      /* ตารางว่างที่ไม่มีคำอธิบายอ่านออกมาว่าระบบพัง ทั้งที่คำตอบคือยังไม่เคยมีข้อมูลเข้ามา */
      <div className="card">
        <EmptyState
          icon={<IconTable size={40} />}
          title="ยังอ่านจำนวนรายการไม่ได้"
          desc="ยังไม่มีตารางไหนตอบกลับมา ลองกดรีเฟรชอีกครั้ง ถ้ายังเหมือนเดิมแปลว่าติดต่อฐานข้อมูลไม่ได้"
          action={<Button variant="outline" loading={loading} onClick={() => void load()}>รีเฟรช</Button>}
        />
      </div>
    ) : <div className="card"><div className="table-wrap"><table className="table ops-table">
      <thead><tr><th>ชุดข้อมูล</th><th>ตาราง</th><th className="num">จำนวนรายการ</th></tr></thead>
      <tbody>{data.map((row) => <tr key={row.table}><td><b>{row.label}</b></td><td><code>{row.table}</code></td><td className="num">{row.count.toLocaleString('th-TH')}</td></tr>)}</tbody>
    </table></div></div>}
  </>
}
