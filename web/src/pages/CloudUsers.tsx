import { useEffect, useState } from 'react'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, TableSkeleton } from '../components/ui'
import { listUsers, approveUser, revokeUser } from '../api/users'
import { createUser, resetPassword, deleteUserAccount, driversWithoutAccount, type NewAccount } from '../api/adminUsers'
import { changeMyPassword } from '../api/auth'
import type { UserRow, UserRole } from '../types/database'

const displayUsername = (value: string): string => value.replace(/@tms\.local$/i, '')

/**
 * ผู้ใช้ + อนุมัติพนักงานที่ล็อกอินเข้ามาผ่าน TMS
 *
 * **พนักงานออฟฟิศไม่ต้องสร้างบัญชี** บัญชีเกิดเองตอนล็อกอิน TMS ครั้งแรก (ดู tms-gateway)
 * หน้าที่ของ admin เหลือแค่ตัดสินว่าจะให้สิทธิ์ระดับไหน หรือไม่ให้เลย
 *
 * **คนขับต้องสร้างให้** เพราะเขาไม่มีบัญชี TMS บริษัท (ไม่ใช่พนักงานที่ใช้ระบบนั้น)
 * ตรงนี้จึงมีฟอร์มสร้างบัญชี ซึ่งคุยกับ Edge Function `admin-users` ไม่ใช่ยิงตารางตรง —
 * การสร้างบัญชีใน auth.users ต้องใช้ service_role ที่ห้ามอยู่ใน frontend
 *
 * **รหัสถูกสุ่มให้ ไม่ให้ admin พิมพ์เอง** และโชว์ครั้งเดียว ปิดหน้าไปแล้วต้องตั้งใหม่
 * รหัสที่คนหนึ่งตั้งให้อีกคนจะถูกส่งต่อทางไลน์/แชท ซึ่งเป็นทางที่รหัสรั่วบ่อยที่สุด
 * สุ่มให้แล้วโชว์ครั้งเดียวคือทางที่รหัสไม่ค้างอยู่ในระบบหรือในแชทของใคร
 *
 * approve_user() ยังปฏิเสธบทบาท driver ตั้งแต่ในฐานข้อมูล — อนุมัติพนักงานออฟฟิศ
 * ให้เป็น driver = เขาล็อกอินได้แต่เมนูว่างเปล่า เพราะไม่มีแถวใน drivers
 */

const ROLE_LABEL: Record<string, string> = {
  admin: 'ผู้ดูแลระบบ',
  dispatcher: 'วางแผนงาน',
  viewer: 'ดูอย่างเดียว',
  driver: 'พนักงานขับรถ',
}

/* บทบาทที่อนุมัติได้จากหน้านี้ — เรียงจากสิทธิ์น้อยไปมาก
   ค่าเริ่มต้นเป็น viewer โดยตั้งใจ: ให้น้อยไว้ก่อนแล้วค่อยเพิ่มเมื่อมีคนขอ
   ปลอดภัยกว่าให้เยอะไว้ก่อนแล้วรอให้มีคนสังเกตว่าให้เกิน */
const ASSIGNABLE: UserRole[] = ['viewer', 'dispatcher', 'admin']

export default function CloudUsers(): React.JSX.Element {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [roleFor, setRoleFor] = useState<Record<number, UserRole>>({})
  const [busyId, setBusyId] = useState<number | null>(null)
  const [toRevoke, setToRevoke] = useState<UserRow | null>(null)
  const [toDelete, setToDelete] = useState<UserRow | null>(null)

  /* ฟอร์มสร้างบัญชีคนขับ + คนขับที่มีชื่อแต่ยังเข้าแอปไม่ได้ */
  const [noAcct, setNoAcct] = useState<{ driver_id: number; name: string; phone: string | null }[]>([])
  const [form, setForm] = useState({ username: '', name: '', phone: '', driver_id: '', role: 'driver' as UserRole })
  const [creating, setCreating] = useState(false)
  /* รหัสที่เพิ่งสุ่มได้ — อยู่ใน state เท่านั้น ไม่เขียนลง localStorage หรือส่งไปไหน */
  const [secret, setSecret] = useState<{ title: string; username: string; password: string } | null>(null)
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [selfPasswordOpen, setSelfPasswordOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const load = async (): Promise<void> => {
    try {
      setUsers(await listUsers())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ')
    }
  }

  const loadDrivers = (): void => {
    driversWithoutAccount().then(setNoAcct).catch(() => setNoAcct([]))
  }

  useEffect(() => {
    void load()
    loadDrivers()
  }, [])

  const create = async (): Promise<void> => {
    setCreating(true)
    try {
      const r: NewAccount = await createUser({
        username: form.username.trim(),
        name: form.name.trim(),
        role: form.role,
        as_driver: form.role === 'driver' && !form.driver_id,
        phone: form.phone.trim() || undefined,
        driver_id: form.driver_id ? Number(form.driver_id) : undefined,
      })
      setSecret({ title: 'สร้างบัญชีแล้ว', username: displayUsername(r.email), password: r.password })
      setForm({ username: '', name: '', phone: '', driver_id: '', role: 'driver' })
      setCreateOpen(false)
      await load()
      loadDrivers()
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สร้างบัญชีไม่สำเร็จ')
    } finally {
      setCreating(false)
    }
  }

  const reset = async (u: UserRow): Promise<void> => {
    setBusyId(u.id)
    try {
      const r = await resetPassword(u.id)
      setSecret({ title: `ตั้งรหัสใหม่ให้ ${u.name}`, username: displayUsername(r.username), password: r.password })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ตั้งรหัสใหม่ไม่สำเร็จ')
    } finally {
      setBusyId(null)
    }
  }

  const approve = async (u: UserRow): Promise<void> => {
    setBusyId(u.id)
    try {
      await approveUser(u.id, roleFor[u.id] ?? 'viewer')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'อนุมัติไม่สำเร็จ')
    } finally {
      setBusyId(null)
    }
  }

  const revoke = async (): Promise<void> => {
    if (!toRevoke) return
    setBusyId(toRevoke.id)
    try {
      await revokeUser(toRevoke.id)
      setToRevoke(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ระงับไม่สำเร็จ')
    } finally {
      setBusyId(null)
    }
  }

  const deleteAccount = async (): Promise<void> => {
    if (!toDelete) return
    setBusyId(toDelete.id)
    try {
      await deleteUserAccount(toDelete.id)
      setToDelete(null)
      await load()
      setNotice(`ลบบัญชี ${toDelete.username} จาก Auth และระบบผู้ใช้แล้ว`)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ลบบัญชีไม่สำเร็จ')
    } finally {
      setBusyId(null)
    }
  }

  const changePassword = async (): Promise<void> => {
    if (passwordForm.next.length < 8) { setError('รหัสใหม่ต้องมีอย่างน้อย 8 ตัวอักษร'); return }
    if (passwordForm.next !== passwordForm.confirm) { setError('รหัสใหม่กับการยืนยันรหัสไม่ตรงกัน'); return }
    setPasswordBusy(true)
    try {
      await changeMyPassword(passwordForm.current, passwordForm.next)
      setPasswordForm({ current: '', next: '', confirm: '' })
      setSelfPasswordOpen(false)
      setError(null)
      setNotice('เปลี่ยนรหัสผ่านของบัญชีคุณสำเร็จแล้ว')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ')
    } finally {
      setPasswordBusy(false)
    }
  }

  if (!users) {
    return (
      <>
        <PageHeader title="ผู้ใช้และสิทธิ์" />
        <TableSkeleton cols={5} />
      </>
    )
  }

  /* คนที่ยังไม่ถูกอนุมัติแยกขึ้นมาไว้บนสุด ไม่ปนกับรายชื่อทั้งหมด
     เพราะนี่คือสิ่งเดียวในหน้านี้ที่ "ต้องมีคนทำอะไรสักอย่าง" */
  /* pending ต้องเป็นบัญชีที่ยังมี Auth อยู่จริงเท่านั้น
     ถ้า Auth ถูกลบแล้ว (auth_id = null) ให้ไปอยู่คลังเก็บถาวร ไม่ค้างบนหน้าหลัก */
  const pending = users.filter((u) => u.auth_id !== null && !u.is_active && u.approved_at === null)
  const rest = users.filter((u) => u.auth_id !== null && u.is_active && !pending.includes(u))
  const archived = users.filter((u) => !rest.includes(u) && !pending.includes(u))

  return (
    <>
      <PageHeader
        title="ผู้ใช้และสิทธิ์"
        subtitle="พนักงานออฟฟิศเข้าระบบด้วยบัญชี TMS บริษัท — ที่นี่กำหนดว่าใครเห็นอะไรได้บ้าง"
      />

      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {notice && (
        <div role="status" style={{ padding: '10px 12px', marginBottom: 16, borderRadius: 8, color: 'var(--success)', background: 'var(--success-bg)' }}>
          {notice}
        </div>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 18, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <b>การจัดการบัญชี</b>
          <div className="text-xs text-muted">เลือกงานที่ต้องการทำจากปุ่มด้านขวา</div>
        </div>
        <Button variant="outline" onClick={() => setSelfPasswordOpen(true)}>เปลี่ยนรหัสผ่านของฉัน</Button>
        <Button onClick={() => setCreateOpen(true)}>สร้างบัญชีพนักงานขับรถ</Button>
      </div>

      <Modal open={selfPasswordOpen} onClose={() => setSelfPasswordOpen(false)} title="เปลี่ยนรหัสผ่านของฉัน">
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--muted)' }}>เปลี่ยนเฉพาะบัญชีที่กำลังล็อกอินอยู่ ต้องยืนยันรหัสเดิมก่อน</p>
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="รหัสผ่านเดิม" required>
            <Input type="password" value={passwordForm.current} onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })} autoComplete="current-password" />
          </Field>
          <Field label="รหัสผ่านใหม่" required>
            <Input type="password" value={passwordForm.next} onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="ยืนยันรหัสผ่านใหม่" required>
            <Input type="password" value={passwordForm.confirm} onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })} autoComplete="new-password" />
          </Field>
          <Button loading={passwordBusy} onClick={() => void changePassword()} disabled={!passwordForm.current || !passwordForm.next || !passwordForm.confirm}>บันทึกรหัสผ่านใหม่</Button>
        </div>
      </Modal>

      {/* รหัสโชว์ครั้งเดียว — ไม่มีที่ไหนเก็บไว้ ปิดกล่องแล้วต้องกดตั้งใหม่ถ้าลืมจด */}
      {secret && (
        <div className="card" style={{ padding: 18, marginBottom: 18, borderLeft: '3px solid var(--accent)' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>{secret.title}</h3>
          <div style={{ display: 'grid', gap: 6, fontSize: 14 }}>
            <div>บัญชีเป้าหมาย: <b className="cell-no">{secret.username}</b></div>
            <div>รหัสผ่าน: <b className="cell-no" style={{ fontSize: 18 }}>{secret.password}</b></div>
          </div>
          <p style={{ margin: '10px 0 12px', fontSize: 12.5, color: 'var(--warn)', lineHeight: 1.7 }}>
            รหัสนี้แสดงครั้งเดียว ระบบไม่เก็บไว้ที่ไหน — ส่งให้เจ้าตัวแล้วให้เขาเปลี่ยนเอง
            ถ้าปิดกล่องนี้ไปแล้วลืม ต้องกดตั้งรหัสใหม่
          </p>
          <Button size="sm" variant="outline" onClick={() => setSecret(null)}>ปิด (จดแล้ว)</Button>
        </div>
      )}

      {/* แบบฟอร์มสร้างบัญชีอยู่ใน Modal — ไม่ให้ยาวปนกับตาราง */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="สร้างบัญชีพนักงานขับรถ" size="md">
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>สร้างบัญชีพนักงานขับรถ</h3>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
            ระบบสุ่มรหัสให้ แสดงครั้งเดียว · ผู้ใช้เข้าสู่ระบบด้วยชื่อผู้ใช้ที่ admin กำหนด
            (กู้รหัสทางอีเมลไม่ได้ ต้องกลับมาตั้งใหม่ที่นี่)
          </p>
        </div>

        <Field label="บทบาท / หน้าที่ในระบบ" required hint="บทบาทกำหนดเมนูและสิทธิ์ที่ผู้ใช้เห็น">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole, driver_id: e.target.value === 'driver' ? form.driver_id : '' })}>
            {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            <option value="driver">{ROLE_LABEL.driver}</option>
          </Select>
        </Field>

        {form.role === 'driver' && noAcct.length > 0 && (
          <Field
            label="ผูกกับพนักงานขับที่มีชื่อในระบบแล้ว"
            hint="คนที่ระบบสร้างจากชื่อในเที่ยวของ TMS จะยังไม่มีบัญชี เลือกชื่อที่นี่แทนการสร้างซ้ำ"
          >
            <Select
              value={form.driver_id}
              onChange={(e) => {
                const id = e.target.value
                const d = noAcct.find((x) => String(x.driver_id) === id)
                setForm({
                  ...form,
                  driver_id: id,
                  name: d ? d.name : form.name,
                  phone: d?.phone ?? form.phone,
                })
              }}
            >
              <option value="">— สร้างคนใหม่ —</option>
              {noAcct.map((d) => (
                <option key={d.driver_id} value={d.driver_id}>{d.name}</option>
              ))}
            </Select>
          </Field>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="ชื่อผู้ใช้ (ภาษาอังกฤษ)" required>
            <Input
              value={form.username}
              placeholder="driver02"
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field label="ชื่อ-นามสกุล" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
        </div>

        <Field label="เบอร์โทร">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>

        <div>
          <Button
            loading={creating}
            disabled={!form.username.trim() || !form.name.trim()}
            onClick={() => void create()}
          >
            สร้างบัญชี
          </Button>
        </div>
      </Modal>

      {pending.length > 0 && (
        <div className="card" style={{ padding: 18, marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>รออนุมัติ {pending.length} คน</h3>
          <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--muted)' }}>
            คนเหล่านี้ยืนยันตัวกับ TMS ผ่านแล้ว แต่ยังไม่เห็นข้อมูลอะไรในระบบเราเลยจนกว่าจะอนุมัติ
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ชื่อ</th>
                  <th>ชื่อผู้ใช้ TMS</th>
                  <th>เข้าล่าสุด</th>
                  <th style={{ width: 160 }}>ให้สิทธิ์เป็น</th>
                  <th style={{ width: 100 }} />
                </tr>
              </thead>
              <tbody>
                {pending.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.name}</b></td>
                    <td>{u.username}</td>
                    <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString('th-TH') : '—'}</td>
                    <td>
                      <Select
                        value={roleFor[u.id] ?? 'viewer'}
                        onChange={(e) => setRoleFor({ ...roleFor, [u.id]: e.target.value as UserRole })}
                      >
                        {ASSIGNABLE.map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <Button size="sm" loading={busyId === u.id} onClick={() => void approve(u)}>
                        อนุมัติ
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        {rest.length === 0 ? (
          <EmptyState title="ยังไม่มีผู้ใช้" desc="พนักงานจะปรากฏที่นี่หลังล็อกอินด้วยบัญชี TMS ครั้งแรก" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ชื่อ</th>
                  <th>ชื่อผู้ใช้</th>
                  <th>บทบาท</th>
                  <th>เข้าระบบด้วย</th>
                  <th>สถานะ</th>
                  <th style={{ width: 100 }} />
                </tr>
              </thead>
              <tbody>
                {rest.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.name}</b></td>
                    <td>{u.username}</td>
                    <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td>{u.auth_source === 'tms' ? 'บัญชี TMS บริษัท' : 'อีเมล/รหัสผ่าน'}</td>
                    <td>
                      <Badge
                        label={u.is_active ? 'ใช้งานได้' : 'ถูกระงับ'}
                        tone={u.is_active ? 'success' : 'danger'}
                      />
                    </td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {/* บัญชีที่เข้าด้วยรหัส TMS ตั้งรหัสที่นี่ไม่ได้ — รหัสฝั่งเราของบัญชีนั้น
                          ถูกสุ่มใหม่ทุกครั้งที่ล็อกอินผ่าน TMS อยู่แล้ว ปุ่มจึงไม่ควรมีให้กดเก้อ */}
                      {u.auth_source !== 'tms' && u.auth_id !== null && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busyId === u.id}
                          onClick={() => void reset(u)}
                        >
                          สุ่มรหัสให้ผู้ใช้นี้
                        </Button>
                      )}
                      {u.is_active && (
                        <Button size="sm" variant="ghost" onClick={() => setToRevoke(u)}>
                          ระงับ
                        </Button>
                      )}
                      {u.auth_source !== 'tms' && (
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setToDelete(u)}>
                          ลบถาวร
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {archived.length > 0 && (
        <div className="card" style={{ marginTop: 18, opacity: 0.86 }}>
          <div style={{ padding: '16px 18px 8px' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>บัญชีเก็บถาวร ({archived.length})</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
              บัญชีที่ถูกระงับหรือถูกลบจาก Supabase Auth จะอยู่ที่นี่เพื่อไม่ให้กระทบประวัติงานเดิม
            </p>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ชื่อ</th><th>ชื่อผู้ใช้</th><th>เหตุผล</th></tr></thead>
              <tbody>
                {archived.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.name}</b></td>
                    <td>{u.username}</td>
                    <td>
                      <Badge label={u.auth_id === null ? 'ลบบัญชี Auth แล้ว' : 'ถูกระงับ'} tone="danger" />
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setToDelete(u)}>
                        ลบถาวร
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={toRevoke !== null}
        title="ระงับบัญชี"
        message={
          toRevoke
            ? `${toRevoke.name} จะเข้าระบบไม่ได้ทันที แต่ประวัติงานที่เคยทำไว้ยังอยู่ครบ เปิดคืนได้ภายหลัง`
            : ''
        }
        confirmLabel="ระงับ"
        danger
        loading={busyId === toRevoke?.id}
        onConfirm={() => void revoke()}
        onClose={() => setToRevoke(null)}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title="ลบบัญชีถาวร"
        message={toDelete ? `${toDelete.name} จะถูกลบจาก Supabase Auth และรายชื่อผู้ใช้ถาวร ประวัติออเดอร์/เที่ยวจะไม่ถูกลบ` : ''}
        confirmLabel="ลบถาวร"
        danger
        loading={busyId === toDelete?.id}
        onConfirm={() => void deleteAccount()}
        onClose={() => setToDelete(null)}
      />
    </>
  )
}
