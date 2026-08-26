import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * ทำให้การ์ดที่ย้ายช่องบนกระดาน "เลื่อน" ไปตำแหน่งใหม่ แทนที่จะหายแล้วโผล่
 *
 * เดิมกระดานโหลดใหม่ทั้งกระดานทุกครั้งที่ใครสักคนกดอะไร การ์ดที่เปลี่ยนช่องจึงถูก
 * ถอดออกจาก DOM ตรงหนึ่งแล้วสร้างใหม่อีกตรงหนึ่ง คนที่กำลังมองอยู่ไม่มีทางรู้ว่า
 * ใบไหนเพิ่งขยับ — ต้องกวาดตาหาใหม่ทั้งกระดาน ซึ่งเป็นงานที่คอมพิวเตอร์ควรทำให้
 *
 * วิธี FLIP: จำตำแหน่งเดิมไว้ พอ DOM วางของเสร็จก็ดันการ์ดกลับไปที่เดิมด้วย transform
 * แล้วปล่อยให้มันวิ่งกลับมาที่ตำแหน่งจริง ตาจึงเห็นเส้นทางการเคลื่อนที่ ไม่ใช่แค่ผลลัพธ์
 *
 * ใช้ transform อย่างเดียว ไม่แตะ layout จึงไม่ทำให้หน้าอื่นขยับตาม
 * ปิดตัวเองเมื่อผู้ใช้ตั้งค่าลดการเคลื่อนไหว
 */
export function useFlipBoard(
  ref: RefObject<HTMLElement | null>,
  deps: unknown,
  ms = 240,
): void {
  const prev = useRef<Map<string, DOMRect>>(new Map())

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return

    const nodes = [...root.querySelectorAll<HTMLElement>('[data-flip-id]')]
    const next = new Map<string, DOMRect>()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    for (const el of nodes) {
      const id = el.dataset.flipId
      if (!id) continue
      const rect = el.getBoundingClientRect()
      next.set(id, rect)

      if (reduce) continue
      const was = prev.current.get(id)
      if (!was) continue

      const dx = was.left - rect.left
      const dy = was.top - rect.top
      /* ขยับไม่ถึงหนึ่งพิกเซลคือการจัดหน้าใหม่ ไม่ใช่การย้ายช่อง ปล่อยไว้เฉย ๆ
         ไม่งั้นทั้งกระดานจะกระตุกทุกครั้งที่มีการ์ดใบใหม่แทรกเข้ามา */
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue

      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: ms, easing: 'cubic-bezier(.2,.7,.3,1)' },
      )
    }

    prev.current = next
  }, [ref, deps, ms])
}
