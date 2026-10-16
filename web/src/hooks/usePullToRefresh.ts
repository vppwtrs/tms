import { useEffect, useRef, useState } from 'react'

/** ต้องลากลงกี่พิกเซลถึงจะนับว่าตั้งใจรีเฟรช — สั้นกว่านี้แล้วสะบัดนิ้วเลื่อนจอธรรมดา
 *  จะสั่งโหลดใหม่โดยไม่ได้ตั้งใจ ยาวกว่านี้แล้วต้องลากจนเมื่อยมือ */
const TRIGGER = 70
/** ลากได้ไกลสุดเท่าไหร่ — เกินจากนี้แถบไม่ขยับตาม บอกเป็นนัยว่าลากพอแล้ว */
const MAX = 110
/** ลากลงเกินกว่านี้ในแนวตั้งเทียบกับแนวนอน ถึงจะนับว่าเป็นการลากลง ไม่ใช่ปัดข้าง */
const SLOPE = 1.2

export interface PullState {
  /* ระยะที่นิ้วลากลงมาแล้ว หน่วยพิกเซล ใช้ขยับแถบให้ไหลตามนิ้ว */
  distance: number
  /* ปล่อยตอนนี้แล้วจะโหลดใหม่ */
  ready: boolean
  refreshing: boolean
}

/**
 * ลากลงจากบนสุดเพื่อโหลดใหม่
 *
 * หน้าคนขับไม่มีปุ่มรีเฟรช และไม่ควรมี — ปุ่มกินที่บนแถบหัวซึ่งแคบอยู่แล้ว
 * แล้วยังต้องเล็งกดอีก ทั้งที่ท่าที่ทุกคนทำโดยไม่ต้องสอนคือลากลงจากบนสุด
 *
 * เงื่อนไขที่ต้องครบก่อนถึงนับว่าเป็นการลากเพื่อรีเฟรช:
 *  • หน้าอยู่บนสุดจริงตั้งแต่ตอนนิ้วแตะ ไม่ใช่เลื่อนขึ้นมาถึงบนสุดกลางทาง
 *  • ทิศทางเป็นแนวตั้งชัดเจน ไม่ใช่การปัดข้าง
 *  • ไม่ได้เริ่มลากจากในกล่องที่เลื่อนของตัวเองได้ (แผ่นซ้อน รายการในโมดัล)
 *
 * ขาดข้อไหนก็ปล่อยให้เบราว์เซอร์จัดการตามปกติ การแย่งจังหวะเลื่อนจอไปจากคนขับ
 * ทำให้หน้าจอรู้สึกพัง ซึ่งแย่กว่าการไม่มีท่ารีเฟรชเสียอีก
 */
export function usePullToRefresh(onRefresh: () => Promise<void> | void, enabled = true): PullState {
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(0)
  const startX = useRef(0)
  const active = useRef(false)
  /* เก็บฟังก์ชันล่าสุดไว้ใน ref — ตัวมันถูกสร้างใหม่ทุกครั้งที่หน้า render
     ถ้าใส่ใน dependency ตัวดักสัมผัสจะถูกถอดแล้วติดใหม่กลางที่นิ้วยังลากอยู่ */
  const cb = useRef(onRefresh)
  cb.current = onRefresh

  useEffect(() => {
    if (!enabled) return

    const atTop = (): boolean => (window.scrollY || document.documentElement.scrollTop || 0) <= 0

    /* ลากจากในกล่องที่เลื่อนเองได้ ต้องปล่อยให้กล่องนั้นเลื่อนตามปกติ */
    const inScrollable = (target: EventTarget | null): boolean => {
      let el = target instanceof Element ? target : null
      while (el && el !== document.body) {
        const s = getComputedStyle(el)
        if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) return true
        el = el.parentElement
      }
      return false
    }

    const onStart = (e: TouchEvent): void => {
      if (refreshing || e.touches.length !== 1 || !atTop() || inScrollable(e.target)) return
      const t = e.touches[0] as Touch
      startY.current = t.clientY
      startX.current = t.clientX
      active.current = true
    }

    const onMove = (e: TouchEvent): void => {
      if (!active.current) return
      const t = e.touches[0] as Touch
      const dy = t.clientY - startY.current
      const dx = Math.abs(t.clientX - startX.current)
      if (dy <= 0 || dy < dx * SLOPE) {
        active.current = false
        setDistance(0)
        return
      }
      /* หน่วงให้ฝืดขึ้นเรื่อย ๆ — ลากไปเรื่อย ๆ แล้วแถบไม่ไหลตามแบบไม่มีที่สิ้นสุด
         คือสิ่งที่บอกนิ้วว่าสุดแล้ว โดยไม่ต้องมีข้อความอะไรบนจอ */
      const eased = Math.min(MAX, dy * 0.5)
      setDistance(eased)
      if (e.cancelable) e.preventDefault()
    }

    const onEnd = (): void => {
      if (!active.current) return
      active.current = false
      setDistance((d) => {
        if (d >= TRIGGER * 0.5) {
          setRefreshing(true)
          void Promise.resolve(cb.current()).finally(() => {
            setRefreshing(false)
            setDistance(0)
          })
          /* ค้างแถบไว้ระหว่างโหลด ไม่เด้งกลับทันที — เด้งกลับแล้วไม่มีอะไรบอกว่า
             กำลังโหลดอยู่ คนขับจะลากซ้ำอีกรอบเพราะคิดว่าไม่ติด */
          return TRIGGER * 0.5
        }
        return 0
      })
    }

    /* passive: false เฉพาะ touchmove เพราะต้องห้ามจอเด้งตามนิ้ว ตัวอื่นไม่ต้อง */
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled, refreshing])

  return { distance, ready: distance >= TRIGGER * 0.5, refreshing }
}
