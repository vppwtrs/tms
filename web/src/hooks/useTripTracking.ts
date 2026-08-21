import { useEffect, useRef, useState } from 'react'
import { logTripLocation } from '../api/tracking'
import { isNativeApp, watchPosition, type WatchStop } from '../api/bgGeo'

/** ถี่แค่ไหนถึงพอ — 30 วินาทีให้เส้นทางที่อ่านออกโดยไม่กินแบตจนคนขับปิดแอปทิ้ง */
const PING_MS = 30_000

export type TrackingState = 'off' | 'asking' | 'on' | 'denied' | 'unsupported'

/**
 * ส่งตำแหน่งของเที่ยวที่กำลังวิ่ง
 *
 * บนเว็บ ทำงานเฉพาะตอนหน้าจอเปิดอยู่ — เบราว์เซอร์หยุดให้ตำแหน่งเมื่อแอปไม่ได้อยู่
 * หน้าจอ นี่ไม่ใช่บั๊กที่แก้ได้ด้วยโค้ด และการทำเป็นว่ามันทำงานตลอดคือการโกหก
 * คนอ่านแผนที่ จึงคืนสถานะออกไปให้หน้าจอบอกคนขับตรง ๆ
 *
 * ในแอป native ข้อจำกัดนั้นหายไป — ปลั๊กอินเก็บพิกัดต่อขณะจอดับ ซึ่งเป็นเหตุผล
 * เดียวที่แอปมีอยู่ ตัวหน้าจอจึงต้องรู้ด้วยว่ากำลังอยู่แบบไหน (ดู backgroundCapable)
 */
export interface Tracking {
  state: TrackingState
  /** true = พิกัดเดินต่อแม้จอดับ หน้าจอจะได้ไม่บอกให้เปิดหน้าค้างไว้โดยไม่จำเป็น */
  backgroundCapable: boolean
}

export function useTripTracking(tripId: number | null, enabled: boolean): Tracking {
  const [state, setState] = useState<TrackingState>('off')
  const lastSent = useRef(0)
  const backgroundCapable = isNativeApp()

  useEffect(() => {
    if (!enabled || tripId == null) {
      setState('off')
      return
    }
    if (!backgroundCapable && !('geolocation' in navigator)) {
      setState('unsupported')
      return
    }

    let stopped = false
    /* ตัวหยุดมาทีหลังเพราะฝั่ง native ต้องรอผลขอสิทธิ์ก่อน ถ้า effect ถูกเก็บ
       ระหว่างรอ ต้องหยุด watcher ทันทีที่มันเกิด ไม่งั้นเครื่องตามตำแหน่งค้างไว้ */
    let stop: WatchStop | null = null
    setState('asking')

    void watchPosition({
      onFix: ({ lat, lng, accuracy }) => {
        if (stopped) return
        setState('on')
        /* watcher ยิงถี่กว่าที่ต้องเก็บมาก กรองด้วยเวลาเองแทนการเก็บทุกจุด
           เก็บทุกจุดคือใส่ข้อมูลเข้าฐานเป็นหมื่นแถวต่อวันโดยไม่ได้ความละเอียดเพิ่ม */
        const now = Date.now()
        if (now - lastSent.current < PING_MS) return
        lastSent.current = now
        void logTripLocation(tripId, lat, lng, accuracy).catch(() => {
          /* เน็ตหลุดกลางทางเป็นเรื่องปกติของงานขนส่ง จุดถัดไปจะส่งเอง
             ไม่ต้องเด้ง error ใส่หน้าคนขับที่กำลังขับรถอยู่ */
        })
      },
      onError: (denied) => {
        if (stopped) return
        setState(denied ? 'denied' : 'off')
      },
    }).then((fn) => {
      if (stopped) { fn(); return }
      stop = fn
    })

    return () => {
      stopped = true
      stop?.()
    }
  }, [tripId, enabled, backgroundCapable])

  return { state, backgroundCapable }
}
