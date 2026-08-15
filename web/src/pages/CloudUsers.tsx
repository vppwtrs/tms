import { useEffect, useState } from 'react'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBox, PageHeader, Select, TableSkeleton } from '../components/ui'
import { listUsers, approveUser, revokeUser } from '../api/users'
import type { UserRow, UserRole } from '../types/database'

/**
 * ผู้ใช้ + อนุมัติพนักงานที่ล็อกอินเข้ามาผ่าน TMS
 *
 * **ไม่มีปุ่มสร้างบัญชีพนักงานออฟฟิศ** และไม่ใช่เพราะยังทำไม่เสร็จ —
 * บัญชีเกิดเองตอนคนนั้นล็อกอิน TMS ครั้งแรก (ดู tms-gateway) หน้าที่ของ admin
 * เหลือแค่ตัดสินว่าจะให้สิทธิ์ระดับไหน หรือไม่ให้เลย
 * ผลคือไม่มีใครต้องตั้งรหัสผ่านให้คนอื่น ซึ่งเป็นทางที่รหัสรั่วบ่อยที่สุด
 *
 * บัญชีคนขับยังสร้างจากหน้าพนักงานขับรถเหมือนเดิม — approve_user() ปฏิเสธบทบาท
 * driver ตั้งแต่ในฐานข้อมูล เพราะคนขับต้องมีแถวใน drivers ถึงจะใช้งานได้จริง
 * อนุมัติพนักงานออฟฟิศให้เป็น driver = เขาล็อกอินได้แต่เมนูว่างเปล่า
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
  const [roleFor, setRoleFor] = useState<Record<number, UserRole>>({})
  const [busyId, setBusyId] = useState<number | null>(null)
  const [toRevoke, setToRevoke] = useState<UserRow | null>(null)

  const load = async (): Promise<void> => {
    try {
      setUsers(await listUsers())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ')
    }
  }

  useEffect(() => {
    void load()
  }, [])

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
  const pending = users.filter((u) => !u.is_active && u.approved_at === null)
  const rest = users.filter((u) => !pending.includes(u))

  return (
    <>
      <PageHeader
        title="ผู้ใช้และสิทธิ์"
        subtitle="พนักงานออฟฟิศเข้าระบบด้วยบัญชี TMS บริษัท — ที่นี่กำหนดว่าใครเห็นอะไรได้บ้าง"
      />

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

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
                    <td>
                      {u.is_active && (
                        <Button size="sm" variant="ghost" onClick={() => setToRevoke(u)}>
                          ระงับ
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
    </>
  )
}
