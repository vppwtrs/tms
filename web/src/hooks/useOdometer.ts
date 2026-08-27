import { useCallback, useEffect, useRef, useState } from 'react'
import { logOdometer, odometerStatus } from '../api/myjobs'
import type { MyJob, OdometerStatus } from '../types'
import { odometerCacheUsable, parseKm } from '../utils/driverActions'

/**
 * ชั้นเลขไมล์ต้นวันของจอคนขับ
 *
 * แยกออกจาก CloudMyJobs วันที่ 27 ส.ค. 69 — เดิมเป็น state 7 ตัวกับ effect 2 ตัว
 * กระจายอยู่กลางคอมโพเนนต์ 1,100 บรรทัด ทั้งที่ทั้งชุดตอบเรื่องเดียว: **วันนี้กรอก
 * เลขไมล์ของรถคันที่กำลังจะขับหรือยัง**
 *
 * ที่ยังต้องคุยกับจอ: กล่องนี้ "ขวาง" การกดปุ่มอื่นได้ กรอกเสร็จแล้วต้องเดินงานที่ค้าง
 * ไว้ต่อให้เอง ไม่ใช่ให้คนขับกดปุ่มเดิมซ้ำ ซึ่งอ่านได้ว่าปุ่มไม่ทำงาน — งานที่ค้างจึงถูก
 * เก็บไว้ที่นี่ แล้วส่งกลับออกไปทาง `onResume`
 *
 * กติกาที่ตัดสินใจล้วน ๆ (ใช้ค่าที่ถืออยู่ได้ไหม, ต้องขวางไหม, เลขที่กรอกใช้ได้ไหม)
 * อยู่ใน utils/driverActions ซึ่งมีเทสต์ ที่นี่เหลือแค่การถือค่ากับจังหวะการถาม
 */

/** งานที่ถูกกล่องขวางไว้ รอเดินต่อหลังกรอกเสร็จ */
export interface PendingAction {
  job: MyJob
  action: 'accept' | 'start'
}

export interface Odometer {
  status: OdometerStatus | null
  /** รถที่ค่าปัจจุบันเป็นของมัน — จอเอาไปขึ้นทะเบียนบนแถบเตือนกับในกล่อง */
  vehicle: { id: number; plate: string } | null
  open: boolean
  value: string
  busy: boolean
  /** งานที่ถูกกล่องนี้ขวางไว้ — จอเอาไปบอกว่ากรอกแล้วจะได้ทำอะไรต่อ */
  pending: PendingAction | null
  setValue: (v: string) => void
  /** เปิดกล่องเอง — มาจากแถบเตือนที่คนขับกดเอง ไม่ใช่การถูกขวาง */
  ask: () => void
  /** ปิดกล่องแล้วทิ้งงานที่ค้าง — คนขับที่ยังไม่ได้อยู่หน้ารถกรอกไม่ได้จริง ๆ
   *  แถบเตือนยังค้างอยู่บนจอจนกว่าจะกรอก */
  close: () => void
  /** ค่าที่ถืออยู่ใช้กับรถคันนี้ได้ไหม ใช้ไม่ได้ = ผู้เรียกต้องไปถามสถานะเอง */
  usableFor: (vehicleId: number) => boolean
  /** ขวางงานที่กำลังจะทำ แล้วเปิดกล่อง — งานถูกเก็บไว้เดินต่อหลังกรอกเสร็จ */
  block: (
    vehicle: { id: number; plate: string },
    status: OdometerStatus | null,
    pending: PendingAction,
  ) => void
  save: () => Promise<void>
}

/* วันของเครื่อง ไม่ใช่ของ UTC — ฐานตัดวันตามเวลาไทย จอต้องตัดตรงกัน
   ไม่งั้นระหว่าง 00:00–07:00 จอจะเชื่อว่าเป็นวันใหม่ก่อนฐานหนึ่งวัน */
const today = (): string => new Date().toLocaleDateString('sv-SE')

export function useOdometer({ duty, live, onResume, onError, onSaved }: {
  /** รถที่ถือว่าเป็น "คันที่ขับอยู่" — null เมื่อยังไม่มีเที่ยวอะไรเลย */
  duty: { id: number; plate: string } | null
  live: MyJob[]
  /** เรียกเมื่อกรอกเสร็จและมีงานค้างอยู่ — จอเป็นคนเดินงานนั้นต่อ */
  onResume: (pending: PendingAction) => void
  onError: (message: string) => void
  onSaved: (km: number) => void
}): Odometer {
  const [status, setStatus] = useState<OdometerStatus | null>(null)
  const [vehicle, setVehicle] = useState<{ id: number; plate: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  /* วันของค่าที่ถืออยู่ — ต่างจากวันนี้เมื่อไหร่แปลว่าค่านั้นหมดอายุแล้ว */
  const [day, setDay] = useState<string | null>(null)
  /* วันที่เด้งกล่องไปแล้ว — เก็บเป็นวัน ไม่ใช่ boolean เพราะแอปเปิดค้างข้ามวันได้ */
  const asked = useRef<string | null>(null)

  /* live เปลี่ยนทุกครั้งที่โหลดงานใหม่ ซึ่งบ่อยกว่าที่ refresh ต้องรู้มาก
     เก็บไว้ใน ref เพื่อไม่ให้ effect ข้างล่างวิ่งใหม่ทุกรอบโหลด */
  const liveRef = useRef(live)
  liveRef.current = live

  const refresh = useCallback(async (v: { id: number; plate: string }, pop: boolean): Promise<void> => {
    try {
      const st = await odometerStatus(v.id)
      setStatus(st)
      setVehicle(v)
      setDay(today())
      /* เด้งเฉพาะคนที่ "เริ่มงานไปแล้ว" — รับงานไว้หรือรถกำลังวิ่ง คนกลุ่มนี้อยู่ที่รถแน่นอน
         ส่วนคนที่ยังไม่รับงานเจอด่านตอนกดรับงานอยู่แล้ว
         ครั้งเดียวต่อวัน ไม่ใช่ต่อการรีเฟรชหนึ่งครั้ง ไม่งั้นกล่องเด้งทับสิ่งที่กำลังกดอยู่ */
      const started = liveRef.current.some((j) => j.vehicle_id === v.id
        && (j.my_accepted_at ?? j.accepted_at) && j.status !== 'completed')
      if (pop && !st.logged_today && started && asked.current !== today()) {
        asked.current = today()
        setValue('')
        setOpen(true)
      }
    } catch {
      /* อ่านสถานะไม่ได้ไม่ใช่เรื่องที่ต้องขึ้น error ทั้งจอ — งานส่งของยังทำต่อได้
         แต่ต้องล้างของเก่าทิ้ง ค่าที่ค้างอยู่คือคำตอบของวันอื่น */
      setStatus(null)
      setDay(null)
    }
  }, [])

  useEffect(() => {
    if (!duty) { setStatus(null); setVehicle(null); setDay(null); return }
    void refresh(duty, true)
  }, [duty?.id, refresh])

  /* แอปที่ติดตั้งบนมือถืออยู่ในหน่วยความจำได้เป็นวัน ๆ คนขับไม่ได้ปิดเปิดใหม่ทุกเช้า
     ถ้าไม่ถามใหม่ตอนกลับมาที่หน้าจอ ค่า logged_today ของเมื่อวานจะค้างอยู่
     แล้วทั้งแถบเตือนและด่านหน้าปุ่มรับงานจะปล่อยผ่านทั้งวัน */
  useEffect(() => {
    const recheck = (): void => {
      if (document.visibilityState !== 'visible') return
      if (!duty) return
      if (day === today()) return
      void refresh(duty, true)
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    /* เผื่อกรณีที่จอเปิดค้างข้ามเที่ยงคืนโดยไม่มีใครสลับแอป — รถจอดอยู่ที่คลัง
       แล้วคนขับวางมือถือไว้บนแท่น เหตุการณ์ข้างบนจะไม่เกิดสักตัว */
    const timer = window.setInterval(recheck, 5 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
      window.clearInterval(timer)
    }
  }, [duty?.id, day, refresh])

  const save = async (): Promise<void> => {
    if (!vehicle) return
    const km = parseKm(value)
    if (km === null) { onError('กรอกเลขไมล์เป็นตัวเลข'); return }
    setBusy(true)
    try {
      await logOdometer(vehicle.id, km, 'start')
      setStatus((prev) => ({
        logged_today: true,
        start_km: km,
        end_km: prev?.end_km ?? null,
        reading_km: km,
        last_km: prev?.last_km ?? null,
      }))
      setDay(today())
      setOpen(false)
      setValue('')
      onSaved(km)
      /* งานที่ค้างอยู่เดินต่อทันที การกรอกเลขไมล์ไม่ใช่เป้าหมายของคนขับ
         มันคือด่านที่ขวางสิ่งที่เขาตั้งใจกด */
      if (pending) { const next = pending; setPending(null); onResume(next) }
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return {
    status,
    vehicle,
    open,
    value,
    busy,
    setValue,
    pending,
    ask: () => { setValue(''); setOpen(true) },
    close: () => { setOpen(false); setPending(null) },
    usableFor: (vehicleId) => odometerCacheUsable(vehicle, day, vehicleId, today()),
    block: (v, st, next) => {
      setStatus(st)
      setVehicle(v)
      setPending(next)
      setValue('')
      setOpen(true)
    },
    save,
  }
}
