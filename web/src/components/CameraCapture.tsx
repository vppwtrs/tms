import { useEffect, useRef, useState } from 'react'
import { Button } from './ui'
import { compressFile, compressToJpeg, type CompressedImage } from '../utils/image'

/**
 * กล้องที่อยู่ในหน้าเว็บเอง — ไม่เรียกแอปกล้องของเครื่อง
 *
 * ทำไมไม่ใช้ <input type="file" capture> ซึ่งง่ายกว่า:
 *  • แอปกล้องของเครื่องจะเซฟรูปลง Photos ของคนขับด้วย เราสั่งห้ามไม่ได้
 *  • ช่องนั้นเปิดให้เลือกรูปเก่าจาก gallery ได้ → แนบรูปเมื่อวานมาปิดงานวันนี้ได้
 * ถ่ายผ่าน getUserMedia รูปวิ่งจาก stream เข้า canvas แล้วขึ้น server ตรง ๆ
 * ไม่แตะที่เก็บไฟล์ของเครื่องเลย และไม่มีทางหยิบรูปเก่ามาใช้
 *
 * ข้อแลกเปลี่ยน: getUserMedia ทำงานเฉพาะ secure context (https หรือ localhost)
 * ถ้าเปิดผ่าน http จะตกมาใช้ช่องเลือกไฟล์แทน พร้อมบอกสาเหตุให้ผู้ใช้รู้
 */
export function CameraCapture({
  onCapture,
  disabled,
  /* โหมดกล้องค้าง — ช่องมองภาพเปิดเองตั้งแต่เข้าหน้า และไม่ปิดหลังถ่าย
     โหมดเดิมคือ กดเปิดกล้อง → กดถ่าย → กล้องปิด ซึ่งแปลว่าถ่ายสามมุมต้องกดหกครั้ง
     ทั้งที่คนถ่ายยืนอยู่ที่เดิม ถือของอยู่ และกล้องก็ได้รับอนุญาตไปแล้ว */
  stage = false,
}: {
  onCapture: (img: CompressedImage) => void
  disabled?: boolean
  stage?: boolean
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  /* ไฟแฟลชสั้น ๆ ตอนชัตเตอร์ลั่น — กล้องที่ไม่ปิดหลังถ่าย ไม่มีอะไรบอกว่าถ่ายติดแล้ว
     ภาพในช่องมองก็ยังขยับเหมือนเดิม คนจะกดซ้ำจนได้รูปเดียวกันห้าใบ */
  const [flash, setFlash] = useState(false)

  const secure = typeof window !== 'undefined' && window.isSecureContext
  const supported = secure && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const stop = (): void => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  // ปิดกล้องเมื่อออกจากหน้า — ไฟกล้องค้างบนมือถือคือบั๊กที่ผู้ใช้รู้สึกทันที
  useEffect(() => stop, [])

  /* โหมดกล้องค้าง: ขอกล้องทันทีที่เข้าหน้า ไม่ต้องกดเปิดก่อน
     เบราว์เซอร์ถามสิทธิ์ครั้งเดียวในชีวิตของโดเมนนี้ การมีปุ่ม "เปิดกล้อง" คั่นไว้
     จึงเป็นการกดที่ทุกคนต้องกดทุกครั้งเพื่อสิ่งที่ตอบไปแล้วตั้งแต่วันแรก */
  useEffect(() => {
    if (!stage || !supported || disabled) return
    /* มีสตรีมอยู่แล้วไม่ต้องขอใหม่ — effect นี้วิ่งอีกรอบทุกครั้งที่ disabled สลับค่า
       (เช่นตอนเลิกบันทึก) การขอซ้ำจะได้สตรีมที่สองมาทับตัวแรก แล้วไฟกล้องค้าง */
    if (streamRef.current) return
    // ครั้งเดียวตอนเข้าหน้า — เปิดซ้ำเมื่อ stream หลุดเป็นเรื่องของปุ่มลองใหม่
    void start()
  }, [stage, supported, disabled])

  const start = async (): Promise<void> => {
    setProblem('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      })
      streamRef.current = stream
      setOpen(true)
      // video element เพิ่งถูก mount รอบนี้ — ผูก stream หลัง React วาดเสร็จ
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
      })
    } catch (e) {
      const name = (e as { name?: string }).name
      setProblem(
        name === 'NotAllowedError'
          ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องให้เว็บนี้ในตั้งค่าเบราว์เซอร์'
          : name === 'NotFoundError'
            ? 'ไม่พบกล้องบนอุปกรณ์นี้'
            : 'เปิดกล้องไม่สำเร็จ',
      )
    }
  }

  const shoot = async (): Promise<void> => {
    const video = videoRef.current
    if (!video) return
    setBusy(true)
    try {
      const img = await compressToJpeg(video, video.videoWidth, video.videoHeight)
      /* โหมดกล้องค้าง: สตรีมอยู่ต่อ ถ่ายมุมถัดไปได้ทันทีโดยไม่ต้องขออนุญาตใหม่
         โหมดเดิม: ปิดกล้องแล้วกลับไปเป็นปุ่ม เพราะจอนั้นรับรูปเดียว */
      if (stage) {
        setFlash(true)
        window.setTimeout(() => setFlash(false), 160)
      } else {
        stop()
        setOpen(false)
      }
      onCapture(img)
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    try {
      onCapture(await compressFile(file))
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /* ---- โหมดกล้องค้าง ---- */
  if (stage) {
    return (
      <div className="cam-stage">
        <div className="cam-stage-view">
          {open ? (
            <>
              <video ref={videoRef} playsInline muted className="cam-stage-video" />
              {flash && <span className="cam-stage-flash" aria-hidden="true" />}
            </>
          ) : (
            /* กล้องยังไม่ติด — ช่องมองภาพกลายเป็นที่บอกเหตุและปุ่มลองใหม่
               ไม่ปล่อยเป็นกรอบดำเปล่าที่คนต้องเดาเองว่าแอปพังหรือกล้องพัง */
            <div className="cam-stage-off">
              <p>{problem || (supported ? 'กำลังเปิดกล้อง…' : 'อุปกรณ์นี้เปิดกล้องในหน้าเว็บไม่ได้')}</p>
              {supported && (
                <Button variant="outline" onClick={() => void start()}>
                  เปิดกล้องอีกครั้ง
                </Button>
              )}
              {!supported && (
                <label className="btn btn-outline">
                  เลือกรูปจากอุปกรณ์
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    disabled={disabled}
                    onChange={(e) => void pickFile(e.target.files?.[0])}
                  />
                </label>
              )}
            </div>
          )}
        </div>

        {/* ชัตเตอร์กลม กลางจอ ขนาดนิ้วโป้ง — ปุ่มเดียวที่ต้องเจอโดยไม่ต้องมอง */}
        <button
          type="button"
          className="cam-shutter"
          aria-label="ถ่ายรูป"
          disabled={!open || busy || disabled}
          onClick={() => void shoot()}
        >
          <span />
        </button>
      </div>
    )
  }

  if (open) {
    return (
      <div className="cam-live">
        <video ref={videoRef} playsInline muted className="cam-video" />
        <div className="cam-controls">
          <Button
            variant="ghost"
            onClick={() => {
              stop()
              setOpen(false)
            }}
          >
            ยกเลิก
          </Button>
          <Button size="lg" loading={busy} onClick={() => void shoot()}>
            ถ่ายรูป
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="cam-start">
      {supported ? (
        <Button variant="outline" disabled={disabled} loading={busy} onClick={() => void start()}>
          เปิดกล้องถ่ายรูป
        </Button>
      ) : (
        <>
          <label className="btn btn-outline">
            เลือกรูปจากอุปกรณ์
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              disabled={disabled}
              onChange={(e) => void pickFile(e.target.files?.[0])}
            />
          </label>
          <p className="text-xs text-muted">
            {secure
              ? 'อุปกรณ์นี้ไม่รองรับกล้องในหน้าเว็บ'
              : 'ต้องเปิดหน้าเว็บผ่าน https จึงจะถ่ายรูปในแอปได้ — ตอนนี้ใช้วิธีเลือกไฟล์แทน'}
          </p>
        </>
      )}
      {problem && <p className="text-xs text-danger">{problem}</p>}
    </div>
  )
}
