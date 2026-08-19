import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from './ui'

interface Pt { x: number; y: number }

/** ความละเอียดสูงสุดที่ยอมเก็บ — จอมือถือรุ่นใหม่เป็น 3x ซึ่งทำให้ PNG ใหญ่ขึ้นเท่าตัว
 *  โดยที่ลายเซ็นไม่ได้อ่านง่ายขึ้นเลย 2x คมพอสำหรับสิ่งที่เป็นเส้นขาวดำล้วน */
const MAX_DPR = 2
const PAD_H = 200

/**
 * วาดลายเซ็นด้วยนิ้วหรือเมาส์ — คืนค่าเป็น PNG data URL
 *
 * ความแม่นของพิกัดคือทั้งหมดของหน้าจอนี้ ลายเซ็นที่หมึกไม่ตรงปลายนิ้วคือลายเซ็นที่
 * คนเซ็นไม่ยอมรับว่าเป็นของตัวเอง ซึ่งทำให้หลักฐานทั้งใบไร้ความหมาย
 *
 * ของเดิมตั้งพื้นที่วาดตายตัว 600x200 ขณะที่ CSS ยืดเต็มความกว้างของกล่อง แล้วส่ง
 * ระยะจากขอบซ้ายเป็นพิกเซลบนจอเข้าไปวาดในระบบพิกัด 600 ตรง ๆ ไม่แปลงสัดส่วน
 * กล่องที่กว้างกว่า 600 จึงวาดหมึกเยื้องไปทางขวาของนิ้ว และยิ่งลากขวายิ่งห่าง
 *
 * ตัวนี้วัดขนาดจริงของ canvas แล้วตั้งพื้นที่วาดตามนั้นคูณอัตราส่วนพิกเซลของเครื่อง
 * ระบบพิกัดหลังแปลงจึงเท่ากับพิกเซล CSS พอดี ระยะที่วัดจากขอบใช้ได้ตรง ๆ ไม่ต้องคูณอะไร
 *
 * เก็บเส้นที่ลากไว้เป็นชุดจุด ไม่ได้เก็บแค่ภาพ เพราะหมุนจอหรือคีย์บอร์ดเด้งขึ้นมา
 * ทำให้ขนาด canvas เปลี่ยน ซึ่งล้างภาพเดิมทิ้ง การมีจุดอยู่ทำให้วาดคืนได้ทั้งหมด
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const strokes = useRef<Pt[][]>([])
  const current = useRef<Pt[] | null>(null)
  const [hasInk, setHasInk] = useState(false)

  const ctxOf = (): CanvasRenderingContext2D | null => {
    const ctx = canvasRef.current?.getContext('2d') ?? null
    if (!ctx) return null
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#241f33'
    return ctx
  }

  /* เส้นโค้งผ่านจุดกึ่งกลางระหว่างจุดที่เก็บได้ ไม่ใช่ลากตรงจากจุดหนึ่งไปอีกจุด
     นิ้วให้จุดมาห่างกันพอสมควร การต่อเส้นตรงจึงได้ลายเซ็นเป็นเหลี่ยม ๆ
     ซึ่งไม่เหมือนลายมือของใครเลย */
  const trace = (ctx: CanvasRenderingContext2D, pts: Pt[]): void => {
    if (pts.length === 0) return
    const first = pts[0] as Pt
    if (pts.length === 1) {
      /* แตะจุดเดียวต้องได้จุด ไม่ใช่ไม่ได้อะไร — จุดบนตัว ิ ์ ็ คือจุดเดียวจริง ๆ */
      ctx.beginPath()
      ctx.arc(first.x, first.y, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fillStyle = ctx.strokeStyle as string
      ctx.fill()
      return
    }
    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < pts.length - 1; i += 1) {
      const p = pts[i] as Pt
      const next = pts[i + 1] as Pt
      ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2)
    }
    const last = pts[pts.length - 1] as Pt
    ctx.lineTo(last.x, last.y)
    ctx.stroke()
  }

  const redraw = useCallback((): void => {
    const canvas = canvasRef.current
    const ctx = ctxOf()
    if (!canvas || !ctx) return
    const w = canvas.width / (canvas.dataset.dpr ? Number(canvas.dataset.dpr) : 1)
    const h = canvas.height / (canvas.dataset.dpr ? Number(canvas.dataset.dpr) : 1)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    strokes.current.forEach((s) => trace(ctx, s))
  }, [])

  /* ตั้งขนาดพื้นที่วาดให้ตรงกับขนาดจริงบนจอ แล้ววาดของเดิมคืน
     เรียกทั้งตอนเปิดครั้งแรกและทุกครั้งที่กล่องเปลี่ยนขนาด */
  const fit = useCallback((): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    if (canvas.width === w && canvas.height === h) return
    canvas.width = w
    canvas.height = h
    canvas.dataset.dpr = String(dpr)
    /* setTransform ไม่ใช่ scale — scale ทบกับของเดิมทุกครั้งที่เรียกซ้ำ
       ส่วน setTransform เขียนทับ จึงเรียกกี่รอบก็ได้ผลเท่ากัน */
    canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
    redraw()
  }, [redraw])

  useEffect(() => {
    fit()
    const ro = new ResizeObserver(() => fit())
    if (canvasRef.current) ro.observe(canvasRef.current)
    return () => ro.disconnect()
  }, [fit])

  /* พิกัดในระบบเดียวกับที่ ctx ใช้ — หลัง setTransform แล้วคือพิกเซล CSS พอดี
     จึงเป็นระยะจากขอบกล่องตรง ๆ ไม่ต้องคูณสัดส่วนใด ๆ อีก */
  const pos = (canvas: HTMLCanvasElement, clientX: number, clientY: number): Pt => {
    const rect = canvas.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    e.preventDefault()
    const canvas = e.currentTarget
    /* จับ pointer ไว้กับ canvas — ลากเลยขอบออกไปแล้วยังนับเป็นเส้นเดิม
       ของเดิมจบเส้นทันทีที่นิ้วออกนอกกรอบ ซึ่งตัดหางลายเซ็นของคนที่เซ็นตัวใหญ่ */
    canvas.setPointerCapture(e.pointerId)
    current.current = [pos(canvas, e.clientX, e.clientY)]
    const ctx = ctxOf()
    if (ctx) trace(ctx, current.current)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const pts = current.current
    if (!pts) return
    e.preventDefault()
    const canvas = e.currentTarget
    /* เก็บจุดที่เบราว์เซอร์รวบไว้ระหว่างเฟรมด้วย — นิ้วที่ลากเร็วให้จุดถี่กว่าอัตรา
       รีเฟรชจอ ถ้าอ่านแต่จุดสุดท้ายจะได้เส้นที่ตัดมุมโค้งทิ้ง */
    const raw = typeof e.nativeEvent.getCoalescedEvents === 'function'
      ? e.nativeEvent.getCoalescedEvents()
      : [e.nativeEvent]
    for (const ev of raw.length > 0 ? raw : [e.nativeEvent]) {
      pts.push(pos(canvas, ev.clientX, ev.clientY))
    }
    const ctx = ctxOf()
    /* วาดซ้ำเฉพาะเส้นที่กำลังลาก ไม่ล้างทั้งผืน เส้นก่อนหน้าจึงอยู่ครบ
       และภาพระหว่างลากตรงกับภาพตอนวาดคืนเป๊ะ เพราะใช้เส้นทางเดียวกัน */
    if (ctx) trace(ctx, pts)
    setHasInk(true)
  }

  const end = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const pts = current.current
    if (!pts) return
    current.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    strokes.current.push(pts)
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  const clear = (): void => {
    strokes.current = []
    current.current = null
    redraw()
    setHasInk(false)
    onChange('')
  }

  return (
    <div>
      <div
        style={{
          border: '1.5px dashed var(--line-strong)',
          borderRadius: 10,
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        <canvas
          ref={canvasRef}
          /* touchAction อยู่ที่ canvas ไม่ใช่กล่องนอก — เบราว์เซอร์ดูค่าของตัวที่รับสัมผัสจริง
             ตั้งผิดที่แล้วการลากเซ็นจะกลายเป็นการเลื่อนหน้าจอ */
          style={{ width: '100%', height: PAD_H, display: 'block', cursor: 'crosshair', touchAction: 'none' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span className="text-xs text-muted">ใช้เมาส์วาด หรือลากนิ้วบนหน้าจอสัมผัส</span>
        <Button variant="ghost" size="sm" onClick={clear} disabled={!hasInk}>
          ล้าง
        </Button>
      </div>
    </div>
  )
}
