import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import type { ManagedUser, PermissionCatalog, Role } from '../types'
import { ROLE_LABEL } from '../utils/constants'
import { fmtDate } from '../utils/format'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  TableSkeleton,
  Toggle,
} from '../components/ui'
import { IconKey, IconPlus, IconShield, IconTrash, IconUsers } from '../components/icons'

const ROLE_TONE: Record<Role, string> = { admin: 'accent', dispatcher: 'warning', viewer: 'neutral', driver: 'success' }

/** สรุปสิทธิ์เป็นประโยคเดียว — ตัวเลขล้วนอ่านไม่ออกว่าแปลว่าอะไร */
function permSummary(u: ManagedUser, total: number): string {
  const n = u.permissions.length
  if (n === total) return 'ทุกสิทธิ์'
  if (n === 0) return 'ไม่มีสิทธิ์ใด'
  return `${n} จาก ${total} สิทธิ์`
}

export default function Users(): React.JSX.Element {
  const { user: me } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<ManagedUser | null>(null)
  const [removing, setRemoving] = useState<ManagedUser | null>(null)
  const [busy, setBusy] = useState(false)

  const load = (): void => {
    setLoading(true)
    Promise.all([api.get<ManagedUser[]>('/auth/users'), api.get<PermissionCatalog>('/auth/permissions/catalog')])
      .then(([u, c]) => {
        setUsers(u)
        setCatalog(c)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const totalPerms = catalog?.groups.reduce((n, g) => n + g.perms.length, 0) ?? 0
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return users
    return users.filter((u) => u.name.toLowerCase().includes(s) || u.username.toLowerCase().includes(s))
  }, [users, q])

  const replace = (u: ManagedUser): void => setUsers((list) => list.map((x) => (x.id === u.id ? u : x)))

  const toggleActive = async (u: ManagedUser): Promise<void> => {
    try {
      replace(await api.patch<ManagedUser>(`/auth/users/${u.id}/active`, { is_active: !u.is_active }))
      toast.push('success', u.is_active ? `ปิดบัญชี ${u.username} แล้ว` : `เปิดบัญชี ${u.username} แล้ว`)
    } catch (e) {
      toast.push('error', (e as Error).message)
    }
  }

  const confirmRemove = async (): Promise<void> => {
    if (!removing) return
    setBusy(true)
    try {
      await api.delete(`/auth/users/${removing.id}`)
      setUsers((list) => list.filter((x) => x.id !== removing.id))
      toast.push('success', `ลบบัญชี ${removing.username} แล้ว`)
      setRemoving(null)
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <ErrorBox message={error} onRetry={load} />

  return (
    <>
      <PageHeader
        title="ผู้ใช้และสิทธิ์"
        subtitle="กำหนดว่าใครเข้าถึงอะไรได้บ้าง — บทบาทเป็นชุดสำเร็จ ปรับรายคนทับได้"
        actions={
          <Button icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            เพิ่มผู้ใช้
          </Button>
        }
      />

      <div className="card">
        <div className="toolbar">
          <SearchInput value={q} onChange={setQ} placeholder="ค้นหาชื่อ / ชื่อผู้ใช้…" />
        </div>

        {loading ? (
          <div style={{ padding: 'var(--space-5)' }}>
            <TableSkeleton rows={4} cols={5} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<IconUsers size={28} />} title="ไม่พบผู้ใช้" desc="ลองแก้คำค้นหา หรือเพิ่มผู้ใช้ใหม่" />
        ) : (
          <>
            {/* จอคอม — ตารางเต็มเหมือนหน้าอื่นในระบบ */}
            <div className="table-wrap only-desktop">
              <table className="table">
                <thead>
                  <tr>
                    <th>ผู้ใช้</th>
                    <th>บทบาท</th>
                    <th>สิทธิ์ที่ใช้จริง</th>
                    <th>สถานะ</th>
                    <th>สร้างเมื่อ</th>
                    <th className="actions">การจัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{u.name}</div>
                        <div className="text-xs text-muted cell-no">{u.username}</div>
                      </td>
                      <td>
                        <Badge label={ROLE_LABEL[u.role]} tone={ROLE_TONE[u.role]} />
                      </td>
                      <td>
                        {permSummary(u, totalPerms)}
                        {Object.keys(u.overrides).length > 0 && (
                          <span className="tag-custom" title="มีสิทธิ์ที่ตั้งต่างจากบทบาท">
                            ปรับเอง {Object.keys(u.overrides).length}
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge label={u.is_active ? 'เปิดใช้งาน' : 'ปิดอยู่'} tone={u.is_active ? 'success' : 'neutral'} dot />
                      </td>
                      <td className="cell-date text-muted">{fmtDate(u.created_at)}</td>
                      <td>
                        <div className="actions">
                          <Button variant="ghost" size="sm" onClick={() => setEditing(u)} title="ตั้งสิทธิ์" aria-label={`ตั้งสิทธิ์ ${u.username}`}>
                            <IconShield size={15} />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setResetting(u)} title="ตั้งรหัสผ่านใหม่" aria-label={`ตั้งรหัสผ่านใหม่ ${u.username}`}>
                            <IconKey size={15} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void toggleActive(u)}
                            disabled={u.id === me?.id}
                            title={u.id === me?.id ? 'ปิดบัญชีตัวเองไม่ได้' : u.is_active ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                          >
                            {u.is_active ? 'ปิด' : 'เปิด'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRemoving(u)}
                            disabled={u.id === me?.id}
                            title={u.id === me?.id ? 'ลบบัญชีตัวเองไม่ได้' : 'ลบบัญชี'}
                            aria-label={`ลบ ${u.username}`}
                          >
                            <IconTrash size={15} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* มือถือ — การ์ดต่อคน ตารางแนวนอน 6 คอลัมน์อ่านไม่ได้บนจอ 375px */}
            <ul className="user-cards only-mobile">
              {filtered.map((u) => (
                <li key={u.id} className={`user-card${u.is_active ? '' : ' off'}`}>
                  <div className="user-card-top">
                    <div className="user-card-id">
                      <div className="user-card-name">{u.name}</div>
                      <div className="text-xs text-muted cell-no">{u.username}</div>
                    </div>
                    <Badge label={ROLE_LABEL[u.role]} tone={ROLE_TONE[u.role]} />
                  </div>
                  <div className="user-card-meta">
                    <span>{permSummary(u, totalPerms)}</span>
                    {Object.keys(u.overrides).length > 0 && <span className="tag-custom">ปรับเอง {Object.keys(u.overrides).length}</span>}
                    <Badge label={u.is_active ? 'เปิดใช้งาน' : 'ปิดอยู่'} tone={u.is_active ? 'success' : 'neutral'} dot />
                  </div>
                  <div className="user-card-actions">
                    <Button variant="outline" size="sm" icon={<IconShield size={15} />} onClick={() => setEditing(u)}>
                      ตั้งสิทธิ์
                    </Button>
                    <Button variant="ghost" size="sm" icon={<IconKey size={15} />} onClick={() => setResetting(u)}>
                      รหัสผ่าน
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void toggleActive(u)} disabled={u.id === me?.id}>
                      {u.is_active ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {editing && catalog && (
        <PermissionEditor
          user={editing}
          catalog={catalog}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            replace(u)
            setEditing(null)
            toast.push('success', `บันทึกสิทธิ์ของ ${u.username} แล้ว`)
          }}
        />
      )}

      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onCreated={(u) => {
            setUsers((list) => [...list, u])
            setCreating(false)
            toast.push('success', `สร้างบัญชี ${u.username} แล้ว`)
          }}
        />
      )}

      {resetting && (
        <ResetPassword
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={() => {
            setResetting(null)
            toast.push('success', 'ตั้งรหัสผ่านใหม่แล้ว')
          }}
        />
      )}

      <ConfirmDialog
        open={!!removing}
        title="ลบบัญชีผู้ใช้"
        message={
          <>
            ลบบัญชี <b>{removing?.username}</b> ({removing?.name}) ออกจากระบบถาวร?
            <br />
            ประวัติที่บัญชีนี้เคยบันทึกไว้ยังอยู่ แต่จะเข้าสู่ระบบไม่ได้อีก
            <br />
            <span className="text-muted text-sm">
              ถ้าแค่อยากระงับชั่วคราว ให้ใช้ "ปิดบัญชี" แทน · บัญชีที่เคยเก็บหลักฐานการส่งมอบจะลบถาวรไม่ได้
            </span>
          </>
        }
        confirmLabel="ลบถาวร"
        danger
        loading={busy}
        onConfirm={() => void confirmRemove()}
        onClose={() => setRemoving(null)}
      />
    </>
  )
}

/* ============ ตัวตั้งสิทธิ์ ============
   จอคอม: ตารางเต็มทุกสิทธิ์ (เห็นทั้งหมดพร้อมกัน — ค่าเดิมของระบบ)
   มือถือ: กลุ่มพับได้ + สวิตช์เต็มความกว้าง แตะด้วยนิ้วโป้งได้ */
function PermissionEditor({
  user,
  catalog,
  isSelf,
  onClose,
  onSaved,
}: {
  user: ManagedUser
  catalog: PermissionCatalog
  isSelf: boolean
  onClose: () => void
  onSaved: (u: ManagedUser) => void
}): React.JSX.Element {
  const [role, setRole] = useState<Role>(user.role)
  const [name, setName] = useState(user.name)
  const [perms, setPerms] = useState<Set<string>>(new Set(user.permissions))
  const [open, setOpen] = useState<string | null>(catalog.groups[0]?.key ?? null)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const preset = useMemo(() => new Set(catalog.presets[role] ?? []), [catalog.presets, role])

  /** เปลี่ยนบทบาท = โหลดชุดสำเร็จของบทบาทใหม่ทับ
   *  ไม่พยายามรักษาการปรับแต่งเดิมไว้ เพราะสิทธิ์ที่ปรับไว้บนบทบาทเก่ามักไม่มีความหมายกับบทบาทใหม่ */
  const changeRole = (r: Role): void => {
    setRole(r)
    setPerms(new Set(catalog.presets[r] ?? []))
  }

  const toggle = (p: string): void => {
    setPerms((s) => {
      const next = new Set(s)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  const setGroup = (perms: string[], on: boolean): void => {
    setPerms((s) => {
      const next = new Set(s)
      for (const p of perms) {
        if (on) next.add(p)
        else next.delete(p)
      }
      return next
    })
  }

  const changed = useMemo(
    () => [...preset].filter((p) => !perms.has(p)).length + [...perms].filter((p) => !preset.has(p)).length,
    [preset, perms],
  )

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      if (name !== user.name || role !== user.role) {
        await api.put<ManagedUser>(`/auth/users/${user.id}`, { name, role })
      }
      onSaved(await api.put<ManagedUser>(`/auth/users/${user.id}/permissions`, { permissions: [...perms] }))
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`สิทธิ์ของ ${user.name}`}
      footer={
        <>
          <span className="text-sm text-muted perm-count">
            เลือกอยู่ {perms.size} สิทธิ์{changed > 0 && ` · ต่างจากชุดสำเร็จ ${changed} รายการ`}
          </span>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="grid-2 perm-head">
        <Field label="ชื่อที่แสดง" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="บทบาท (ชุดสำเร็จ)" hint="เปลี่ยนบทบาทจะโหลดสิทธิ์ชุดสำเร็จของบทบาทนั้นทับของเดิม">
          <Select value={role} onChange={(e) => changeRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {isSelf && (
        <p className="perm-warn">
          นี่คือบัญชีของคุณเอง — ระบบจะไม่ยอมให้ถอนสิทธิ์ "จัดการผู้ใช้และสิทธิ์" ของตัวเอง
        </p>
      )}

      <div className="perm-groups">
        {catalog.groups.map((g) => {
          const on = g.perms.filter((p) => perms.has(p)).length
          const expanded = open === g.key
          return (
            <section key={g.key} className={`perm-group${expanded ? ' open' : ''}`}>
              <header className="perm-group-head">
                {/* ปุ่มพับ: มีผลจริงบนมือถือ · บนจอคอมกลุ่มเปิดหมดด้วย CSS */}
                <button
                  type="button"
                  className="perm-group-toggle"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : g.key)}
                >
                  <span className="perm-group-label">{g.label}</span>
                  <span className={`perm-group-count${on === 0 ? ' none' : on === g.perms.length ? ' all' : ''}`}>
                    {on}/{g.perms.length}
                  </span>
                </button>
                <div className="perm-group-bulk">
                  <button type="button" onClick={() => setGroup(g.perms, true)}>
                    ทั้งหมด
                  </button>
                  <span aria-hidden>·</span>
                  <button type="button" onClick={() => setGroup(g.perms, false)}>
                    ไม่เลย
                  </button>
                </div>
              </header>
              <div className="perm-list">
                {g.perms.map((p) => {
                  const diff = preset.has(p) !== perms.has(p)
                  return (
                    <Toggle
                      key={p}
                      checked={perms.has(p)}
                      onChange={() => toggle(p)}
                      label={catalog.labels[p] ?? p}
                      hint={
                        [catalog.warnings[p], diff ? 'ต่างจากชุดสำเร็จของบทบาทนี้' : '']
                          .filter(Boolean)
                          .join(' · ') || undefined
                      }
                      tone={catalog.warnings[p] ? 'warn' : undefined}
                      disabled={isSelf && p === 'users.manage'}
                    />
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </Modal>
  )
}

/* ============ สร้างผู้ใช้ ============ */
function CreateUser({ onClose, onCreated }: { onClose: () => void; onCreated: (u: ManagedUser) => void }): React.JSX.Element {
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'viewer' as Role })
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const submit = async (): Promise<void> => {
    setSaving(true)
    try {
      onCreated(await api.post<ManagedUser>('/auth/users', form))
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="เพิ่มผู้ใช้"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            สร้างบัญชี
          </Button>
        </>
      }
    >
      <Field label="ชื่อผู้ใช้ (สำหรับเข้าสู่ระบบ)" required hint="ตัวพิมพ์เล็ก อย่างน้อย 3 ตัว">
        <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
      </Field>
      <Field label="ชื่อ-นามสกุล" required>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="รหัสผ่านเริ่มต้น" required hint="อย่างน้อย 6 ตัว — ผู้ใช้เปลี่ยนเองได้ที่หน้าตั้งค่า">
        <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
      </Field>
      <Field label="บทบาท" hint="กำหนดสิทธิ์เริ่มต้น — ปรับรายข้อได้ทีหลังที่ปุ่มตั้งสิทธิ์">
        <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  )
}

/* ============ ตั้งรหัสผ่านใหม่ ============ */
function ResetPassword({ user, onClose, onDone }: { user: ManagedUser; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [pw, setPw] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const submit = async (): Promise<void> => {
    setSaving(true)
    try {
      await api.patch(`/auth/users/${user.id}/password`, { new_password: pw })
      onDone()
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`ตั้งรหัสผ่านใหม่ — ${user.username}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={() => void submit()} loading={saving} disabled={pw.length < 6}>
            ตั้งรหัสผ่าน
          </Button>
        </>
      }
    >
      <Field label="รหัสผ่านใหม่" required hint="อย่างน้อย 6 ตัว — แจ้งผู้ใช้ผ่านช่องทางที่ปลอดภัย แล้วให้เปลี่ยนเองทันที">
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </Field>
    </Modal>
  )
}
