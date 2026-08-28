import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, Field, Input, Modal, MoreMenu, PageHeader, Select, TableSkeleton, TabPanel, Tabs } from '../components/ui'
import { PermissionAuditPanel, RolePermissionsPanel } from './CloudPermissionGroups'
import { listUsers, approveUser, revokeUser, updateUserRole, listPermissionCatalog, listRolePermissions, listUserPermissionOverrides, saveUserPermission, resetUserPermissions, seedRolePermissionPresets } from '../api/users'
import { createUser, resetPassword, deleteUserAccount, driversWithoutAccount, type NewAccount } from '../api/adminUsers'
import { ChangePasswordModal } from '../components/ChangePasswordModal'
import type { PermissionMode, UserRow, UserRole } from '../types/database'
import { sectionedPermissions } from '../utils/permissions'
import { fmtDateTime } from '../utils/format'

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

const ROLE_HELP: Record<string, string> = {
  admin: 'จัดการระบบ ผู้ใช้ สิทธิ์ และข้อมูลทั้งหมด',
  dispatcher: 'ลูกค้า ออเดอร์ เที่ยว รถ และการจัดงานขนส่ง',
  viewer: 'เปิดดูข้อมูลตามที่ได้รับอนุญาต ไม่แก้ไขงาน',
  driver: 'ดูงานของฉันและส่งสถานะ/POD ของงานที่รับผิดชอบ',
}

/* บทบาทที่อนุมัติได้จากหน้านี้ — เรียงจากสิทธิ์น้อยไปมาก
   ค่าเริ่มต้นเป็น viewer โดยตั้งใจ: ให้น้อยไว้ก่อนแล้วค่อยเพิ่มเมื่อมีคนขอ
   ปลอดภัยกว่าให้เยอะไว้ก่อนแล้วรอให้มีคนสังเกตว่าให้เกิน */
const ASSIGNABLE: UserRole[] = ['viewer', 'dispatcher', 'admin']

export default function CloudUsers(): React.JSX.Element {
  /* แท็บที่เปิดอยู่เก็บใน URL ไม่ใช่ใน state ล้วน — ลิงก์ที่ส่งให้กันต้องเปิดมาตรงแท็บเดิม
     ปุ่มย้อนกลับต้องพากลับมาแท็บก่อนหน้า และ `/permission-groups` ของเดิมชี้มาที่
     `?tab=groups` ได้โดยไม่ต้องมีหน้าของตัวเองอีก */
  const [params, setParams] = useSearchParams()
  const rawTab = params.get('tab')
  const tab = rawTab === 'groups' || rawTab === 'audit' ? rawTab : 'accounts'
  const setTab = (key: string): void => {
    const next = new URLSearchParams(params)
    if (key === 'accounts') next.delete('tab')
    else next.set('tab', key)
    setParams(next)
  }

  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])
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
  const [selfPasswordOpen, setSelfPasswordOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [permissionTarget, setPermissionTarget] = useState<UserRow | null>(null)
  const [permissionCatalog, setPermissionCatalog] = useState<{ permission: string; label: string }[]>([])
  const [permissionModes, setPermissionModes] = useState<Record<string, PermissionMode>>({})
  /* สิทธิ์ที่กลุ่มให้อยู่แล้ว — ต้องรู้ ไม่งั้นหน้าจอบอกได้แค่ "ใช้ตามกลุ่ม"
     โดยไม่บอกว่าตามกลุ่มแล้วได้หรือไม่ได้ ซึ่งเป็นคำตอบที่คนเปิดหน้านี้มาหา */
  const [roleAllowed, setRoleAllowed] = useState<Set<string>>(new Set())
  /* ค่าตอนเปิดกล่อง — ใช้เทียบตอนบันทึกเพื่อส่งเฉพาะข้อที่เปลี่ยน
     เดิมส่งทุกข้อในแคตตาล็อกทุกครั้ง = ยิงยี่สิบกว่าคำขอเพื่อแก้ข้อเดียว
     และทุกข้อที่ส่งไปจะถูกบันทึกลงประวัติการเปลี่ยนสิทธิ์ด้วย */
  const [permissionInitial, setPermissionInitial] = useState<Record<string, PermissionMode>>({})
  const [permissionBusy, setPermissionBusy] = useState(false)
  const [roleBusy, setRoleBusy] = useState<number | null>(null)
  const [presetBusy, setPresetBusy] = useState(false)
  const [roleChange, setRoleChange] = useState<{ user: UserRow; role: UserRole } | null>(null)

  const openPermissions = async (u: UserRow): Promise<void> => {
    setPermissionTarget(u)
    setPermissionBusy(true)
    try {
      const [catalog, current, ofRole] = await Promise.all([
        listPermissionCatalog(),
        listUserPermissionOverrides(u.id),
        listRolePermissions(u.role),
      ])
      setPermissionCatalog(catalog)
      const modes = Object.fromEntries(
        current.map((p) => [p.permission, p.mode ?? (p.allowed ? 'allow' : 'deny')]),
      ) as Record<string, PermissionMode>
      setPermissionModes(modes)
      setPermissionInitial(modes)
      setRoleAllowed(new Set(ofRole))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดสิทธิ์ไม่สำเร็จ')
      setPermissionTarget(null)
    } finally { setPermissionBusy(false) }
  }

  const savePermissions = async (): Promise<void> => {
    if (!permissionTarget) return
    setPermissionBusy(true)
    try {
      const changed = permissionCatalog.filter(
        (p) => (permissionModes[p.permission] ?? 'inherit') !== (permissionInitial[p.permission] ?? 'inherit'),
      )
      await Promise.all(changed.map((p) => saveUserPermission(permissionTarget.id, p.permission, permissionModes[p.permission] ?? 'inherit')))
      setPermissionTarget(null)
      setNotice(changed.length === 0
        ? 'ไม่มีอะไรเปลี่ยน'
        : `บันทึกสิทธิ์ของ ${permissionTarget.name} แล้ว · ${changed.length} ข้อ`)
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'บันทึกสิทธิ์ไม่สำเร็จ') }
    finally { setPermissionBusy(false) }
  }

  const resetPermissions = async (): Promise<void> => {
    if (!permissionTarget) return
    setPermissionBusy(true)
    try {
      await resetUserPermissions(permissionTarget.id)
      setPermissionModes({})
      setNotice(`คืนสิทธิ์ของ ${permissionTarget.name} ตามกลุ่มแล้ว`)
      setPermissionTarget(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'คืนค่าเริ่มต้นไม่สำเร็จ') }
    finally { setPermissionBusy(false) }
  }

  const changeRole = async (u: UserRow, role: UserRole): Promise<void> => {
    if (role === u.role) return
    setRoleBusy(u.id)
    try {
      await updateUserRole(u.id, role)
      await load()
      setNotice(`เปลี่ยนกลุ่มสิทธิ์ของ ${u.name} เป็น ${ROLE_LABEL[role]} แล้ว`)
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'เปลี่ยนกลุ่มสิทธิ์ไม่สำเร็จ') }
    finally { setRoleBusy(null) }
  }

  const seedPresets = async (): Promise<void> => {
    setPresetBusy(true)
    try {
      const groups = await seedRolePermissionPresets()
      setNotice(`ตั้งค่ากลุ่มสิทธิ์มาตรฐานแล้ว · วางแผนงาน ${groups.dispatcher ?? 0} สิทธิ์ · ดูข้อมูล ${groups.viewer ?? 0} สิทธิ์ · คนขับ ${groups.driver ?? 0} สิทธิ์`)
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'ตั้งค่ากลุ่มสิทธิ์ไม่สำเร็จ') }
    finally { setPresetBusy(false) }
  }

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

      {/* สามมุมของเรื่องเดียวกัน: ใครมีบัญชี · กลุ่มให้อะไรมาเป็นค่าเริ่มต้น · ใครแก้อะไรไปแล้ว
          เดิมมุมที่สองกับสามอยู่คนละหน้า ทำให้ตอบคำถาม "คนนี้เปิดหน้านั้นได้ไหม" ต้องเด้งไปมา */}
      <Tabs
        idPrefix="users"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'accounts', label: 'บัญชี', badge: pending.length > 0 ? String(pending.length) : undefined },
          { key: 'groups', label: 'สิทธิ์เริ่มต้นของกลุ่ม' },
          { key: 'audit', label: 'ประวัติการเปลี่ยนแปลง' },
        ]}
      />

      {/* แถบนี้อยู่หัวหน้า ส่วนปุ่มที่ทำให้มันขึ้นอยู่กลางตารางที่ต้องเลื่อนลงไปกด
          ถ้าไม่เลื่อนกลับมาให้ คนกดจะเห็นแค่ปุ่มหมุนแล้วเงียบ ทั้งที่มีเหตุผลบอกอยู่ */}
      <div ref={errorRef}>
        {error && <ErrorBox message={error} onRetry={() => void load()} />}
      </div>
      {notice && (
        <div role="status" style={{ padding: '10px 12px', marginBottom: 16, borderRadius: 8, color: 'var(--success)', background: 'var(--success-bg)' }}>
          {notice}
        </div>
      )}

      <TabPanel tabKey="accounts" value={tab} idPrefix="users">
      <div className="card" style={{ padding: 16, marginBottom: 18, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <b>การจัดการบัญชี</b>
          <div className="text-xs text-muted">เลือกกลุ่มสิทธิ์ให้ผู้ใช้ได้จากตาราง ไม่ต้องตั้งทีละ permission</div>
        </div>
        <Button variant="outline" onClick={() => setSelfPasswordOpen(true)}>เปลี่ยนรหัสผ่านของฉัน</Button>
        <Button variant="outline" loading={presetBusy} onClick={() => void seedPresets()}>ตั้งค่ากลุ่มมาตรฐาน</Button>
        <Button onClick={() => setCreateOpen(true)}>สร้างบัญชีผู้ใช้</Button>
      </div>

      <ChangePasswordModal
        open={selfPasswordOpen}
        onClose={() => setSelfPasswordOpen(false)}
        onDone={() => setNotice('เปลี่ยนรหัสผ่านของบัญชีคุณสำเร็จแล้ว')}
      />

      {/* สิทธิ์รายคน — โครงเดียวกับแท็บ "สิทธิ์เริ่มต้นของกลุ่ม" โดยตั้งใจ
          คนที่เปิดกล่องนี้เพิ่งดูหน้ากลุ่มมา ถ้าสองที่เรียงคนละแบบ เขาต้องหาบรรทัด
          เดียวกันใหม่ทุกครั้ง ต่างกันแค่ตัวควบคุม: กลุ่มมีสองสถานะ (เปิด/ปิด)
          รายคนมีสาม (ตามกลุ่ม/อนุญาต/ปฏิเสธ) จึงเป็นปุ่มสามช่องแทนสวิตช์

          ทิ้ง <Select> เดิมเพราะมันซ่อนคำตอบ: ต้องกดเปิดถึงจะรู้ว่ามีตัวเลือกอะไร
          และยี่สิบกว่าแถวที่เขียนว่า "อนุญาตเฉพาะคนนี้" เหมือนกันหมด อ่านไม่ออกว่า
          ข้อไหนคือข้อยกเว้นจริง ๆ */}
      <Modal
        open={permissionTarget !== null}
        onClose={() => setPermissionTarget(null)}
        title={permissionTarget ? `สิทธิ์ของ ${permissionTarget.name}` : 'สิทธิ์ผู้ใช้'}
        size="lg"
      >
        {permissionBusy && permissionCatalog.length === 0 ? <TableSkeleton rows={6} cols={2} /> : (() => {
          const sections = sectionedPermissions(permissionCatalog.map((p) => p.permission))
          const effective = (permission: string): boolean => {
            const mode = permissionModes[permission] ?? 'inherit'
            return mode === 'inherit' ? roleAllowed.has(permission) : mode === 'allow'
          }
          const overrides = permissionCatalog.filter((p) => (permissionModes[p.permission] ?? 'inherit') !== 'inherit').length
          return <>
            <div className="puser-head">
              <p className="puser-head-text">
                ค่าเริ่มต้นมาจากกลุ่ม <b>{permissionTarget ? ROLE_LABEL[permissionTarget.role] : ''}</b>
                {' · '}เปลี่ยนเฉพาะคนนี้ได้เมื่อจำเป็น
              </p>
              {/* ตัวเลขนี้คือคำตอบของคำถามที่คนเปิดกล่องมาถามบ่อยที่สุด —
                  "คนนี้ถูกตั้งพิเศษไว้ตรงไหนบ้าง" ซึ่งเดิมต้องกวาดอ่านทั้งยี่สิบกว่าแถว */}
              <Badge
                label={overrides === 0 ? 'ใช้ตามกลุ่มทั้งหมด' : `ต่างจากกลุ่ม ${overrides} ข้อ`}
                tone={overrides === 0 ? 'available' : 'accent'}
              />
            </div>

            <div className="pgroup-sections puser-sections">
              {sections.map((section) => (
                <section key={section.label} className="pgroup-band">
                  <div className="pgroup-band-head">
                    <h3 className="pgroup-band-title">{section.label}</h3>
                    <span className="text-xs text-muted">{section.hint}</span>
                  </div>
                  <div className="pgroup-grid">
                    {section.groups.map(({ group, entries }) => {
                      /* นับ "ผลลัพธ์จริง" ไม่ใช่จำนวนข้อยกเว้น — คำถามคือคนนี้ทำอะไรได้
                         ส่วนว่าได้เพราะกลุ่มให้หรือเพราะตั้งพิเศษ อ่านจากปุ่มในแถว */
                      const on = entries.filter((p) => effective(p.permission)).length
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
                              const mode = permissionModes[p.permission] ?? 'inherit'
                              const fromGroup = roleAllowed.has(p.permission)
                              return (
                                <div
                                  key={p.permission}
                                  className={`pgroup-row puser-row${effective(p.permission) ? ' is-on' : ''}${mode === 'inherit' ? '' : ' is-override'}`}
                                >
                                  <span className="pgroup-text">
                                    <b>{p.label}</b>
                                    <small>{p.description}</small>
                                    {/* ค่าของกลุ่มเขียนไว้ในแถว ไม่ได้ยัดลงในป้ายปุ่ม —
                                        ปุ่มสามอันต้องกว้างเท่ากันทุกแถว ถึงจะกวาดเป็นคอลัมน์เดียวได้
                                        และคำว่า "ตามกลุ่ม" ยาวไม่เท่ากันแต่ละแถวคือสิ่งที่ทำลายคอลัมน์นั้น */}
                                    <em className={`puser-base${fromGroup ? ' is-yes' : ''}`}>
                                      {fromGroup ? 'กลุ่มนี้ให้อยู่แล้ว' : 'กลุ่มนี้ไม่ให้'}
                                    </em>
                                  </span>
                                  {/* ปุ่มสามช่อง ไม่ใช่ dropdown — สามตัวเลือกที่เห็นพร้อมกัน
                                      กดครั้งเดียวจบ และช่องที่เลือกอยู่อ่านออกจากระยะไกล */}
                                  <div className="pmode" role="radiogroup" aria-label={`สิทธิ์ ${p.label}`}>
                                    {([
                                      ['inherit', 'ตามกลุ่ม', 'ใช้ค่าของกลุ่ม เปลี่ยนกลุ่มเมื่อไหร่คนนี้เปลี่ยนตาม'],
                                      ['allow', 'อนุญาต', 'ให้สิทธิ์เฉพาะคนนี้ แม้กลุ่มจะไม่ให้'],
                                      ['deny', 'ปฏิเสธ', 'ตัดสิทธิ์เฉพาะคนนี้ แม้กลุ่มจะให้'],
                                    ] as const).map(([value, label, help]) => (
                                      <button
                                        key={value}
                                        type="button"
                                        role="radio"
                                        aria-checked={mode === value}
                                        title={help}
                                        className={`pmode-btn is-${value}${mode === value ? ' is-active' : ''}`}
                                        onClick={() => setPermissionModes({ ...permissionModes, [p.permission]: value })}
                                      >
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </section>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        })()}
        <div className="puser-actions">
          <Button variant="outline" onClick={() => void resetPermissions()} loading={permissionBusy}>คืนค่าเริ่มต้นกลุ่ม</Button>
          <Button variant="outline" onClick={() => setPermissionTarget(null)}>ยกเลิก</Button>
          <Button loading={permissionBusy} onClick={() => void savePermissions()}>บันทึกสิทธิ์</Button>
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
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="สร้างบัญชีผู้ใช้" size="md">
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>สร้างบัญชีผู้ใช้</h3>
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
            <table className="table ops-table">
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
                    <td>{fmtDateTime(u.last_login_at)}</td>
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
            <table className="table ops-table">
              <thead>
                <tr>
                  <th>ชื่อ</th>
                  <th>ชื่อผู้ใช้</th>
                  <th style={{ minWidth: 180 }}>กลุ่มสิทธิ์ / หน้าที่</th>
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
                    <td>
                      <Select value={u.role} disabled={roleBusy === u.id} onChange={(e) => setRoleChange({ user: u, role: e.target.value as UserRole })}>
                        {/* กลุ่มปัจจุบันต้องอยู่ในรายการเสมอ ไม่งั้น <select> ที่หาค่าตัวเองไม่เจอ
                            จะโชว์ตัวเลือกแรกแทน คนอ่านจะเห็นบทบาทผิดโดยที่ไม่มีอะไรเปลี่ยน */}
                        {([...new Set<UserRole>(['admin', 'dispatcher', 'viewer', ...(u.auth_source === 'tms' ? [] : ['driver' as UserRole]), u.role])]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </Select>
                      <div className="text-xs text-muted" style={{ marginTop: 4 }}>{ROLE_HELP[u.role]}</div>
                    </td>
                    <td>{u.auth_source === 'tms' ? 'บัญชี TMS บริษัท' : 'อีเมล/รหัสผ่าน'}</td>
                    <td>
                      <Badge
                        label={u.is_active ? 'ใช้งานได้' : 'ถูกระงับ'}
                        tone={u.is_active ? 'success' : 'danger'}
                      />
                    </td>
                    <td className="cell-actions"><div className="cell-actions-in">
                      {/* ปุ่มที่กดทุกวันอยู่ในแถว ที่เหลือพับเข้าเมนู — สี่ปุ่มเรียงกันในเซลล์เดียว
                          ตัดบรรทัดเป็นสามชั้นบนจอปกติ แถวสูงขึ้นเป็นสามเท่าและปุ่มลบถาวร
                          ไปอยู่ห่างจากปุ่มที่กดบ่อยแค่ไม่กี่พิกเซล เหมือนที่แก้ไปแล้วบนการ์ดเที่ยว */}
                      {u.is_active && (
                        <Button size="sm" variant="ghost" onClick={() => void openPermissions(u)}>
                          ตั้งค่าสิทธิ์
                        </Button>
                      )}
                      <MoreMenu
                        items={[
                          /* บัญชีที่เข้าด้วยรหัส TMS ตั้งรหัสที่นี่ไม่ได้ — รหัสฝั่งเราของบัญชีนั้น
                             ถูกสุ่มใหม่ทุกครั้งที่ล็อกอินผ่าน TMS อยู่แล้ว จึงไม่ควรมีให้กดเก้อ */
                          ...(u.auth_source !== 'tms' && u.auth_id !== null
                            ? [{ label: 'สุ่มรหัสให้ผู้ใช้นี้', onClick: () => void reset(u), disabled: busyId === u.id }]
                            : []),
                          ...(u.is_active ? [{ label: 'ระงับการใช้งาน', onClick: () => setToRevoke(u) }] : []),
                          /* เดิมซ่อนปุ่มลบสำหรับบัญชีที่มาจากการล็อกอิน TMS ซึ่งเป็นบัญชี
                             พนักงานจริงเกือบทั้งหมด — ผลคือแถวที่คนอยากลบที่สุดกลับไม่มีปุ่มเลย
                             และไม่มีอะไรบอกว่าทำไม แสดงไว้ แล้วอธิบายผลตอนยืนยันแทน */
                          { label: 'ลบถาวร', onClick: () => setToDelete(u), danger: true },
                        ]}
                      />
                    </div></td>
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
            <table className="table ops-table">
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
        open={roleChange !== null}
        title="เปลี่ยนกลุ่มสิทธิ์"
        message={roleChange ? `${roleChange.user.name} จะเปลี่ยนเป็นกลุ่ม “${ROLE_LABEL[roleChange.role]}” · สิทธิ์จากกลุ่มเดิมจะเปลี่ยนตามหลังล็อกอินใหม่` : ''}
        confirmLabel="ยืนยันเปลี่ยนกลุ่ม"
        loading={roleBusy === roleChange?.user.id}
        onConfirm={() => {
          if (!roleChange) return
          void changeRole(roleChange.user, roleChange.role).finally(() => setRoleChange(null))
        }}
        onClose={() => setRoleChange(null)}
      />

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
        message={toDelete ? (
          <>
            <b>{toDelete.name}</b> จะถูกลบจาก Supabase Auth และรายชื่อผู้ใช้ถาวร
            ประวัติออเดอร์และเที่ยวจะไม่ถูกลบ
            {toDelete.auth_source === 'tms' && (
              /* บัญชี TMS สร้างตัวเองใหม่ได้ตอนล็อกอินครั้งหน้า การลบจึงไม่ได้กันคนออก
                 ถ้าตั้งใจจะกันไม่ให้เข้าใช้ ต้องใช้ "ระงับ" ไม่ใช่ "ลบถาวร" */
              <div style={{ marginTop: 8 }}>
                บัญชีนี้เข้าระบบด้วยรหัส TMS บริษัท — ลบแล้วเขายังล็อกอินได้
                และระบบจะสร้างโปรไฟล์ใหม่ให้ พร้อมสิทธิ์ที่ถูกล้างไปหมด
                ถ้าต้องการกันไม่ให้เข้าใช้ ให้กด <b>ระงับ</b> แทน
              </div>
            )}
          </>
        ) : ''}
        confirmLabel="ลบถาวร"
        danger
        loading={busyId === toDelete?.id}
        onConfirm={() => void deleteAccount()}
        onClose={() => setToDelete(null)}
      />
      </TabPanel>

      <TabPanel tabKey="groups" value={tab} idPrefix="users">
        <RolePermissionsPanel />
      </TabPanel>

      <TabPanel tabKey="audit" value={tab} idPrefix="users">
        <PermissionAuditPanel />
      </TabPanel>
    </>
  )
}
