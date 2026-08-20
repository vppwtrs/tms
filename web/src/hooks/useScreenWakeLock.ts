import { useEffect, useState } from 'react'

/**
 * กันจอดับเองระหว่างที่เที่ยวกำลังวิ่ง
 *
 * เบราว์เซอร์หยุดให้ตำแหน่งทันทีที่หน้าจอดับหรือสลับไปแอปอื่น ช่องว่างที่เห็น
 * บนแผนที่ส่วนใหญ่จึงไม่ได้เกิดจากคนขับตั้งใจปิดแอป แต่เกิดจากจอดับเองตามเวลา
 * เพราะเขาไม่ได้แตะมันระหว่างขับรถ ซึ่งเป็นสิ่งที่ควรเกิดขึ้นอยู่แล้ว
 *
 * ตัวนี้ไม่ได้ทำให้ GPS ทำงานเบื้องหลัง — ไม่มีทางไหนบนเว็บทำได้ Service Worker
 * เข้าถึงตำแหน่งไม่ได้ตั้งแต่ในสเปก มันแค่ยืดเวลาที่แอปอยู่หน้าจอให้นานขึ้น
 * ถ้าคนขับกดปุ่มปิดจอเอง หรือสลับไปแอปอื่น ก็หลุดเหมือนเดิม
 *
 * สิทธิ์นี้หลุดเองทุกครั้งที่แท็บถูกซ่อน จึงต้องขอใหม่ตอนกลับมา ไม่ใช่ขอครั้งเดียว
 * แล้วเชื่อว่ายังถืออยู่
 */
export function useScreenWakeLock(active: boolean): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) {
      setHeld(false)
      return
    }

    let stopped = false
    let lock: WakeLockSentinel | null = null

    const acquire = async (): Promise<void> => {
      /* ขอตอนแท็บถูกซ่อนอยู่จะโดนปฏิเสธเสมอ รอให้กลับมาก่อน */
      if (stopped || document.visibilityState !== 'visible' || lock !== null) return
      try {
        lock = await navigator.wakeLock.request('screen')
        if (stopped) { void lock.release(); lock = null; return }
        setHeld(true)
        /* ระบบปฏิบัติการปล่อยเองได้ เช่นแบตใกล้หมด — ต้องรู้ว่าไม่ได้ถืออยู่แล้ว */
        lock.addEventListener('release', () => {
          lock = null
          if (!stopped) setHeld(false)
        })
      } catch {
        /* โดนปฏิเสธ (แบตประหยัดพลังงาน สิทธิ์ หรือเบราว์เซอร์เก่า) ไม่ใช่เรื่องต้องเตือน
           คนขับ เขาทำอะไรกับมันไม่ได้ หน้าจอจะบอกแค่ว่าให้เปิดหน้านี้ค้างไว้ตามเดิม */
        if (!stopped) setHeld(false)
      }
    }

    const onVisible = (): void => { void acquire() }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
      lock = null
    }
  }, [active])

  return held
}
