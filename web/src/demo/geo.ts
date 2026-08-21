/**
 * ตำแหน่งปลอมสำหรับโหมดสาธิต
 *
 * จอคนขับขอสิทธิ์ตำแหน่งก่อนกดรับงาน และปฏิเสธการรับงานถ้าไม่ได้ — ซึ่งถูกแล้ว
 * สำหรับของจริง แต่กรอบพรีวิวในเครื่องมือแก้โค้ดไม่มีทางกดอนุญาตได้เลย
 * โหมดสาธิตจึงติดตั้งตัวปลอมทับ ไม่ใช่ปิดด่านนั้นทิ้ง — ด่านที่ถูกปิดตอนสาธิต
 * คือด่านที่ไม่มีใครได้ลอง
 *
 * จุดเริ่มอยู่แถวบางนา แล้วขยับทีละนิดทุกครั้งที่ถูกถาม เส้นทางบนแผนที่จะได้
 * ไม่เป็นจุดเดียวนิ่ง ๆ
 */
const START = { lat: 13.6668, lng: 100.6045 }
let step = 0

function position(): GeolocationPosition {
  step += 1
  return {
    coords: {
      latitude: START.lat + step * 0.0009,
      longitude: START.lng + step * 0.0006,
      accuracy: 12,
      altitude: null,
      altitudeAccuracy: null,
      heading: 45,
      speed: 8,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  } as GeolocationPosition
}

export function installDemoGeolocation(): void {
  let nextId = 1
  const timers = new Map<number, ReturnType<typeof setInterval>>()

  const fake: Geolocation = {
    getCurrentPosition(success) {
      setTimeout(() => success(position()), 120)
    },
    watchPosition(success) {
      const id = nextId++
      setTimeout(() => success(position()), 120)
      timers.set(id, setInterval(() => success(position()), 5_000))
      return id
    },
    clearWatch(id) {
      const t = timers.get(id)
      if (t) { clearInterval(t); timers.delete(id) }
    },
  }

  Object.defineProperty(navigator, 'geolocation', { value: fake, configurable: true })
}
