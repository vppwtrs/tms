import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, ErrorBox, TableSkeleton } from '../components/ui'
import { listPermissionAudit, listPermissionCatalog, listRolePermissions, saveRolePermission } from '../api/users'
import { PERMISSION_INFO, ROLE_INFO } from '../utils/permissions'
import type { PermissionAuditRow, UserRole } from '../types/database'
import { fmtDateTime } from '../utils/format'

const ROLES: UserRole[] = ['admin', 'dispatcher', 'viewer', 'driver']

/**
 * สิทธิ์เริ่มต้นของกลุ่ม — เคยเป็นหน้าของตัวเองที่ `/permission-groups`
 *
 * เอามารวมเป็นแท็บในหน้าผู้ใช้และสิทธิ์ เพราะคำถามจริงคือ "คนนี้เปิดหน้านั้นได้ไหม"
 * ซึ่งตอบไม่ได้ถ้าดูแค่ด้านเดียว — กลุ่มคือค่าเริ่มต้น รายคนคือข้อยกเว้น
 * แยกเป็นสองหน้าแปลว่าต้องเด้งไปมาเพื่อตอบคำถามเดียว
 */
/* ชั้นบนของหมวดสิทธิ์ — เรียงตามเมนูข้างซ้าย ไม่ได้ตั้งใหม่
   เดิมหมวดทั้งเก้ากองอยู่ในตารางเดียวเรียงตามลำดับที่บังเอิญอยู่ใน PERMISSION_INFO
   ความสูงไม่เท่ากันเลยเหลือช่องว่างเป็นหลุม ๆ และไม่มีอะไรบอกว่าหมวดไหนพวกเดียวกัน
   คนที่เปิดหน้านี้คิดเป็นชั้น ("กลุ่มนี้แตะข้อมูลหลักได้ไหม") ไม่ได้คิดเป็นเก้ากล่อง */
const SECTIONS: { label: string; hint: string; groups: string[] }[] = [
  { label: 'ปฏิบัติการ', hint: 'งานประจำวันที่เกิดขึ้นบนหน้าจอ', groups: ['ภาพรวม', 'ออเดอร์', 'เที่ยวและการจัดส่ง', 'POD'] },
  { label: 'ข้อมูลหลัก', hint: 'ทะเบียนที่งานประจำวันหยิบไปใช้', groups: ['ลูกค้า', 'รถยนต์', 'พนักงานขับรถ'] },
  { label: 'งานของคนขับ', hint: 'สิทธิ์ที่ใช้ในแอปคนขับเท่านั้น', groups: ['งานของฉัน'] },
  { label: 'ระบบ', hint: 'สงวนให้ผู้ดูแลระบบ', groups: ['ผู้ใช้และสิทธิ์'] },
]

export function RolePermissionsPanel(): React.JSX.Element {
  const [role, setRole] = useState<UserRole>('dispatcher')
  const [allowed, setAllowed] = useState<Set<string>>(new Set())
  const [available, setAvailable] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'บันทึกสิทธิ์กลุ่มไม่สำเร็จ') }
    finally { setBusy(null) }
  }

  return <>
    {/* ตัวสลับกลุ่มเคยอยู่บนหัวหน้าตอนที่นี่ยังเป็นหน้าของตัวเอง ตอนนี้หัวหน้าเป็นของ
        หน้าผู้ใช้และสิทธิ์แล้ว ตัวสลับจึงลงมาอยู่บนสุดของแท็บ ซึ่งยังเป็นที่แรกที่ตากวาดถึง */}
    <div className="pgroup-switch">
      <div className="pgroup-switch-btns" role="group" aria-label="เลือกกลุ่มสิทธิ์">
        {ROLES.map((r) => (
          <Button key={r} variant={r === role ? 'primary' : 'outline'} size="sm" onClick={() => setRole(r)}>{ROLE_INFO[r].label}</Button>
        ))}
      </div>
      <p className="text-sm text-muted pgroup-switch-desc">{ROLE_INFO[role].description}</p>
    </div>
    {error && <ErrorBox message={error} onRetry={() => void load()} />}
    {notice && <div role="status" style={{ padding: 10, marginBottom: 16, borderRadius: 8, color: 'var(--success)', background: 'var(--success-bg)' }}>{notice}</div>}

    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <div><h2 style={{ margin: 0, fontSize: 18 }}>สิทธิ์เริ่มต้นของกลุ่ม</h2><p className="text-sm text-muted" style={{ margin: '4px 0 0' }}>ผู้ใช้ที่ไม่ได้ตั้งค่าเฉพาะบุคคลจะใช้รายการนี้</p></div>
        {role === 'admin' && <Badge label="กลุ่มป้องกันการแก้ไข" tone="pending" />}
      </div>
      {loading ? <TableSkeleton rows={8} cols={2} /> : <div className="pgroup-sections">
      {/* หมวดที่ยังไม่ถูกจัดชั้น (สิทธิ์ใหม่ที่เพิ่มใน PERMISSION_INFO แล้วลืมมาต่อที่นี่)
          ต้องยังโผล่ ไม่ใช่หายเงียบจนไม่มีใครรู้ว่ามันตั้งค่าไม่ได้ */}
      {[...SECTIONS, { label: 'อื่น ๆ', hint: 'ยังไม่ได้จัดหมวด', groups: Object.keys(grouped).filter((g) => !SECTIONS.some((x) => x.groups.includes(g))) }].map((section) => {
        /* หมวดที่ไม่มีสิทธิ์เหลือให้ตั้ง (catalog ตัดไปแล้ว) ต้องไม่เหลือหัวข้อลอยไว้ */
        const groups = section.groups.filter((g) => grouped[g]?.length)
        if (groups.length === 0) return null
        return (
        <section key={section.label} className="pgroup-band">
          <div className="pgroup-band-head">
            <h3 className="pgroup-band-title">{section.label}</h3>
            <span className="text-xs text-muted">{section.hint}</span>
          </div>
          <div className="pgroup-grid">
          {groups.map((group) => {
        const entries = grouped[group]!
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
          </div>
        </section>
        )
      })}
      </div>}
      <p className="text-xs text-muted" style={{ margin: 0 }}>สิทธิ์ผู้ใช้และการเปลี่ยนกลุ่มจะถูกตรวจสอบซ้ำในระบบ ไม่ได้พึ่งเฉพาะหน้าจอนี้</p>
    </div>
  </>
}

/**
 * ประวัติการเปลี่ยนสิทธิ์ — แท็บของตัวเอง
 *
 * เดิมต่อท้ายตารางสิทธิ์กลุ่มในหน้าเดียวกัน ซึ่งแปลว่าต้องเลื่อนผ่านสามสิบกว่าบรรทัด
 * ทุกครั้งที่อยากรู้แค่ว่าใครแก้อะไรไป และมันตอบคนละคำถามกับตารางข้างบน
 */
export function PermissionAuditPanel(): React.JSX.Element {
  const [audit, setAudit] = useState<PermissionAuditRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = (): void => {
    listPermissionAudit()
      .then((rows) => { setAudit(rows); setError(null) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'โหลดประวัติไม่สำเร็จ'))
  }
  useEffect(load, [])

  if (error) return <ErrorBox message={error} onRetry={load} />
  if (!audit) return <TableSkeleton rows={5} cols={5} />

  return (
    <div className="card" style={{ padding: 18 }}>
      {audit.length === 0 ? (
        <p className="text-sm text-muted">
          ยังไม่มีรายการเปลี่ยนแปลง — การแก้สิทธิ์ทุกครั้งจะถูกบันทึกไว้ที่นี่พร้อมค่าก่อนและหลัง
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table ops-table">
            <thead>
              <tr><th>การเปลี่ยนแปลง</th><th>สิทธิ์</th><th>ก่อนหน้า</th><th>หลังจากแก้</th><th>เวลา</th></tr>
            </thead>
            <tbody>
              {audit.map((row) => (
                <tr key={row.id}>
                  <td>{row.action === 'role_permission_changed'
                    ? `กลุ่ม ${ROLE_INFO[row.role as UserRole]?.label ?? row.role}`
                    : row.action === 'user_permissions_reset' ? 'คืนค่าเริ่มต้นรายคน' : 'ปรับสิทธิ์รายคน'}</td>
                  <td>{row.permission
                    ? (PERMISSION_INFO.find((p) => p.permission === row.permission)?.label ?? row.permission)
                    : '—'}</td>
                  <td>{row.before_value ?? '—'}</td>
                  <td>{row.after_value ?? '—'}</td>
                  <td>{fmtDateTime(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
