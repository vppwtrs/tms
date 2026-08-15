import { useEffect, useRef, useState } from 'react'
import { Button } from './ui'

/** วาดลายเซ็นด้วยเมาส์/นิ้ว (Pointer Events) — คืนค่าเป็น PNG data URL */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // เตรียมพื้นขาว + ขนาด 2x (retina-ready) แต่แสดงเท่าขนาด CSS
    const dpr = 2
    canvas.width = 600 * dpr
    canvas.height = 200 * dpr
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 600, 200)
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#241f33'
  }, [])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    e.preventDefault()
    drawing.current = true
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasInk(true)
  }

  const end = (): void => {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  const clear = (): void => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 600, 200)
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
          touchAction: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 200, display: 'block', cursor: 'crosshair' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
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
