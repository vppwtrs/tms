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
import '../../styles/driver-pod.css'
import { PhotoView } from './PhotoView'
import { SignaturePad } from '../SignaturePad'
import { compressFile, type CompressedImage } from '../../utils/image'
import { saveShotBackup, listShotBackups, removeShotBackup, clearOrderBackup } from '../../utils/podBackup'
import { clearCounts, shortNote } from '../../utils/podCount'

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
export function PodSheet({ orders, onClose, onSaved, onUndo, initialNote }: {
  orders: MyJobOrder[]
  /** หมายเหตุเริ่มต้น — ไม่ส่งมา = ใช้ยอดนับจริงจากจอถึงร้าน (ถ้านับไม่ตรง) */
  initialNote?: string
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
  /* ไม่ถามชื่อผู้รับแล้ว — ลายเซ็นกับรูปใบเซ็นรับคือหลักฐานตัวจริง ช่องชื่อเป็นแค่
     อีกช่องที่คนขับต้องพิมพ์ขณะยืนถือของ จึงบันทึกชื่อร้านแทนให้เอง */
  const [recipient, setRecipient] = useState('')
  const name = recipient.trim() || (order.customer_name ?? order.destination ?? 'ผู้รับที่ร้าน')
  const [sig, setSig] = useState('')
  const [note, setNote] = useState(() => initialNote ?? shortNote(orders.map((o) => o.id)))
  /* หมายเหตุพับไว้ก่อน — ส่วนใหญ่ไม่มีอะไรจะเขียน กล่องที่ว่างตลอดเวลา
     คือความยาวที่ทุกคนต้องเลื่อนผ่านโดยไม่ได้ใช้ */
  const [noteOpen, setNoteOpen] = useState(() => note !== '')
  /* หลายมุมต่อหนึ่งใบ — ข้อโต้แย้งเรื่องการส่งของถามหลายอย่างพร้อมกัน
     ของที่ส่ง สภาพหน้าร้าน และใบเซ็นรับ รูปเดียวตอบได้ข้อเดียว */
  const [shots, setShots] = useState<{ img: CompressedImage; kind: string; backupId: string }[]>([])
  const [kind, setKind] = useState<string>(POD_STEPS[0].kind)
  /* ถ่ายมุมที่ขาดไม่ได้จริง ๆ (ร้านไม่มีป้าย ไม่มีใบให้เซ็น) — เปิดทางออกไว้
     แต่ต้องกดเอง ไม่ใช่ปล่อยผ่านเงียบ ๆ ทุกครั้งที่ขี้เกียจถ่าย */
  const [relaxed, setRelaxed] = useState(false)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)

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
  const capture = (img: CompressedImage, kind: string): void => {
    const backupId = crypto.randomUUID()
    const next = [...shots, { img, kind, backupId }]
    setShots(next)
    /* เซฟลงเครื่องทันที ไม่รอผล — รูปต้องปลอดภัยตั้งแต่วินาทีที่กดชัตเตอร์
       ไม่ใช่รอให้อัปโหลดขึ้นระบบสำเร็จก่อน เน็ตหลุดตอนนั้นไม่ควรทำรูปหาย */
    void saveShotBackup(order.id, backupId, kind, img)
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

  /* กดช่องไหน เปิดกล้องของเครื่องทันที (ไม่มีช่องมองภาพในหน้าแล้ว — ตามที่ตกลงกัน
     เพื่อลดขั้นตอน) มุมที่จะถ่ายจำไว้ใน ref เพราะ state ยังไม่อัปเดตตอนรูปกลับมา
     Android บางรุ่นยังเลือกรูปจากคลังได้ — รูปที่ไฟล์เก่ากว่า 10 นาทีจึงขึ้นเตือน */
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingKind = useRef<string>(kind)
  const openCamera = (k: string): void => {
    pendingKind.current = k
    setKind(k)
    fileRef.current?.click()
  }
  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    const k = pendingKind.current
    try {
      if (Date.now() - file.lastModified > 10 * 60_000) {
        toast.push('error', 'รูปนี้ไม่ได้ถ่ายตอนนี้ — กรุณาถ่ายใหม่ที่หน้าร้าน')
        return
      }
      capture(await compressFile(file, stampLines()), k)
    } catch (e) {
      toast.push('error', (e as Error).message)
    }
  }

  /* กู้รูปที่ถ่ายค้างไว้จากรอบก่อนของร้านนี้ — เน็ตหลุดหรือแอปถูกปิดกลางคันตอน
     อัปโหลด รูปไม่หาย เปิดฟอร์มร้านเดิมอีกครั้งจึงเจอกลับมาโดยไม่ต้องถ่ายใหม่
     StrictMode รัน effect ตอน mount สองรอบ (dev เท่านั้น) — กันด้วย ref ไม่งั้น
     รูปที่กู้มาจะถูกเพิ่มเข้า shots ซ้ำสองชุด */
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    void listShotBackups(order.id).then((found) => {
      if (found.length === 0) return
      setShots((prev) => [...prev, ...found.map((f) => ({ img: f.img, kind: f.kind, backupId: f.backupId }))])
      toast.push('success', `กู้รูปที่ถ่ายค้างไว้กลับมาแล้ว ${found.length} รูป — เน็ตหลุดตอนอัปโหลดครั้งก่อน`)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  /* ปล่อย object URL ของรูปเมื่อปิดฟอร์มเท่านั้น (unmount) — ไม่งั้นค้างใน memory ทั้งวัน
     deps ต้องว่าง ไม่ใช่ [shots]: ของเดิมผูกกับ shots แล้ว cleanup ยิงทุกครั้งที่ shots
     เปลี่ยน (เช่นถ่ายรูปใหม่) ซึ่ง revoke URL ของรูปที่ยังอยู่ในจอ ทำให้รูปก่อนหน้ากลายเป็น
     ภาพแตกทันทีที่ถ่ายใบถัดไป — ใช้ ref เก็บ shots ล่าสุดไว้ให้ cleanup ตอน unmount อ่านแทน */
  const shotsRef = useRef(shots)
  useEffect(() => { shotsRef.current = shots }, [shots])
  useEffect(() => () => { shotsRef.current.forEach((s) => URL.revokeObjectURL(s.img.url)) }, [])

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

  /* กันอัปโหลดซ้ำตอนกด "บันทึก" ใหม่หลังบางใบอัปสำเร็จแล้วแต่ใบถัดไปพลาด —
     คีย์ด้วย backupId (คงที่ต่อรูป ไม่เปลี่ยนตาม shots array ที่ setShots ทำสำเนาใหม่)
     ไม่ใช่ state เพราะไม่ต้องให้ re-render ตาม แค่ให้ retry รอบถัดไปอ่านได้ */
  const uploadedRef = useRef<Map<string, PodPhoto>>(new Map())

  /* หน้าแรก: ชื่อผู้รับ + รูป → อัปรูปขึ้นถังทันทีที่กดบันทึก แล้วไปหน้าลายเซ็น
     งานหนักทั้งหมด (อัปโหลด) จบตั้งแต่ตอนที่มือถือยังอยู่ในมือคนขับ */
  const submitPhotos = async (): Promise<void> => {
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
        /* รอบก่อนอัปใบนี้สำเร็จไปแล้วแต่ล้มที่ใบถัดไป — ใช้ path เดิม ไม่อัปซ้ำ */
        const already = uploadedRef.current.get(shot.backupId)
        if (already) {
          uploaded.push(already)
          continue
        }
        const done: PodPhoto = {
          path: await uploadPodPhoto(order.id, shot.img.blob, { ext: shot.img.ext, type: shot.img.type }),
          kind: shot.kind,
        }
        uploadedRef.current.set(shot.backupId, done)
        uploaded.push(done)
        /* ใบนี้ขึ้นระบบแล้ว ลบสำเนาในเครื่องทิ้ง — ใบที่เหลือ (ถ้ายังไม่ถึงคิว)
           ยังอยู่ในเครื่องต่อ เผื่อเน็ตหลุดกลางลูป */
        void removeShotBackup(shot.backupId)
      }
      uploadedRef.current.clear()
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
    void clearOrderBackup(order.id)
    clearCounts(orders.map((o) => Number(o.id)))
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

  const storeName = order.customer_name ?? order.destination
  const removeShot = (backupId: string): void => {
    const shot = shots.find((s) => s.backupId === backupId)
    if (!shot) return
    URL.revokeObjectURL(shot.img.url)
    void removeShotBackup(backupId)
    setShots(shots.filter((s) => s.backupId !== backupId))
  }

  /* หัวจอ + แถบขั้น ตาม mockup 06/07 — ตรวจของเสร็จแล้วเสมอ (ทำในหน้าจุดส่ง)
     ชิปเซ็นรับ/ถ่ายรูปแตะสลับหน้าได้ ยกเว้นกลับไปหน้ารูปหลังอัปแล้ว (= อัปซ้ำ) */
  const signDone = !!sig
  const photoDone = photos !== null
  const shotsReady = shots.length > 0 && (missing.length === 0 || relaxed)
  const head = (title: string, sub: string): React.JSX.Element => (
    <>
      <header className="pod-head">
        <button type="button" className="pod-back" aria-label="กลับ" onClick={onClose} disabled={saving}>
          <svg className="pod-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="pod-head-t"><h1>{title}</h1><div>{sub}</div></div>
      </header>
      {/* แท็บสลับ เซ็นรับ / ถ่ายรูป ทำก่อนหลังได้ตามสะดวก เหมือนเวอร์ชันเก่า
          แท็บรูปล็อกเฉพาะหลังอัปรูปขึ้นแล้ว (กลับไปจะอัปซ้ำ) */}
      <div className="pod-tabs" role="tablist" aria-label="หลักฐานการส่ง">
        <button type="button" role="tab" aria-selected={step === 'sign'} className={`pod-tab${step === 'sign' ? ' is-on' : ''}`}
          disabled={saving} onClick={() => setStep('sign')}>
          {signDone && <span className="pod-tab-ok" aria-label="เสร็จแล้ว">✓</span>}เซ็นรับ
        </button>
        <button type="button" role="tab" aria-selected={step === 'photo'} className={`pod-tab${step === 'photo' ? ' is-on' : ''}`}
          disabled={saving || photoDone} onClick={() => setStep('photo')}>
          {(photoDone || shotsReady) && <span className="pod-tab-ok" aria-label="เสร็จแล้ว">✓</span>}ถ่ายรูป{!photoDone && shots.length > 0 ? ` (${shots.length})` : ''}
        </button>
      </div>
    </>
  )

  const camIcon = <svg className="pod-ic pod-ic-lg" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>

  /* ---- 06 เซ็นรับ ---- */
  if (step === 'sign') {
    return (
      <div className="pod-scope pod-page is-pod-sign" role="dialog" aria-modal="true" aria-label={`เซ็นรับสินค้า ${storeName}`}>
        {savingVeil}
        {head('เซ็นรับสินค้า', orders.length > 1 ? `${storeName} · ${orders.length} บิล` : storeName)}
        <main className="pod-main">
          <div className="pod-info">
            <svg className="pod-ic" aria-hidden="true" viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" /></svg>
            ส่งมือถือให้ผู้รับ เซ็นชื่อในกรอบ
          </div>
          {/* SignaturePad มีปุ่มล้างของตัวเอง */}
          <div className="pod-sign-box">
            <SignaturePad onChange={setSig} height="300px" compact />
            <div className="pod-sign-line" aria-hidden />
            <div className="pod-sign-cap" aria-hidden>ลายเซ็นผู้รับ</div>
          </div>
          <label className="pod-field">ชื่อผู้รับ (ไม่บังคับ)
            <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="เช่น คุณเอ" />
          </label>
          {undoButton}
        </main>
        <div className="pod-bottom">
          <button type="button" className="pod-btn pod-pri" onClick={() => void submitSignature()} disabled={!sig || saving}>
            {!photos && !shotsReady ? 'ต่อไป ถ่ายรูปหลักฐาน'
              : orders.length > 1 ? `ยืนยัน ส่งสำเร็จ (${orders.length} ใบ)` : 'ยืนยัน ส่งสำเร็จ'}
          </button>
          {!photos && !sig && (
            <button type="button" className="pod-btn pod-ghost" onClick={() => setStep('photo')} disabled={saving}>
              ผู้รับไม่อยู่ ข้ามไปถ่ายรูป
            </button>
          )}
        </div>
      </div>
    )
  }

  /* ---- 07 ถ่ายรูป ---- */
  type Shot = { img: CompressedImage; kind: string; backupId: string }
  const shotOf = (k: string): Shot | undefined => shots.find((s) => s.kind === k)
  const extras = shots.filter((s) => !POD_STEPS.some((p) => p.kind === s.kind) || shotOf(s.kind) !== s)
  const slot = (shot: Shot): React.JSX.Element => (
    <div key={shot.backupId} className="pod-slot is-done">
      <button type="button" className="pod-slot-img" onClick={() => setViewing(shot.img.url)}
        aria-label={`ดูรูป${podKindLabel(shot.kind)}เต็มจอ`}>
        <img src={shot.img.url} alt="" />
        <span className="pod-slot-name">{podKindLabel(shot.kind)}</span>
      </button>
      <button type="button" className="pod-slot-del" onClick={() => removeShot(shot.backupId)}
        aria-label={`ลบรูป${podKindLabel(shot.kind)}`} disabled={saving}>×</button>
    </div>
  )

  return (
    <div className="pod-scope pod-page is-pod-photo" role="dialog" aria-modal="true" aria-label={`ถ่ายรูปหลักฐาน ${storeName}`}>
      {savingVeil}
      {viewing && <PhotoView src={viewing} caption="ยังไม่ได้บันทึก" onClose={() => setViewing(null)} />}
      {head('ถ่ายรูปหลักฐาน', storeName)}
      <main className="pod-main">
        <div className="pod-lead">ถ่ายให้ครบ {POD_STEPS.length} มุม: {POD_STEPS.map((p) => podKindLabel(p.kind)).join(' · ')}</div>
        <div className="pod-slots" role="group" aria-label="มุมของรูปที่ต้องถ่าย">
          {POD_STEPS.map((p) => {
            const shot = shotOf(p.kind)
            return shot ? slot(shot) : (
              <button key={p.kind} type="button" className="pod-slot is-empty" aria-pressed={kind === p.kind}
                onClick={() => openCamera(p.kind)} disabled={saving} title={podStepHint(p.kind)}>
                {camIcon}{podKindLabel(p.kind)}
              </button>
            )
          })}
          {extras.map(slot)}
          <button type="button" className="pod-slot is-empty is-more" aria-pressed={kind === 'other'} onClick={() => openCamera('other')} disabled={saving}>
            {camIcon}รูปอื่นเพิ่ม
          </button>
        </div>

        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f) }} />

        {missing.length > 0 && shots.length > 0 && (
          relaxed ? (
            <p className="pod-warnbox">
              จะบันทึกโดยไม่มี{missing.map((k) => podKindLabel(k)).join(' และ ')}{' '}
              <button type="button" className="pod-linkbtn" onClick={() => setRelaxed(false)}>ยกเลิก</button>
            </p>
          ) : (
            <button type="button" className="pod-linkbtn" onClick={() => setRelaxed(true)} disabled={saving}>
              ถ่าย{missing.map((k) => podKindLabel(k)).join('/')}ไม่ได้ — บันทึกเท่าที่ถ่ายได้
            </button>
          )
        )}

        <section className="pod-card">
          <h2>สรุปก่อนบันทึก</h2>
          <div className="pod-kv"><span>บิล</span><span>{orders.length} ใบ</span></div>
          <div className="pod-kv"><span>รูปถ่าย</span>
            <span className={missing.length ? 'is-warn' : 'is-ok'}>{shots.length} รูป{missing.length ? ` · ขาด ${missing.length} มุม` : ' · ครบ'}</span></div>
          <div className="pod-kv"><span>ลายเซ็น</span>
            {sig ? <span>{recipient.trim() || 'มีแล้ว'}</span>
              : <button type="button" className="pod-linkbtn" onClick={() => setStep('sign')} disabled={saving}>ยังไม่มี · ไปเซ็นรับ</button>}</div>
          <div className="pod-kv"><span>ตำแหน่ง</span>
            <span className={coords ? 'is-ok' : 'is-muted'}>{coords ? 'บันทึกพิกัดแล้ว' : 'กำลังหาพิกัด'}</span></div>
          <label className="pod-field">หมายเหตุ (ไม่บังคับ)
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ฝากไว้กับ รปภ." />
          </label>
        </section>
        {undoButton}
      </main>
      <div className="pod-bottom">
        <button type="button" className="pod-btn pod-okbtn" onClick={() => void submitPhotos()}
          disabled={saving || shots.length === 0 || (missing.length > 0 && !relaxed)}>
          <svg className="pod-ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7" /></svg>
          {missing.length > 0 && !relaxed ? `ยังขาด ${missing.length} มุม`
            : sig ? 'บันทึกการส่ง ไปจุดถัดไป' : 'ไปเซ็นรับ'}
        </button>
      </div>
    </div>
  )
}
