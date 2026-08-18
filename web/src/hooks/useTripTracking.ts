import { useEffect, useRef, useState } from 'react'
import { logTripLocation } from '../api/tracking'

/** ถี่แค่ไหนถึงพอ — 30 วินาทีให้เส้นทางที่อ่านออกโดยไม่กินแบตจนคนขับปิดแอปทิ้ง */
const PING_MS = 30_000

export type TrackingState = 'off' | 'asking' | 'on' | 'denied' | 'unsupported'

/**
 * ส่งตำแหน่งของเที่ยวที่กำลังวิ่ง
 *
 * ทำงานเฉพาะตอนหน้าจอเปิดอยู่ — เบราว์เซอร์หยุดให้ตำแหน่งเมื่อแอปไม่ได้อยู่หน้าจอ
 * นี่ไม่ใช่บั๊กที่แก้ได้ด้วยโค้ด และการทำเป็นว่ามันทำงานตลอดคือการโกหกคนอ่านแผนที่
 * จึงคืนสถานะออกไปให้หน้าจอบอกคนขับตรง ๆ ว่าตอนนี้บันทึกอยู่หรือหยุดไปแล้ว
 */
export function useTripTracking(tripId: number | null, enabled: boolean): TrackingState {
  const [state, setState] = useState<TrackingState>('off')
  const lastSent = useRef(0)

  useEffect(() => {
    if (!enabled || tripId == null) {
      setState('off')
      return
    }
    if (!('geolocation' in navigator)) {
      setState('unsupported')
      return
    }

    let stopped = false
    setState('asking')

    const send = (pos: GeolocationPosition): void => {
      if (stopped) return
      setState('on')
      /* watchPosition ยิงถี่กว่าที่ต้องเก็บมาก กรองด้วยเวลาเองแทนการเก็บทุกจุด
         เก็บทุกจุดคือใส่ข้อมูลเข้าฐานเป็นหมื่นแถวต่อวันโดยไม่ได้ความละเอียดเพิ่ม */
      const now = Date.now()
      if (now - lastSent.current < PING_MS) return
      lastSent.current = now
      void logTripLocation(tripId, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy)
        .catch(() => {
          /* เน็ตหลุดกลางทางเป็นเรื่องปกติของงานขนส่ง จุดถัดไปจะส่งเอง
             ไม่ต้องเด้ง error ใส่หน้าคนขับที่กำลังขับรถอยู่ */
        })
    }

    const watch = navigator.geolocation.watchPosition(
      send,
      (err) => {
        if (stopped) return
        setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'off')
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    )

    return () => {
      stopped = true
      navigator.geolocation.clearWatch(watch)
    }
  }, [tripId, enabled])

  return state
}
