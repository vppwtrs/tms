/**
 * แผ่นเก็บหลักฐานการส่ง (POD) ของคนขับ
 *
 * แยกออกมาจาก CloudMyJobs วันที่ 27 ส.ค. 69 — เดิมอยู่ท้ายไฟล์เดียวกับจอคนขับ
 * รวมกันแล้ว 1,553 บรรทัด ทั้งที่สองส่วนนี้ไม่ได้แชร์ state กันเลยสักตัว
 * คุยกันผ่าน props สี่ตัวเท่านั้น การอยู่ไฟล์เดียวกันจึงเป็นแค่เรื่องบังเอิญทางประวัติ
 */
import { useEffect, useRef, useState } from 'react'
import {
  savePodWithPhotos, POD_PHOTO_KINDS, type PodPhoto,
} from '../../api/myjobs'
import { uploadPodPhoto } from '../../api/storage'
import { useToast } from '../../context/ToastContext'
import type { MyJobOrder } from '../../types'
import { fmtDateTime } from '../../utils/format'
import { Button, Field, Input, Modal, Textarea } from '../ui'
import { SignaturePad } from '../SignaturePad'
import { CameraCapture } from '../CameraCapture'
import type { CompressedImage } from '../../utils/image'

const podKindLabel = (kind: string): string =>
  POD_PHOTO_KINDS.find((k) => k.kind === kind)?.label ?? kind

/* สามมุมที่ต้องมีทุกครั้ง เรียงตามลำดับที่มันเกิดขึ้นจริงหน้าร้าน —
   ยกของลง (สินค้า) ยืนถอยออกมา (หน้าร้าน) ยื่นเอกสารให้เซ็น (ใบเซ็นรับ)
   ลำดับนี้ไม่ใช่ความชอบ มันคือทางเดินของคนถือของ การให้เลือกเองทุกครั้ง
   แปลว่าต้องคิดเรื่องลำดับใหม่ที่ร้านที่ห้าสิบของสัปดาห์ */
const POD_STEPS = [
  { kind: 'goods', hint: 'ให้เห็นของทั้งกองที่ยกลงจากรถ' },
  { kind: 'shopfront', hint: 'ให้เห็นป้ายชื่อร้านหรือหน้าอาคาร' },
  { kind: 'document', hint: 'ให้อ่านเลขที่ใบและลายเซ็นออก' },
] as const

const podStepHint = (kind: string): string => POD_STEPS.find((s) => s.kind === kind)?.hint ?? ''

/**
 * เก็บ POD จากในรถ — ลายเซ็น + ชื่อผู้รับ + รูปหน้างาน + พิกัด ครบในครั้งเดียว
 *
 * รับมาเป็น "ใบทั้งหมดของร้านนี้" ลายเซ็นชุดเดียวถูกบันทึกลงทุกใบ เพราะผู้รับ
 * เซ็นรับของทั้งกองครั้งเดียวจริง ๆ ส่วนฐานยังเก็บ POD ผูกกับใบเหมือนเดิม
 * ฝ่ายบัญชีจึงยังเปิดหลักฐานรายใบได้
 */
export function PodSheet({ orders, onClose, onSaved, onUndo }: {
  orders: MyJobOrder[]
  onClose: () => void
  onSaved: () => void
  /* กดผิดร้าน — ถอนการปิดส่งทั้งร้านแล้วออกจากฟอร์ม ไม่ส่งมา = ไม่มีสิทธิ์ถอน */
  onUndo?: () => void
}): React.JSX.Element {
  const toast = useToast()
  const order = orders[0] as MyJobOrder
  /* สองหน้า ไม่ใช่ฟอร์มเดียวยาว ๆ — หน้าหนึ่งทำด้วยมือตัวเอง (ถ่ายรูป)
     อีกหน้าต้องยื่นมือถือให้คนอื่น (เซ็น) คนละสถานการณ์ทางกายภาพ
     ยัดไว้หน้าเดียวแปลว่าต้องเลื่อนหาของกลางฟอร์มขณะยืนถือของอยู่

     ลำดับสลับได้ — หน้างานจริงไม่ได้เดินทางเดียว บางร้านเจ้าของยืนรออยู่แล้ว
     ยื่นมือให้เซ็นทันทีตั้งแต่ยังไม่ยกของลง บางร้านต้องยกของเข้าไปในร้านก่อน
     กว่าจะหาคนเซ็นเจอ บังคับลำดับเดียวคือบังคับให้คนขับยืนรอในจังหวะที่ไม่ต้องรอ

     เปิดมาที่หน้าเซ็น เพราะผู้รับคือฝ่ายที่เดินหายไปได้ ส่วนของที่ต้องถ่ายยังอยู่
     ที่เดิมเสมอ ถ่ายรูปก่อนยังทำได้ด้วยปุ่ม "ไปถ่ายรูป" ที่หน้านี้ */
  const [step, setStep] = useState<'photo' | 'sign'>('sign')
  /* path ของรูปที่อัปขึ้นถังแล้วตั้งแต่จบหน้าแรก — หน้าสองมีแค่ลายเซ็นกับปุ่มบันทึก
     ซึ่งเร็ว ผู้รับจึงไม่ต้องยืนรอโหลดรูปทั้งกองโดยถือมือถือของคนอื่นไว้ */
  const [photos, setPhotos] = useState<PodPhoto[] | null>(null)
  const [name, setName] = useState(order.customer_name ?? '')
  const [sig, setSig] = useState('')
  const [note, setNote] = useState('')
  /* หมายเหตุพับไว้ก่อน — ส่วนใหญ่ไม่มีอะไรจะเขียน กล่องที่ว่างตลอดเวลา
     คือความยาวที่ทุกคนต้องเลื่อนผ่านโดยไม่ได้ใช้ */
  const [noteOpen, setNoteOpen] = useState(false)
  /* หลายมุมต่อหนึ่งใบ — ข้อโต้แย้งเรื่องการส่งของถามหลายอย่างพร้อมกัน
     ของที่ส่ง สภาพหน้าร้าน และใบเซ็นรับ รูปเดียวตอบได้ข้อเดียว */
  const [shots, setShots] = useState<{ img: CompressedImage; kind: string }[]>([])
  const [kind, setKind] = useState<string>(POD_STEPS[0].kind)
  /* ถ่ายมุมที่ขาดไม่ได้จริง ๆ (ร้านไม่มีป้าย ไม่มีใบให้เซ็น) — เปิดทางออกไว้
     แต่ต้องกดเอง ไม่ใช่ปล่อยผ่านเงียบ ๆ ทุกครั้งที่ขี้เกียจถ่าย */
  const [relaxed, setRelaxed] = useState(false)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [saving, setSaving] = useState(false)

  const taken = new Set(shots.map((s) => s.kind))
  const missing = POD_STEPS.filter((s) => !taken.has(s.kind)).map((s) => s.kind)
  const stepNo = POD_STEPS.length - missing.length + 1

  /* ประทับมุมขวาล่างของรูปทุกใบ — ร้าน วันเวลา พิกัด
     เป็นฟังก์ชันเพราะเวลาต้องเป็นวินาทีที่กดชัตเตอร์ ไม่ใช่วินาทีที่เปิดฟอร์ม */
  const stampLines = (): string[] => {
    const lines = [order.customer_name ?? order.destination, new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })]
    if (coords) lines.push(`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`)
    return lines
  }

  /* ถ่ายเสร็จแล้วเลื่อนไปมุมถัดไปที่ยังขาดเอง — คนขับถือของอยู่ ไม่ควรต้องกลับมา
     กดชิปเปลี่ยนมุมเองทุกใบ ครบสามมุมแล้วค้างไว้ที่ "อื่น ๆ" สำหรับรูปเสริม */
  const capture = (img: CompressedImage): void => {
    const next = [...shots, { img, kind }]
    setShots(next)
    const have = new Set(next.map((s) => s.kind))
    const left = POD_STEPS.filter((s) => !have.has(s.kind))
    const nextKind = left[0]?.kind ?? 'other'
    setKind(nextKind)
    toast.push(
      'success',
      left.length > 0
        ? `เก็บ${podKindLabel(kind)}แล้ว — ต่อไปถ่าย${podKindLabel(nextKind)}`
        : 'ครบทั้งสามมุมแล้ว — บันทึกได้เลย',
    )
  }

  // ปล่อย object URL ของรูปเมื่อปิดฟอร์ม — ไม่งั้นค้างใน memory ทั้งวัน
  useEffect(() => () => { shots.forEach((s) => URL.revokeObjectURL(s.img.url)) }, [shots])

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {
        /* ปฏิเสธตำแหน่งได้ — POD ยังบันทึกได้ แค่ไม่มีพิกัดแนบ */
      },
      { timeout: 8000 },
    )
  }, [])

  /* หน้าแรก: ชื่อผู้รับ + รูป → อัปรูปขึ้นถังทันทีที่กดบันทึก แล้วไปหน้าลายเซ็น
     งานหนักทั้งหมด (อัปโหลด) จบตั้งแต่ตอนที่มือถือยังอยู่ในมือคนขับ */
  const submitPhotos = async (): Promise<void> => {
    if (!name.trim()) {
      toast.push('warning', 'ใส่ชื่อผู้รับก่อน')
      return
    }
    /* รูปเป็นของบังคับ — ลายเซ็นบอกว่ามีคนเซ็น รูปบอกว่าส่งอะไรไปและสภาพเป็นยังไง
       ฝั่งฐานปฏิเสธอยู่แล้ว ดักตรงนี้เพื่อไม่ให้คนขับเสียเวลาอัปโหลดแล้วเจอ error */
    if (shots.length === 0) {
      toast.push('warning', 'ต้องถ่ายรูปอย่างน้อยหนึ่งรูป')
      return
    }
    if (missing.length > 0 && !relaxed) {
      toast.push('warning', `ยังขาด ${missing.map((k) => podKindLabel(k)).join(' และ ')}`)
      return
    }
    setSaving(true)
    try {
      /* อัปโหลดรูปขึ้น Storage ก่อน แล้วค่อยบันทึก POD พร้อม path ในหน้าถัดไป
         ลำดับนี้สำคัญ: ถ้าบันทึก POD ก่อนแล้วอัปรูปพลาด จะได้หลักฐานที่อ้างถึงรูปที่ไม่มีอยู่
         กลับกัน ถ้าอัปรูปสำเร็จแต่บันทึกพลาด ก็แค่มีรูปกำพร้าค้างในถัง ซึ่งไม่ทำใครเดือดร้อน */
      const uploaded: PodPhoto[] = []
      for (const shot of shots) {
        uploaded.push({
          path: await uploadPodPhoto(order.id, shot.img.blob, { ext: shot.img.ext, type: shot.img.type }),
          kind: shot.kind,
        })
      }
      setPhotos(uploaded)
      /* เซ็นมาก่อนแล้ว = ครบทั้งคู่ บันทึกจบตรงนี้เลย ไม่ต้องพาไปหน้าเซ็นซ้ำ
         ซึ่งจะกลายเป็นการขอลายเซ็นคนที่เดินกลับเข้าร้านไปแล้ว */
      if (sig) await savePod(uploaded, sig)
      else setStep('sign')
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /* เขียนฐานจริง — เรียกจากหน้าไหนก็ได้ที่ทำให้ครบทั้งรูปและลายเซ็น
     ทีละใบตามลำดับ รูปชุดเดียวถูกอ้างจากทุกใบ ไม่ต้องอัปซ้ำตามจำนวนใบ */
  const savePod = async (uploaded: PodPhoto[], signature: string): Promise<void> => {
    for (const o of orders) {
      await savePodWithPhotos({
        orderId: o.id,
        recipientName: name,
        signatureData: signature,
        photos: uploaded,
        notes: note || null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      })
    }
    onSaved()
  }

  /* หน้าลายเซ็น — ถ้ารูปอัปไว้แล้วคือจบงาน ถ้ายังคือเพิ่งเซ็นเป็นอย่างแรก
     แล้วไปถ่ายรูปต่อ ลายเซ็นเก็บไว้ในหน่วยความจำ ยังไม่แตะฐานจนกว่าจะครบทั้งคู่ */
  const submitSignature = async (): Promise<void> => {
    if (!sig) {
      toast.push('warning', 'ให้ผู้รับเซ็นก่อน')
      return
    }
    if (!photos) {
      setStep('photo')
      toast.push('success', 'เก็บลายเซ็นไว้แล้ว — ถ่ายรูปให้ครบแล้วกดบันทึก')
      return
    }
    setSaving(true)
    try {
      await savePod(photos, sig)
    } catch (e) {
      toast.push('error', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /* ทับทั้งแผ่นตอนกำลังบันทึก — ปุ่มหมุน ๆ ปุ่มเดียวเล็กเกินกว่าที่คนซึ่งกำลัง
     ยืนกลางแดดจะเห็น แล้วเขาจะกดซ้ำ ซึ่งแปลว่าอัปรูปซ้ำทั้งกอง */
  const savingVeil = saving && (
    <div className="pod-veil" role="status" aria-live="polite">
      <span className="spin" aria-hidden="true">⟳</span>
      <b>{step === 'photo' ? 'กำลังอัปโหลดรูป' : 'กำลังบันทึกหลักฐาน'}</b>
      <span>อย่าเพิ่งปิดหน้านี้</span>
    </div>
  )

  /* ทางออกของคนที่เพิ่งกดปิดส่งผิดร้าน — ต้องขึ้นทั้งสองหน้า เพราะฟอร์มเด้งขึ้นเอง
     ทันทีหลังกดปิดส่ง และหน้าแรกที่เห็นเปลี่ยนได้ตามลำดับที่คนขับเลือก
     คนที่กดผิดรู้ตัวตอนอ่านชื่อร้านบนหัวฟอร์ม ไม่ใช่ตอนกลับไปที่รายการ
     ล่างสุดของหน้าเสมอ ไม่แย่งที่กับกล้องหรือช่องเซ็น */
  const undoButton = onUndo && (
    <button type="button" className="pod-undo" onClick={onUndo} disabled={saving}>
      ไม่ใช่ร้านนี้ — ยกเลิกการส่ง
    </button>
  )

  /* ป้ายขั้นตอน — ลำดับยังไม่ถูกกำหนดจนกว่าจะทำขั้นแรกเสร็จจริง ก่อนหน้านั้นจึงบอก
     แค่ชื่อขั้น ไม่ติดเลข ไม่งั้นเลข "1" เปลี่ยนความหมายใต้มือคนขับตอนสลับหน้าเปล่า ๆ
     พอมีของขั้นแรกแล้ว เลขล็อกตามลำดับที่เขาทำจริง ไม่ใช่ลำดับที่เราคิดไว้ก่อน */
  const podSteps = (() => {
    const label = (k: 'photo' | 'sign'): string => (k === 'photo' ? 'รูป' : 'ลายเซ็น')
    const other = (k: 'photo' | 'sign'): 'photo' | 'sign' => (k === 'photo' ? 'sign' : 'photo')
    const done: 'photo' | 'sign' | null = photos ? 'photo' : sig ? 'sign' : null
    const first = done ?? step
    const order: ('photo' | 'sign')[] = [first, other(first)]
    return (
      /* เลขใน aria คือหน้าที่กำลังเปิดอยู่ ไม่ใช่จำนวนขั้นที่ทำไปแล้ว — คนที่ฟัง
         ด้วยเสียงต้องรู้ว่าตัวเองยืนอยู่ตรงไหน ไม่ใช่ว่าเหลืออะไรอีก */
      <div className="pod-steps" aria-label={`ขั้นตอนที่ ${order.indexOf(step) + 1} จาก ${order.length}`}>
        {order.map((k, i) => (
          <span key={k} className={done === k ? 'is-done' : k === step ? 'is-now' : ''}>
            {done ? `${i + 1} · ${label(k)}` : label(k)}
          </span>
        ))}
      </div>
    )
  })()

  /* ---- หน้าที่ 2: ลายเซ็น ----
     ยื่นมือถือให้ผู้รับตอนนี้ จอมีของอยู่อย่างเดียวคือช่องเซ็น ไม่มีปุ่มอื่นให้กดพลาด
     และไม่มีทางถอยกลับไปแก้รูป — รูปขึ้นถังไปแล้ว การให้ถอยคือให้อัปซ้ำ */
  if (step === 'sign') {
    return (
      <Modal
        open
        onClose={onClose}
        size="sheet"
        title={`ให้ผู้รับเซ็น — ${order.customer_name ?? order.destination}`}
        footer={
          <div className="pod-actions">
            <Button
              variant="ghost"
              onClick={() => (photos ? onClose() : setStep('photo'))}
              disabled={saving}
            >
              {photos ? 'ปิดไว้ก่อน' : 'ไปถ่ายรูป'}
            </Button>
            <Button onClick={() => void submitSignature()} loading={saving} disabled={!sig}>
              {!photos ? 'เก็บลายเซ็น — ไปถ่ายรูป'
                : orders.length > 1 ? `บันทึก ${orders.length} ใบ` : 'บันทึกหลักฐาน'}
            </Button>
          </div>
        }
      >
        {savingVeil}
        {/* ป้ายขั้นตอนเดินตามลำดับที่คนขับเลือกจริง ไม่ใช่ลำดับที่เราคิดไว้ก่อน */}
        {podSteps}

        <div className="pod-meta">
          <span>{photos ? `อัปรูปแล้ว ${photos.length} รูป` : 'ยังไม่ได้ถ่ายรูป — เซ็นก่อนได้ แล้วค่อยไปถ่าย'}</span>
          {orders.length > 1 && <span>ลายเซ็นเดียวใช้กับ {orders.length} ใบของร้านนี้</span>}
          <span>{coords ? `แนบพิกัดแล้ว · ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : 'ไม่ได้พิกัด — บันทึกได้ตามปกติ'}</span>
        </div>

        <div className="pod-section">
          <div className="pod-row-head">
            <h4>ลายเซ็นผู้รับ <span className="req">*</span></h4>
            <span className="text-xs text-muted">{name}</span>
          </div>
          {/* หน้านี้มีของอยู่อย่างเดียว จึงยกช่องเซ็นให้เต็มที่เท่าที่จอมี
              150px เตี้ยเกินกว่าจะเซ็นชื่อจริงด้วยนิ้ว — ลายเซ็นที่บีบจนไม่เหมือนของตัวเอง
              คือลายเซ็นที่คนเซ็นไม่ยอมรับตอนมีข้อโต้แย้ง
              min() ทำให้พอดีทั้งจอเตี้ยและจอสูง โดยไม่ดันปุ่มบันทึกตกจอ */}
          <SignaturePad onChange={setSig} height="min(52vh, 460px)" compact />
        </div>

        {undoButton}
      </Modal>
    )
  }

  /* ---- หน้าที่ 1: ชื่อผู้รับ + รูป ---- */
  return (
    <Modal
      open
      onClose={onClose}
      size="sheet"
      /* บอร์ด Design C จอ 4: ขั้นถ่ายรูปเป็นพื้นเข้มทั้งจอ ภาพในช่องมองจึงเด่นที่สุด */
      className="is-pod-photo"
      title={`ถ่ายรูปหน้างาน — ${order.customer_name ?? order.destination}`}
      footer={
        <div className="pod-actions">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            ปิดไว้ก่อน
          </Button>
          <Button
            onClick={() => void submitPhotos()}
            loading={saving}
            disabled={!name.trim() || shots.length === 0 || (missing.length > 0 && !relaxed)}
          >
            {missing.length > 0 && !relaxed ? `ยังขาด ${missing.length} มุม`
              : sig ? 'บันทึกหลักฐาน' : 'บันทึกรูป — ไปหน้าลายเซ็น'}
          </Button>
        </div>
      }
    >
      {savingVeil}
      {podSteps}

      <div className="pod-meta">
        {orders.length > 1 && <span>ปิดพร้อมกัน {orders.length} ใบของร้านนี้</span>}
        {/* ทางเข้าหน้าเซ็นตั้งแต่ยังไม่ถ่ายรูป — เจ้าของร้านที่ยืนรออยู่ตรงหน้า
            คือคนที่เดินหายไปได้ทุกเมื่อ ส่วนรูปถ่ายเมื่อไหร่ก็ได้ ของยังอยู่ที่เดิม */}
        <button type="button" className="pod-swap" onClick={() => setStep('sign')} disabled={saving}>
          {sig ? 'เซ็นไว้แล้ว — แก้ลายเซ็น' : 'ให้ผู้รับเซ็นก่อน'}
        </button>
        {/* พิกัดเคยอยู่ท้ายสุดของฟอร์ม ซึ่งคือที่ที่ไม่มีใครเลื่อนไปอ่าน
            ทั้งที่เป็นของที่แนบให้อยู่แล้วโดยไม่ต้องทำอะไร */}
        <span>{coords ? `แนบพิกัดแล้ว · ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : 'ไม่ได้พิกัด — บันทึกได้ตามปกติ'}</span>
      </div>

      {/* คำสั่งเดียวบนจอ ตัวใหญ่ อ่านจบในแวบเดียว — คนขับไม่ได้มาอ่านฟอร์ม
          เขามาถ่ายรูปสามใบแล้วไปต่อ บอกไปเลยว่าตอนนี้ต้องเล็งอะไร */}
      <div className={`pod-guide${missing.length === 0 ? ' is-done' : ''}`} role="status" aria-live="polite">
        {missing.length === 0 ? (
          <>
            <b>ครบทั้งสามมุมแล้ว</b>
            <span>ถ่ายเพิ่มได้ถ้าต้องการ หรือกดบันทึกที่ปุ่มข้างล่าง</span>
          </>
        ) : (
          <>
            <b>ขั้นที่ {stepNo} จาก {POD_STEPS.length} · ถ่าย{podKindLabel(kind)}</b>
            <span>{podStepHint(kind) || 'รูปเสริมของร้านนี้'}</span>
          </>
        )}
      </div>

      {/* มุมของรูปที่กำลังจะถ่าย — อยู่เหนือช่องมองภาพ เพราะเป็นสิ่งที่ตอบก่อนกดชัตเตอร์
          ปกติไม่ต้องแตะเลย ระบบเลื่อนให้เองหลังถ่ายแต่ละใบ มีไว้ให้ข้ามหรือย้อน
          เมื่อหน้างานไม่เดินตามลำดับ เช่นเจ้าของร้านยื่นใบให้เซ็นตั้งแต่ยังไม่ยกของลง */}
      <div className="pod-kinds" role="group" aria-label="มุมของรูปที่กำลังจะถ่าย">
        {POD_PHOTO_KINDS.map((k) => {
          const n = shots.filter((sh) => sh.kind === k.kind).length
          return (
            <button
              key={k.kind}
              type="button"
              className="pod-kind"
              aria-pressed={kind === k.kind}
              onClick={() => setKind(k.kind)}
              disabled={saving}
            >
              {k.label}
              {n > 0 && <b aria-label={`ถ่ายแล้ว ${n} รูป`}>{n}</b>}
            </button>
          )
        })}
      </div>

      {/* ช่องมองภาพเปิดเองตั้งแต่เข้าหน้า และไม่ปิดหลังถ่าย — จอนี้คือกล้อง
          ไม่ใช่ฟอร์มที่มีปุ่มเปิดกล้องอยู่ข้างใน */}
      <CameraCapture stage onCapture={capture} disabled={saving} stamp={stampLines} />

      {/* ฟิล์มรูปที่ถ่ายแล้ว เรียงแนวนอนใต้กล้อง เห็นทันทีว่าถ่ายอะไรไปบ้าง ลบได้ทีละใบ */}
      <div className="pod-strip">
        {shots.length === 0 ? (
          <p className="pod-strip-empty">ยังไม่มีรูป — ต้องถ่ายให้ครบสามมุมถึงจะบันทึกได้</p>
        ) : (
          shots.map((shot, i) => (
            <div className="pod-shot" key={shot.img.url}>
              <img src={shot.img.url} alt={`รูป${podKindLabel(shot.kind)}ที่ถ่ายไว้`} />
              <button
                type="button"
                aria-label={`ลบรูป${podKindLabel(shot.kind)}`}
                onClick={() => {
                  URL.revokeObjectURL(shot.img.url)
                  setShots(shots.filter((_, x) => x !== i))
                }}
              >
                ✕
              </button>
              <span className="pod-shot-kind">{podKindLabel(shot.kind)}</span>
            </div>
          ))
        )}
      </div>

      {/* ร้านที่ไม่มีป้ายชื่อ หรือไม่มีใบให้เซ็นสักใบ มีจริง — บังคับแบบไม่มีทางออก
          แปลว่าคนขับจะถ่ายพื้นถนนมาให้ครบจำนวนแทน ซึ่งแย่กว่าการรู้ว่าขาดมุมไหน
          กดแล้วบันทึกได้ทันที และมุมที่ขาดยังขาดอยู่ในฐานตามจริง */}
      {missing.length > 0 && shots.length > 0 && (
        relaxed ? (
          <p className="pod-relaxed">
            จะบันทึกโดยไม่มี{missing.map((k) => podKindLabel(k)).join(' และ ')}
            {' '}
            <button type="button" onClick={() => setRelaxed(false)}>ยกเลิก</button>
          </p>
        ) : (
          <button type="button" className="pod-relax" onClick={() => setRelaxed(true)} disabled={saving}>
            ถ่าย{missing.map((k) => podKindLabel(k)).join('/')}ไม่ได้ — บันทึกเท่าที่ถ่ายได้
          </button>
        )
      )}

      {/* ของที่พิมพ์ อยู่ใต้ของที่ถ่าย — ชื่อผู้รับเติมมาจากชื่อลูกค้าให้แล้ว
          ส่วนใหญ่ไม่ต้องแตะเลย จึงไม่ควรนั่งอยู่เหนือกล้องซึ่งเป็นงานจริงของหน้านี้ */}
      <div className="pod-section">
        <Field label="ชื่อผู้รับสินค้า" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>

      <div className="pod-section">
        {noteOpen || note ? (
          <Field label="หมายเหตุ">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ของครบ สภาพเรียบร้อย" />
          </Field>
        ) : (
          <button type="button" className="pod-note-toggle" onClick={() => setNoteOpen(true)}>
            + เพิ่มหมายเหตุ
          </button>
        )}
      </div>

      {undoButton}
    </Modal>
  )
}
