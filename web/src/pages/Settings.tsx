import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import type { Settings } from '../types'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { Button, ErrorBox, Field, Input, PageHeader, TableSkeleton } from '../components/ui'
import { IconGear, IconShield } from '../components/icons'

/* จัดการผู้ใช้/สิทธิ์ ย้ายไปหน้า "ผู้ใช้และสิทธิ์" (/users) แล้ว
   หน้านี้เหลือสองเรื่องที่ไม่เกี่ยวกัน: ตั้งค่าองค์กร กับ รหัสผ่านของตัวเอง */
export default function SettingsPage(): React.JSX.Element {
  const { can } = useAuth()
  const { push } = useToast()
  const canManage = can('settings.manage')

  const settingsApi = useApi<Settings>(() => api.get('/settings'), [])
  const settings = settingsApi.data

  // ---------- ตั้งค่าองค์กร ----------
  const [org, setOrg] = useState<string | null>(null)
  const [symbol, setSymbol] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const orgName = org ?? settings?.org_name ?? ''
  const curSymbol = symbol ?? settings?.currency_symbol ?? '฿'

  const saveOrg = async (): Promise<void> => {
    setSaving(true)
    try {
      await api.put('/settings', { org_name: orgName, currency_symbol: curSymbol })
      push('success', 'บันทึกการตั้งค่าเรียบร้อย')
      settingsApi.refetch()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  // ---------- เปลี่ยนรหัสผ่านของตัวเอง ----------
  const [pw, setPw] = useState({ old_password: '', new_password: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const changePassword = async (): Promise<void> => {
    if (!pw.old_password || !pw.new_password) {
      push('warning', 'กรอกรหัสผ่านเดิมและรหัสผ่านใหม่')
      return
    }
    setPwSaving(true)
    try {
      await api.post('/auth/change-password', pw)
      push('success', 'เปลี่ยนรหัสผ่านเรียบร้อย')
      setPw({ old_password: '', new_password: '' })
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ')
    } finally {
      setPwSaving(false)
    }
  }

  if (settingsApi.error) return <ErrorBox message={settingsApi.error} onRetry={settingsApi.refetch} />

  return (
    <>
      {/* ชื่อหน้าเปลี่ยนตามสิ่งที่ผู้ใช้ทำได้จริง — คนที่แก้ตั้งค่าองค์กรไม่ได้
          ไม่ควรถูกพาเข้าหน้าชื่อ "ตั้งค่าระบบ" ที่มีของให้ทำอยู่อย่างเดียว */}
      <PageHeader
        title={canManage ? 'ตั้งค่าระบบ' : 'บัญชีของฉัน'}
        subtitle={canManage ? 'ข้อมูลองค์กร และรหัสผ่านของบัญชีคุณเอง' : 'เปลี่ยนรหัสผ่านของบัญชีคุณ'}
      />

      {settingsApi.loading || !settings ? (
        <TableSkeleton rows={4} cols={3} />
      ) : (
        <div className="grid-2">
          {/* ไม่มีสิทธิ์ = ไม่แสดงเลย ไม่ใช่แสดงแบบกดไม่ได้
              ช่องที่กรอกไม่ได้ยังบอกอยู่ดีว่าองค์กรตั้งค่าอะไรไว้ และกินที่เปล่า ๆ */}
          {canManage && (
            <div className="card">
              <div className="card-title">
                <IconGear size={18} /> ข้อมูลองค์กร
              </div>
              <div className="form-grid">
                <Field label="ชื่อองค์กร / บริษัท" required>
                  <Input value={orgName} onChange={(e) => setOrg(e.target.value)} />
                </Field>
                <Field label="สัญลักษณ์เงิน">
                  <Input value={curSymbol} onChange={(e) => setSymbol(e.target.value)} style={{ width: 100 }} />
                </Field>
              </div>
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="primary" onClick={saveOrg} loading={saving}>
                  บันทึกการตั้งค่า
                </Button>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-title">เปลี่ยนรหัสผ่านของฉัน</div>
            <div className="form-grid">
              <Field label="รหัสผ่านเดิม" required>
                <Input type="password" value={pw.old_password} onChange={(e) => setPw((p) => ({ ...p, old_password: e.target.value }))} autoComplete="current-password" />
              </Field>
              <Field label="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)" required>
                <Input type="password" value={pw.new_password} onChange={(e) => setPw((p) => ({ ...p, new_password: e.target.value }))} autoComplete="new-password" />
              </Field>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="primary" onClick={changePassword} loading={pwSaving}>
                เปลี่ยนรหัสผ่าน
              </Button>
            </div>
          </div>

          {can('users.manage') && (
            <div className="card">
              <div className="card-title">
                <IconShield size={18} /> บัญชีผู้ใช้และสิทธิ์
                <span className="card-subtitle">ย้ายไปอยู่หน้าแยกแล้ว — เพิ่มผู้ใช้ ตั้งบทบาท และกำหนดสิทธิ์รายข้อได้ที่นั่น</span>
              </div>
              <Link to="/users" className="btn btn-outline">
                ไปหน้าผู้ใช้และสิทธิ์
              </Link>
            </div>
          )}
        </div>
      )}
    </>
  )
}
