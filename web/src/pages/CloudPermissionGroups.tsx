import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, ErrorBox, PageHeader, TableSkeleton } from '../components/ui'
import { listPermissionAudit, listPermissionCatalog, listRolePermissions, saveRolePermission } from '../api/users'
import { PERMISSION_INFO, ROLE_INFO } from '../utils/permissions'
import type { PermissionAuditRow, UserRole } from '../types/database'
import { fmtDateTime } from '../utils/format'

const ROLES: UserRole[] = ['admin', 'dispatcher', 'viewer', 'driver']

export default function CloudPermissionGroups(): React.JSX.Element {
  const [role, setRole] = useState<UserRole>('dispatcher')
  const [allowed, setAllowed] = useState<Set<string>>(new Set())
  const [available, setAvailable] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [audit, setAudit] = useState<PermissionAuditRow[]>([])
  /* ตัวนับแยกจากข้อความแจ้ง — ติ๊กสิทธิ์ตัวที่สองในกลุ่มเดิมได้ข้อความเดิมเป๊ะ
     ถ้าผูก effect ไว้กับข้อความ ประวัติจะค้างอยู่ที่รายการแรก */
  const [savedCount, setSavedCount] = useState(0)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const [catalog, current] = await Promise.all([listPermissionCatalog(), listRolePermissions(role)])
      setAvailable(catalog.map((p) => p.permission))
      setAllowed(new Set(current))
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'โหลดกลุ่มสิทธิ์ไม่สำเร็จ') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [role])
  useEffect(() => { void listPermissionAudit().then(setAudit).catch(() => undefined) }, [savedCount])

  const grouped = useMemo(() => {
    const source = PERMISSION_INFO.filter((p) => available.length === 0 || available.includes(p.permission))
    return source.reduce<Record<string, typeof source>>((acc, p) => { (acc[p.group] ??= []).push(p); return acc }, {})
  }, [available])

  const toggle = async (permission: string): Promise<void> => {
    if (role === 'admin') return
    const next = !allowed.has(permission)
    setBusy(permission)
    try {
      await saveRolePermission(role, permission, next)
      setAllowed((old) => { const copy = new Set(old); next ? copy.add(permission) : copy.delete(permission); return copy })
      setNotice(`อัปเดตสิทธิ์กลุ่ม${ROLE_INFO[role].label}แล้ว`)
      setSavedCount((n) => n + 1)
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'บันทึกสิทธิ์กลุ่มไม่สำเร็จ') }
    finally { setBusy(null) }
  }

  return <>
    {/* ปุ่มเลือกกลุ่มเคยอยู่ในการ์ดที่กินเต็มแถวเพื่อบรรจุปุ่มสี่ปุ่มกับคำอธิบายบรรทัดเดียว
        มันคือตัวสลับบริบทของทั้งหน้า ที่ของมันคือหัวหน้าจอ เหมือนตัวกรองของหน้าอื่น */}
    <PageHeader
      title="กลุ่มสิทธิ์"
      subtitle={ROLE_INFO[role].description}
      filters={ROLES.map((r) => (
        <Button key={r} variant={r === role ? 'primary' : 'outline'} size="sm" onClick={() => setRole(r)}>{ROLE_INFO[r].label}</Button>
      ))}
    />
    {error && <ErrorBox message={error} onRetry={() => void load()} />}
    {notice && <div role="status" style={{ padding: 10, marginBottom: 16, borderRadius: 8, color: 'var(--success)', background: 'var(--success-bg)' }}>{notice}</div>}

    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <div><h2 style={{ margin: 0, fontSize: 18 }}>สิทธิ์เริ่มต้นของกลุ่ม</h2><p className="text-sm text-muted" style={{ margin: '4px 0 0' }}>ผู้ใช้ที่ไม่ได้ตั้งค่าเฉพาะบุคคลจะใช้รายการนี้</p></div>
        {role === 'admin' && <Badge label="กลุ่มป้องกันการแก้ไข" tone="pending" />}
      </div>
      {loading ? <TableSkeleton rows={8} cols={2} /> : <div className="pgroup-grid">
      {Object.entries(grouped).map(([group, entries]) => {
        /* จำนวนที่เปิดอยู่ต่อหมวด — คำถามที่หน้านี้ถูกเปิดมาถามคือ "กลุ่มนี้ทำอะไรได้บ้าง"
           ซึ่งเดิมตอบได้ทางเดียวคืออ่านทุกบรรทัดแล้วนับกล่องติ๊กเอาเอง สามสิบกว่าบรรทัด
           ตัวเลขต่อหมวดตอบโครงสร้างทั้งหน้าได้โดยไม่ต้องอ่านรายการเลย */
        const on = entries.filter((p) => allowed.has(p.permission)).length
        return (
        <section key={group} className="pgroup">
          <h3 className="pgroup-head">
            {group}
            <span className={`pgroup-count${on === 0 ? ' is-none' : on === entries.length ? ' is-all' : ''}`}>
              {on}/{entries.length}
            </span>
          </h3>
          <div className="pgroup-list">
            {entries.map((p) => {
              const isOn = allowed.has(p.permission)
              return (
              /* สวิตช์อยู่ขวาสุดของการ์ด ไม่ใช่ซ้ายสุดของจอ ตาอ่านชื่อสิทธิ์ก่อนแล้วค่อย
                 ไปเจอคำตอบว่าเปิดหรือปิด ซึ่งเป็นลำดับเดียวกับที่คำถามถูกถามในหัว
                 และสวิตช์ทุกอันในหมวดอยู่แนวตั้งเดียวกัน กวาดคอลัมน์เดียวจบทั้งหมวด */
              <label key={p.permission} className={`pgroup-row${isOn ? ' is-on' : ''}`} data-locked={role === 'admin' ? '' : undefined}>
                <span className="pgroup-text"><b>{p.label}</b><small>{p.description}</small></span>
                <input type="checkbox" role="switch" checked={isOn} disabled={role === 'admin' || busy === p.permission} onChange={() => void toggle(p.permission)} />
              </label>
              )
            })}
          </div>
        </section>
        )
      })}
      </div>}
      <p className="text-xs text-muted" style={{ margin: 0 }}>สิทธิ์ผู้ใช้และการเปลี่ยนกลุ่มจะถูกตรวจสอบซ้ำในระบบ ไม่ได้พึ่งเฉพาะหน้าจอนี้</p>
    </div>
    <div className="card" style={{ padding: 18, marginTop: 16 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>ประวัติการเปลี่ยนสิทธิ์ล่าสุด</h2>
      {audit.length === 0 ? <p className="text-sm text-muted">ยังไม่มีรายการเปลี่ยนแปลง</p> : <div className="table-wrap"><table className="table ops-table"><thead><tr><th>การเปลี่ยนแปลง</th><th>สิทธิ์</th><th>ก่อนหน้า</th><th>หลังจากแก้</th><th>เวลา</th></tr></thead><tbody>{audit.map((row) => <tr key={row.id}><td>{row.action === 'role_permission_changed' ? `กลุ่ม ${ROLE_INFO[row.role as UserRole]?.label ?? row.role}` : row.action === 'user_permissions_reset' ? 'คืนค่าเริ่มต้นรายคน' : 'ปรับสิทธิ์รายคน'}</td><td>{row.permission ? (PERMISSION_INFO.find((p) => p.permission === row.permission)?.label ?? row.permission) : '—'}</td><td>{row.before_value ?? '—'}</td><td>{row.after_value ?? '—'}</td><td>{fmtDateTime(row.created_at)}</td></tr>)}</tbody></table></div>}
    </div>
  </>
}
