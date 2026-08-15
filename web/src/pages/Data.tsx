import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import type { CsvStatus } from '../types'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, ErrorBox, PageHeader, TableSkeleton } from '../components/ui'
import { IconDownload, IconTable } from '../components/icons'

const fmtTime = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const fmtSize = (b: number | null): string => {
  if (b === null || b === 0) return '—'
  return b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`
}

export default function DataPage(): React.JSX.Element {
  const { user } = useAuth()
  const { push } = useToast()
  const canWrite = user?.role !== 'viewer'

  const api2 = useApi<CsvStatus>(() => api.get('/csv/status'), [])
  const [busy, setBusy] = useState(false)

  // อัปเดตอัตโนมัติทุก 5 วิ — เห็นสถานะ/ขนาดไฟล์ล่าสุด
  useEffect(() => {
    const t = setInterval(() => api2.refetch(), 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** ดาวน์โหลดไฟล์ export (ต้องล็อกอิน — สร้าง blob จาก fetch พร้อม token) */
  const download = async (file: string): Promise<void> => {
    try {
      const token = localStorage.getItem('tms_token')
      const res = await fetch(`/api/csv/download/${encodeURIComponent(file)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('ดาวน์โหลดไม่สำเร็จ')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'ดาวน์โหลดไม่สำเร็จ')
    }
  }

  /** เขียนไฟล์ export ทั้งหมดใหม่จากข้อมูลล่าสุด (บังคับ — ปกติระบบทำอัตโนมัติอยู่แล้ว) */
  const refresh = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await api.post<{ files: unknown[] }>('/csv/export')
      push('success', `เขียนไฟล์ CSV ใหม่ครบ ${(res.files ?? []).length} ไฟล์ (ข้อมูลจากระบบล่าสุด)`)
      api2.refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  if (api2.error) return <ErrorBox message={api2.error} onRetry={api2.refetch} />

  const tables = api2.data?.tables ?? []

  return (
    <>
      <PageHeader
        title="ข้อมูล CSV"
        subtitle="ข้อมูลจริงเก็บในฐานข้อมูลและจัดการผ่านหน้าเว็บ — ไฟล์ CSV เป็นไฟล์ส่งออก (export) สำหรับเปิดใน Excel / วิเคราะห์ต่อ"
      />

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">
          <IconTable size={18} /> วิธีทำงาน
          <span className="card-subtitle">โฟลเดอร์: <code style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{api2.data?.csvDir ?? 'server/data/csv'}</code></span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          <div className="csv-step">
            <div className="csv-step-num">1</div>
            <div>
              <strong>จัดการที่หน้าเว็บ</strong>
              <p className="text-muted" style={{ margin: '4px 0 0' }}>ข้อมูลจริงอยู่ที่ฐานข้อมูล — เพิ่ม/แก้/ลบผ่านหน้าเว็บเท่านั้น (แหล่งข้อมูลเดียว)</p>
            </div>
          </div>
          <div className="csv-step">
            <div className="csv-step-num">2</div>
            <div>
              <strong>ระบบเขียนไฟล์ให้อัตโนมัติ</strong>
              <p className="text-muted" style={{ margin: '4px 0 0' }}>ทุกครั้งที่ข้อมูลเปลี่ยน ไฟล์ CSV จะถูกเขียนใหม่ให้ตรงกับระบบ (ทุก 3 วิ)</p>
            </div>
          </div>
          <div className="csv-step">
            <div className="csv-step-num">3</div>
            <div>
              <strong>กดดาวน์โหลด / เปิดใน Excel</strong>
              <p className="text-muted" style={{ margin: '4px 0 0' }}>กดปุ่มดาวน์โหลดข้างไฟล์ หรือเปิดโฟลเดอร์นี้ — นำไปวิเคราะห์/ส่งต่อได้เลย</p>
            </div>
          </div>
        </div>
        <p className="text-muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          ⚠️ การแก้ไขไฟล์ CSV ตรง ๆ จะถูกเขียนทับกลับด้วยข้อมูลจากระบบภายในไม่กี่วินาที — ถ้าต้องการแก้ข้อมูล ให้แก้ที่หน้าเว็บ
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          ไฟล์ส่งออก (export)
          <span className="card-subtitle">ตรวจสอบทุก 5 วินาที</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <Button variant="ghost" onClick={refresh} loading={busy} disabled={!canWrite}>
              เขียนไฟล์ใหม่จากข้อมูลล่าสุด
            </Button>
          </div>
        </div>

        {!api2.data ? (
          <TableSkeleton rows={9} cols={6} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ไฟล์</th>
                    <th>ใช้กับ</th>
                    <th className="num">แถว</th>
                    <th className="num">ขนาด</th>
                    <th>อัปเดตล่าสุด</th>
                    <th>ดาวน์โหลด</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((t) => (
                    <tr key={t.table}>
                      <td>
                        <code style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 }}>{t.file}</code>
                      </td>
                      <td>
                        <strong>{t.title}</strong>
                        <div className="text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{t.description}</div>
                      </td>
                      <td className="num">{t.rows}</td>
                      <td className="num">{fmtSize(t.fileSize)}</td>
                      <td className="text-muted" style={{ fontSize: 12.5 }}>{fmtTime(t.lastExport)}</td>
                      <td>
                        <Button variant="ghost" size="sm" className="btn-icon" onClick={() => download(t.file)} title={`ดาวน์โหลด ${t.file}`} aria-label={`ดาวน์โหลด ${t.file}`}>
                          <IconDownload size={16} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              💡 เปิด <code style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{api2.data?.csvDir ?? 'server/data/csv'}/README.md</code> เพื่อดูว่าแต่ละไฟล์เก็บอะไร (ไฟล์มี BOM + CRLF — เปิดใน Excel เห็นภาษาไทยถูกต้อง)
            </p>
          </>
        )}
      </div>
    </>
  )
}
