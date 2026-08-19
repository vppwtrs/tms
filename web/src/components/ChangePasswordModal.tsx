import { useState } from 'react'
import { changeMyPassword } from '../api/auth'
import { Button, Field, Input, Modal } from './ui'

/**
 * เปลี่ยนรหัสผ่านของบัญชีที่ล็อกอินอยู่ — ตัวเดียวใช้ได้ทุกหน้า
 *
 * เดิมฟอร์มนี้ฝังอยู่ในหน้า "ผู้ใช้และสิทธิ์" หน้าเดียว ซึ่งต้องมีสิทธิ์ users.manage
 * แปลว่าคนขับ ผู้วางแผนงาน และคนดูอย่างเดียว **เปลี่ยนรหัสของตัวเองไม่ได้เลย**
 * ทั้งที่รหัสแรกของพวกเขาเป็นรหัสสุ่มที่ผู้ดูแลอ่านให้ฟังทางโทรศัพท์
 *
 * โหมด forced ใช้ตอนบังคับตั้งรหัสใหม่ครั้งแรก — ปิดหน้าต่างทิ้งไม่ได้
 * และยังต้องกรอกรหัสเดิมเหมือนเดิม เพราะคนที่นั่งหน้าจอค้างไว้ของคนอื่น
 * ไม่ควรตั้งรหัสใหม่ทับได้โดยไม่รู้รหัสเดิม
 */
export function ChangePasswordModal({
  open,
  onClose,
  onDone,
  forced = false,
}: {
  open: boolean
  onClose: () => void
  onDone?: () => void
  forced?: boolean
}): React.JSX.Element {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (form.next.length < 8) { setError('รหัสใหม่ต้องมีอย่างน้อย 8 ตัวอักษร'); return }
    if (form.next !== form.confirm) { setError('รหัสใหม่กับการยืนยันรหัสไม่ตรงกัน'); return }
    if (form.next === form.current) { setError('รหัสใหม่ต้องไม่ซ้ำกับรหัสเดิม'); return }
    setBusy(true)
    try {
      await changeMyPassword(form.current, form.next)
      setForm({ current: '', next: '', confirm: '' })
      setError(null)
      onDone?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      /* forced: กดนอกกรอบหรือ Esc แล้วไม่ปิด — ยังไม่ตั้งรหัสก็ยังใช้ระบบไม่ได้อยู่ดี */
      onClose={forced ? () => {} : onClose}
      title={forced ? 'ตั้งรหัสผ่านของคุณเอง' : 'เปลี่ยนรหัสผ่านของฉัน'}
    >
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--muted)' }}>
        {forced
          ? 'รหัสที่ใช้อยู่ตอนนี้เป็นรหัสชั่วคราวที่ผู้ดูแลตั้งให้ และมีคนอื่นเห็นแล้ว ตั้งรหัสของคุณเองก่อนเริ่มใช้งาน'
          : 'เปลี่ยนเฉพาะบัญชีที่กำลังล็อกอินอยู่ ต้องยืนยันรหัสเดิมก่อน'}
      </p>
      {error && (
        <div role="alert" style={{ padding: '10px 12px', marginBottom: 12, borderRadius: 8, color: 'var(--danger)', background: 'var(--danger-bg)' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        <Field label={forced ? 'รหัสชั่วคราวที่ได้รับมา' : 'รหัสผ่านเดิม'} required>
          <Input type="password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} autoComplete="current-password" />
        </Field>
        <Field label="รหัสผ่านใหม่" required hint="อย่างน้อย 8 ตัวอักษร">
          <Input type="password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} autoComplete="new-password" />
        </Field>
        <Field label="ยืนยันรหัสผ่านใหม่" required>
          <Input type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" />
        </Field>
        <Button loading={busy} onClick={() => void submit()} disabled={!form.current || !form.next || !form.confirm}>
          บันทึกรหัสผ่านใหม่
        </Button>
      </div>
    </Modal>
  )
}
