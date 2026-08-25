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
  stamp,
}: {
  onCapture: (img: CompressedImage) => void
  disabled?: boolean
  stage?: boolean
  /* บรรทัดที่จะประทับมุมขวาล่างของรูป (ร้าน วันเวลา พิกัด) — ประทับตอนบีบ
     รูปที่หลุดออกจากฐานไปแล้วจึงยังบอกได้เองว่าเป็นของงานไหน
     ส่งเป็นฟังก์ชันได้ และควรส่งแบบนั้นเมื่อมีเวลาอยู่ในนั้น — ค่าที่คำนวณตอน render
     คือเวลาที่เปิดหน้า ไม่ใช่เวลาที่กดชัตเตอร์ ซึ่งห่างกันได้ทั้งชั่วโมง */
  stamp?: string[] | (() => string[])
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  /** กำลังรอคำตอบจากกล่องขอสิทธิ์อยู่ — กันคำขอซ้อน */
  const askingRef = useRef(false)
  /* สตรีมเป็น state ไม่ใช่แค่ ref — การผูกสตรีมเข้ากับ <video> ต้องเกิด *หลัง*
     React วาด element นั้นลงจอแล้ว ของเดิมผูกใน requestAnimationFrame ทันทีหลัง
     getUserMedia ตอบกลับ ซึ่งเป็นการเดาว่า React commit เสร็จก่อนเฟรมถัดไป
     ครั้งแรกของเครื่องมันไม่เสร็จ (กล่องขอสิทธิ์ของเบราว์เซอร์บังหน้าอยู่ rAF ถูก
     พักไว้ทั้งช่วง) rAF จึงยิงตอน videoRef ยังว่าง แล้วไม่มีใครลองผูกอีกเลย
     ได้กรอบดำค้างจนกว่าจะปิดฟอร์มแล้วเปิดใหม่ — ซึ่งคือรอบที่ element มีอยู่ก่อนแล้ว
     เป็น state แล้ว effect ที่ผูกจึงวิ่งหลัง commit เสมอ ไม่ต้องเดาจังหวะ */
  const [stream, setStream] = useState<MediaStream | null>(null)
  const open = stream !== null
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  /* ภาพสดไม่เดิน ทั้งที่ได้สตรีมมาแล้ว
     บน iPhone ที่เปิดโหมดประหยัดพลังงาน iOS หยุดการเล่นวิดีโออัตโนมัติทั้งหมด
     รวมถึงภาพสดจากกล้องที่ปิดเสียงและเล่นในหน้า สิทธิ์กล้องผ่านแล้ว สตรีมมาแล้ว
     แต่เฟรมแรกไม่เคยขึ้น คนใช้เห็นกรอบดำและไม่มีอะไรบอกว่าทำไม
     ทางออกเดียวที่ iOS ยอมคือให้คนแตะเอง — play() ที่มาจากนิ้วคนไม่ถูกบล็อก */
  const [stalled, setStalled] = useState(false)
  /* ไฟแฟลชสั้น ๆ ตอนชัตเตอร์ลั่น — กล้องที่ไม่ปิดหลังถ่าย ไม่มีอะไรบอกว่าถ่ายติดแล้ว
     ภาพในช่องมองก็ยังขยับเหมือนเดิม คนจะกดซ้ำจนได้รูปเดียวกันห้าใบ */
  const [flash, setFlash] = useState(false)

  const secure = typeof window !== 'undefined' && window.isSecureContext
  const supported = secure && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  /* เก็บคำที่เบราว์เซอร์บอกไว้ดิบ ๆ ไม่แปลไทย — ชื่อ error คือสิ่งเดียวที่ชี้ได้ว่า
     ติดที่สิทธิ์ ที่ฮาร์ดแวร์ หรือที่ตัวเบราว์เซอร์ไม่มีของให้ตั้งแต่ต้น */
  const lastErr = useRef('')

  const stop = (): void => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
  }

  /* ปิดกล้องเมื่อออกจากหน้า — ไฟกล้องค้างบนมือถือคือบั๊กที่ผู้ใช้รู้สึกทันที
     ตอน unmount ห้ามแตะ state จึงปิดจาก ref ตรง ๆ ไม่เรียก stop() */
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  /* ผูกสตรีมเข้า <video> — วิ่งหลัง React วาด element เสร็จแล้วเสมอ
     play() ถูกเรียกซ้ำตอน loadedmetadata ด้วย เพราะบนมือถือครั้งแรกมัก reject
     ด้วย AbortError ตอนแท็บยังไม่ได้อยู่หน้าสุด แล้วภาพจะค้างเป็นเฟรมดำ */
  useEffect(() => {
    const video = videoRef.current
    if (!stream || !video) return
    if (video.srcObject !== stream) video.srcObject = stream
    const play = (): void => { void video.play().catch(() => undefined) }
    play()
    video.addEventListener('loadedmetadata', play)
    const playing = (): void => setStalled(false)
    video.addEventListener('playing', playing)
    /* ให้เวลาเครื่องช้าได้ตั้งตัวก่อนค่อยสรุปว่าไม่เดิน — เฟรมแรกของกล้องหลัง
       บนเครื่องรุ่นเก่าใช้เวลาเกินหนึ่งวินาทีเป็นเรื่องปกติ */
    const timer = window.setTimeout(() => {
      setStalled(video.paused || video.videoWidth === 0)
    }, 2500)
    return () => {
      window.clearTimeout(timer)
      video.removeEventListener('loadedmetadata', play)
      video.removeEventListener('playing', playing)
    }
  }, [stream])

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
    /* ขอซ้อนกันไม่ได้ — กดปุ่มลองใหม่ระหว่างที่กล่องขอสิทธิ์ยังค้างอยู่ จะได้คำขอ
       ที่สอง ซึ่งบางเบราว์เซอร์ปฏิเสธทันทีแล้วขึ้นว่า "ไม่ได้รับอนุญาต" ทั้งที่ยัง
       ไม่มีใครตอบอะไรสักคำ */
    if (askingRef.current || streamRef.current) return
    askingRef.current = true
    try {
      const got = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      })
      streamRef.current = got
      setStream(got)
    } catch (e) {
      const name = (e as { name?: string }).name
      lastErr.current = `${name ?? 'Error'}: ${(e as { message?: string }).message ?? ''}`
      setProblem(
        name === 'NotAllowedError'
          ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องให้เว็บนี้ในตั้งค่าเบราว์เซอร์'
          : name === 'NotFoundError'
            ? 'ไม่พบกล้องบนอุปกรณ์นี้'
            : 'เปิดกล้องไม่สำเร็จ',
      )
    } finally {
      askingRef.current = false
    }
  }

  /** ข้อความประทับ ณ วินาทีที่กดชัตเตอร์ ไม่ใช่ตอนเปิดหน้า */
  const stampNow = (): string[] | undefined => (typeof stamp === 'function' ? stamp() : stamp)

  const shoot = async (): Promise<void> => {
    const video = videoRef.current
    if (!video) return
    setBusy(true)
    try {
      const img = await compressToJpeg(video, video.videoWidth, video.videoHeight, stampNow())
      /* โหมดกล้องค้าง: สตรีมอยู่ต่อ ถ่ายมุมถัดไปได้ทันทีโดยไม่ต้องขออนุญาตใหม่
         โหมดเดิม: ปิดกล้องแล้วกลับไปเป็นปุ่ม เพราะจอนั้นรับรูปเดียว */
      if (stage) {
        setFlash(true)
        window.setTimeout(() => setFlash(false), 160)
      } else {
        stop()
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
      onCapture(await compressFile(file, stampNow()))
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
              <video ref={videoRef} playsInline muted autoPlay className="cam-stage-video" />
              {/* กรอบเล็งสี่มุม — บอกว่ากรอบไหนคือรูปที่จะได้จริง ไม่ได้กันอะไร
                  ตกแต่งล้วน จึงซ่อนจากตัวอ่านหน้าจอทั้งก้อน */}
              <span className="cam-aim" aria-hidden="true">
                <i className="cam-aim-tl" /><i className="cam-aim-tr" />
                <i className="cam-aim-bl" /><i className="cam-aim-br" />
              </span>
              {flash && <span className="cam-stage-flash" aria-hidden="true" />}
              {stalled && (
                <button
                  type="button"
                  className="cam-stage-wake"
                  onClick={() => {
                    const video = videoRef.current
                    if (!video) return
                    void video.play().then(() => setStalled(false)).catch(() => undefined)
                  }}
                >
                  <b>แตะเพื่อเริ่มภาพ</b>
                  <span>กล้องพร้อมแล้วแต่ภาพยังไม่เดิน — โหมดประหยัดพลังงานของ iPhone
                    หยุดภาพสดไว้ ปิดโหมดนั้นแล้วจะไม่ต้องแตะอีก</span>
                </button>
              )}
            </>
          ) : (
            /* กล้องยังไม่ติด — ช่องมองภาพกลายเป็นที่บอกเหตุและปุ่มลองใหม่
               ไม่ปล่อยเป็นกรอบดำเปล่าที่คนต้องเดาเองว่าแอปพังหรือกล้องพัง */
            <div className="cam-stage-off">
              <p>{problem || (supported ? 'กำลังเปิดกล้อง…' : 'อุปกรณ์นี้เปิดกล้องในหน้าเว็บไม่ได้')}</p>
              {/* เครื่องคนขับอยู่คนละที่กับคนแก้บั๊ก และ "กล้องไม่ขึ้น" อธิบายอะไรไม่ได้เลย
                  บรรทัดนี้คือสิ่งที่คนขับถ่ายจอส่งมาแล้วตอบได้ทันทีว่าติดด่านไหน */}
              <details className="cam-why">
                <summary>ทำไมกล้องไม่ขึ้น</summary>
                <code>{cameraFacts(lastErr.current)}</code>
              </details>
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
        <video ref={videoRef} playsInline muted autoPlay className="cam-video" />
        <div className="cam-controls">
          <Button
            variant="ghost"
            onClick={stop}
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

/**
 * ข้อเท็จจริงของเครื่องที่กล้องไม่ขึ้น — เขียนให้อ่านจากรูปถ่ายจอได้ในบรรทัดเดียว
 *
 * สามค่าแรกคือสามด่านที่กล้องบนเว็บตายได้: ต้องเป็น https, ต้องมี mediaDevices,
 * และบน iOS ที่เปิดจากไอคอนหน้าจอ (standalone) รุ่นก่อน 14.3 ไม่มี getUserMedia ให้เลย
 * ต่อให้กดอนุญาตยังไงก็ไม่มีอะไรขึ้น เพราะไม่มีของให้เรียกตั้งแต่ต้น
 */
function cameraFacts(err = ''): string {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (nav as { standalone?: boolean } | undefined)?.standalone === true)
  const ios = /OS (\d+)[._](\d+)/.exec(nav?.userAgent ?? '')
  return [
    `secure=${typeof window !== 'undefined' && window.isSecureContext}`,
    `mediaDevices=${!!nav?.mediaDevices}`,
    `getUserMedia=${!!nav?.mediaDevices?.getUserMedia}`,
    `standalone=${standalone}`,
    `ios=${ios ? `${ios[1]}.${ios[2]}` : 'ไม่ใช่ iOS'}`,
    err ? `error=${err}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
