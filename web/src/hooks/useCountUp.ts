import { useEffect, useState } from 'react'

/** นับเลข KPI ขึ้นแบบลื่นไหล (requestAnimationFrame — ประหยัด CPU) */
export function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (target === 0) {
      setValue(0)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number): void => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}
