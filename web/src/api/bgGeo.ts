import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin, Location } from '@capacitor-community/background-geolocation'

/**
 * ตำแหน่งที่ยังเดินต่อเมื่อจอดับ — เหตุผลเดียวที่แอป native มีอยู่
 *
 * เบราว์เซอร์บน iOS หยุดให้พิกัดทันทีที่คนขับล็อกจอ ซึ่งเขาล็อกเกือบตลอดเวลาที่ขับ
 * เส้นทางที่ฝ่ายวางแผนเห็นจึงขาดเป็นช่วง ๆ ปลั๊กอินนี้ขอสิทธิ์ระดับระบบและส่งพิกัด
 * ต่อได้ในพื้นหลัง เว็บทำแบบนั้นไม่ได้ ไม่ว่าเขียนโค้ดดีแค่ไหน
 *
 * ตัวไฟล์นี้ทำหน้าที่เดียว: ให้ที่เรียกใช้ไม่ต้องรู้ว่าตอนนี้อยู่บนแอปหรือบนเว็บ
 * บนเว็บมันถอยไปใช้ navigator.geolocation ตัวเดิม พฤติกรรมเท่าเดิมทุกอย่าง
 */

const NativeBackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

export interface Fix {
  lat: number
  lng: number
  accuracy: number | null
}

export type WatchStop = () => void

export interface WatchHandlers {
  onFix: (fix: Fix) => void
  /** denied = คนใช้ปฏิเสธสิทธิ์ ต่างจาก error ชั่วคราวอย่างหาสัญญาณไม่เจอ */
  onError: (denied: boolean) => void
}

/** true เมื่อรันอยู่ในแอปที่ห่อด้วย Capacitor ไม่ใช่แท็บเบราว์เซอร์ */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform()

/**
 * ข้อความที่คนขับเห็นบนแถบแจ้งเตือนขณะบันทึกอยู่
 *
 * Android บังคับให้มีการแจ้งเตือนค้างไว้ ถึงจะเก็บพิกัดในพื้นหลังได้ ส่วน iOS
 * ไม่บังคับ แต่การมีอยู่ของ backgroundMessage คือสิ่งที่บอกปลั๊กอินว่า
 * "เอาพื้นหลังด้วย" ทั้งสองระบบ
 *
 * เขียนให้ตรงว่ากำลังบันทึกอะไรและหยุดเมื่อไหร่ — คนขับต้องรู้ตัวเสมอว่าถูกตามอยู่
 */
const BACKGROUND_TITLE = 'กำลังบันทึกเส้นทางของเที่ยวนี้'
const BACKGROUND_MESSAGE = 'บันทึกจนกว่าจะปิดเที่ยว ปิดเที่ยวแล้วหยุดเอง'

/** เดินได้ไม่ถึงระยะนี้ถือว่ายังอยู่ที่เดิม — กันจุดกองพรืดตอนรถติดหรือจอดส่งของ */
const DISTANCE_FILTER_M = 25

async function watchNative(handlers: WatchHandlers): Promise<WatchStop> {
  const id = await NativeBackgroundGeolocation.addWatcher(
    {
      backgroundTitle: BACKGROUND_TITLE,
      backgroundMessage: BACKGROUND_MESSAGE,
      requestPermissions: true,
      /* ห้ามรับจุดเก่าที่ค้างในเครื่อง — จุดเก่าบนแผนที่แปลว่ารถอยู่ที่ที่มันไม่ได้อยู่แล้ว */
      stale: false,
      distanceFilter: DISTANCE_FILTER_M,
    },
    (position?: Location, error?: { code?: string }) => {
      if (error) {
        handlers.onError(error.code === 'NOT_AUTHORIZED')
        return
      }
      if (!position) return
      handlers.onFix({ lat: position.latitude, lng: position.longitude, accuracy: position.accuracy })
    },
  )
  return () => { void NativeBackgroundGeolocation.removeWatcher({ id }) }
}

function watchWeb(handlers: WatchHandlers): WatchStop {
  const id = navigator.geolocation.watchPosition(
    (pos) => handlers.onFix({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    }),
    (err) => handlers.onError(err.code === err.PERMISSION_DENIED),
    { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}

/**
 * เริ่มติดตาม คืนฟังก์ชันสำหรับหยุด
 *
 * คืนเป็น Promise เพราะฝั่ง native ต้องรอผลการขอสิทธิ์ก่อนถึงจะมี id ให้ยกเลิก
 * ผู้เรียกต้องเรียกตัวหยุดเสมอ ไม่งั้นเครื่องจะตามตำแหน่งต่อหลังปิดเที่ยวไปแล้ว
 */
export async function watchPosition(handlers: WatchHandlers): Promise<WatchStop> {
  if (isNativeApp()) return watchNative(handlers)
  if (!('geolocation' in navigator)) {
    handlers.onError(false)
    return () => {}
  }
  return watchWeb(handlers)
}

/** พาไปหน้าตั้งค่าของแอป — ใช้ตอนคนขับกดปฏิเสธสิทธิ์ไปแล้ว ซึ่งกล่องขอสิทธิ์
 *  จะไม่ขึ้นอีกเลย และไม่มีทางแก้จากในแอป */
export async function openAppSettings(): Promise<void> {
  if (isNativeApp()) await NativeBackgroundGeolocation.openSettings()
}
