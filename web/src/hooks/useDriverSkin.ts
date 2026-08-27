import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { setDriverSkin } from '../styles/driverSkin'

/* หน้าที่ถือว่าเป็นของคนขับ — จอเดียวจริง ๆ แต่เขียนเป็นรายการไว้
   เพราะถ้าวันหนึ่งมีจอที่สองของคนขับ จะได้เพิ่มที่เดียว ไม่ใช่ไล่หา */
const DRIVER_PATHS = ['/my-jobs']

/**
 * เปิดผิว Design C เฉพาะตอนอยู่บนจอคนขับ
 *
 * ผิวนี้ถูกทำมาสำหรับนิ้วในรถ ปุ่มสูง 52px ตัวหนังสือใหญ่ คอนทราสต์สำหรับกลางแดด
 * ซึ่งเป็นของที่ผิดสำหรับตารางงานของออฟฟิศบนจอ 27 นิ้ว จึงเปิดปิดตามหน้า
 * ไม่ใช่ติดค้างทั้งเว็บ
 *
 * ในแอป iOS หรือตอนเปิดด้วย ?native=1 main.tsx ติดคลาสให้ตั้งแต่บูตอยู่แล้ว
 * ตรงนั้นตั้งใจให้ติดทั้งเว็บ เพราะทุกหน้าที่เปิดในแอปคือหน้าของคนขับ
 * hook นี้จึงไม่แตะเมื่อถูกบังคับไว้แล้ว
 */
export function useDriverSkin(): void {
  const { pathname } = useLocation()
  useEffect(() => {
    /* ต้องอ่านที่เดียวกับที่ main.tsx เขียน — sessionStorage ไม่ใช่ localStorage
       และกันพลาดไว้ เพราะ Safari โหมดส่วนตัวโยน error ตรงนี้ */
    let saved = false
    try {
      saved = sessionStorage.getItem('preview-native') === '1'
    } catch {
      /* เฉย ๆ — ไม่มีที่เก็บก็ถือว่าไม่ได้บังคับดูตัวอย่าง */
    }
    const forced = saved || document.documentElement.dataset.nativeShell === '1'
    if (forced) return
    const on = DRIVER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
    void setDriverSkin(on)
  }, [pathname])
}
