import { useCallback, useEffect, useState } from 'react'
import { api, apiUpload, fetchPodPhoto } from '../api/client'
import type { Order, Pod } from '../types'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { Badge, Button, Field, Input, Modal, Textarea } from './ui'
import { SignaturePad } from './SignaturePad'
import { fmtDateTime, fmtNum } from '../utils/format'
import { IconCheck, IconPin } from './icons'

interface PodModalProps {
  open: boolean
  order: Order
  onClose: () => void
  onChanged: () => void
}

export function PodModal({ open, order, onClose, onChanged }: PodModalProps): React.JSX.Element | null {
  const { push } = useToast()
  const { user } = useAuth()
  const canEdit = user?.role !== 'viewer'

  const [pod, setPod] = useState<Pod | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [recipient, setRecipient] = useState('')
  const [signature, setSignature] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [gps, setGps] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null })
  const [locating, setLocating] = useState(false)

  // โหลด POD ของออเดอร์ + รูปหลักฐาน
  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const data = await api.get<Pod | null>(`/pod/order/${order.id}`)
      setPod(data)
      if (data) {
        setRecipient(data.recipient_name)
        setSignature(data.signature_data)
        setNotes(data.notes ?? '')
        setGps({ lat: data.lat, lng: data.lng })
        if (data.photo_path) {
          try {
            const url = await fetchPodPhoto(data.id)
            setPhotoUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev)
              return url
            })
          } catch {
            /* ไม่มีรูป */
          }
        } else {
          setPhotoUrl(null)
        }
      } else {
        setRecipient('')
        setSignature('')
        setNotes('')
        setGps({ lat: null, lng: null })
        setPhotoUrl(null)
      }
      setPhotoFile(null)
      setEditing(false)
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'โหลด POD ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [order.id, push])

  useEffect(() => {
    if (open) void load()
    return () => {
      setPhotoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [open, load])

  const captureLocation = (): void => {
    if (!navigator.geolocation) {
      push('warning', 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: Math.round(pos.coords.latitude * 100000) / 100000, lng: Math.round(pos.coords.longitude * 100000) / 100000 })
        setLocating(false)
        push('success', 'บันทึกตำแหน่งแล้ว')
      },
      () => {
        setLocating(false)
        push('warning', 'ไม่สามารถระบุตำแหน่งได้ — อาจถูกเบราว์เซอร์บล็อก')
      },
      { enableHighAccuracy: false, timeout: 8000 },
    )
  }

  const buildForm = (): FormData => {
    const form = new FormData()
    form.set('recipient_name', recipient.trim())
    if (signature) form.set('signature_data', signature)
    form.set('notes', notes.trim() || '')
    if (gps.lat != null && gps.lng != null) {
      form.set('lat', String(gps.lat))
      form.set('lng', String(gps.lng))
    }
    if (photoFile) form.set('photo', photoFile)
    return form
  }

  const save = async (): Promise<void> => {
    if (!recipient.trim()) {
      push('warning', 'ระบุชื่อผู้รับสินค้า')
      return
    }
    if (!signature) {
      push('warning', 'วาดลายเซ็นผู้รับก่อนบันทึก')
      return
    }
    setSaving(true)
    try {
      if (pod) {
        await apiUpload<Pod>('PUT', `/pod/${pod.id}`, buildForm())
        push('success', 'บันทึก POD เรียบร้อย')
      } else {
        const form = buildForm()
        form.set('order_id', String(order.id))
        await apiUpload<Pod>('POST', '/pod', form)
        push('success', 'เก็บ POD เรียบร้อย — หลักฐานการส่งมอบถูกบันทึก')
      }
      await load()
      onChanged()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'บันทึก POD ไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const verify = async (): Promise<void> => {
    if (!pod) return
    setSaving(true)
    try {
      await api.patch(`/pod/${pod.id}/verify`)
      push('success', 'ยืนยัน POD แล้ว — หลักฐานถูกล็อกถาวร')
      await load()
      onChanged()
    } catch (e) {
      push('error', e instanceof Error ? e.message : 'ยืนยันไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const podReady = pod && !editing

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`POD — ${order.order_no}`}
      size="lg"
      footer={
        podReady ? (
          <>
            {canEdit && pod.status === 'collected' && (
              <>
                <Button variant="ghost" onClick={() => setEditing(true)}>แก้ไข</Button>
                <Button variant="success" icon={<IconCheck size={15} />} onClick={verify} loading={saving}>
                  ยืนยันหลักฐาน
                </Button>
              </>
            )}
            <Button variant="primary" onClick={onClose}>ปิด</Button>
          </>
        ) : (
          <>
            {pod && <Button variant="ghost" onClick={() => setEditing(false)}>ยกเลิก</Button>}
            <Button variant="accent" onClick={save} loading={saving}>
              {pod ? 'บันทึกการแก้ไข' : 'บันทึก POD'}
            </Button>
          </>
        )
      }
    >
      {loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : podReady ? (
        /* ===== โหมดดู ===== */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Badge label={pod.status === 'verified' ? 'ยืนยันแล้ว' : 'เก็บแล้ว'} tone={pod.status === 'verified' ? 'delivered' : 'in_transit'} dot={pod.status === 'collected'} />
            <span className="text-sm text-muted">
              เก็บโดย <b className="text-strong">{pod.collected_by_name}</b> · {fmtDateTime(pod.collected_at)}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div className="text-sm text-strong" style={{ marginBottom: 6 }}>ผู้รับสินค้า</div>
              <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)' }}>{pod.recipient_name}</div>
            </div>
            <div>
              <div className="text-sm text-strong" style={{ marginBottom: 6 }}>ตำแหน่ง</div>
              <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
                {pod.lat != null && pod.lng != null ? (
                  <span className="text-sm">
                    <IconPin size={14} style={{ verticalAlign: -2 }} /> {fmtNum(pod.lat)}, {fmtNum(pod.lng)}
                  </span>
                ) : (
                  <span className="text-muted text-sm">ไม่มีการบันทึกตำแหน่ง</span>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="text-sm text-strong" style={{ marginBottom: 6 }}>ลายเซ็นผู้รับ</div>
            <img src={pod.signature_data} alt="ลายเซ็นผู้รับ" style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, background: '#fff', maxHeight: 180, objectFit: 'contain' }} />
          </div>

          <div>
            <div className="text-sm text-strong" style={{ marginBottom: 6 }}>รูปหลักฐาน</div>
            {photoUrl ? (
              <img src={photoUrl} alt="รูปหลักฐานการส่งมอบ" style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, maxHeight: 260, objectFit: 'contain', background: 'var(--surface-2)' }} />
            ) : (
              <div style={{ padding: 20, textAlign: 'center', background: 'var(--surface-2)', borderRadius: 10, border: '1px dashed var(--line-strong)', color: 'var(--muted)', fontSize: 13 }}>
                ไม่มีรูปหลักฐาน
              </div>
            )}
          </div>

          {pod.notes && (
            <div>
              <div className="text-sm text-strong" style={{ marginBottom: 6 }}>หมายเหตุ</div>
              <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)' }}>{pod.notes}</div>
            </div>
          )}
        </div>
      ) : (
        /* ===== โหมดสร้าง/แก้ไข ===== */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-grid">
            <Field label="ชื่อผู้รับสินค้า" required>
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="เช่น คุณสมชาย ใจดี" />
            </Field>
            <Field label="ตำแหน่ง (GPS)">
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={gps.lat != null && gps.lng != null ? `${gps.lat}, ${gps.lng}` : ''}
                  readOnly
                  placeholder="ยังไม่ระบุ"
                  aria-label="ตำแหน่ง (GPS)"
                />
                <Button variant="outline" size="sm" onClick={captureLocation} loading={locating} title="บันทึกตำแหน่งจากอุปกรณ์">
                  <IconPin size={14} />
                </Button>
              </div>
            </Field>
          </div>

          <Field label="ลายเซ็นผู้รับ (วาดด้านล่าง)" required>
            <SignaturePad onChange={setSignature} />
          </Field>

          <Field label="รูปหลักฐาน (สินค้าที่ส่ง / ใบรับสินค้า)" hint="ไฟล์ JPG/PNG/WebP ไม่เกิน 5MB">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                setPhotoFile(file)
                if (file) {
                  setPhotoUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev)
                    return null
                  })
                  setPhotoUrl(URL.createObjectURL(file))
                }
              }}
              style={{ fontSize: 13 }}
            />
            {photoUrl && (
              <img src={photoUrl} alt="ตัวอย่างรูป" style={{ marginTop: 8, maxHeight: 140, border: '1px solid var(--line)', borderRadius: 8 }} />
            )}
          </Field>

          <Field label="หมายเหตุการส่งมอบ">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="เช่น สินค้าครบ / รถติดส่งล่าช้า 30 นาที" />
          </Field>
        </div>
      )}
    </Modal>
  )
}
