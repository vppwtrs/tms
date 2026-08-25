import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * รับคำค้นที่ติดมากับ URL (`?q=`) แล้วส่งต่อให้ช่องค้นหาของหน้านั้น
 *
 * ใช้กับช่องค้นหารวมบนแถบบน (`components/ops/OpsSearch.tsx`) ซึ่งพาคนมาที่หน้านี้
 * พร้อมคำค้น ถ้าไม่มีตัวนี้ หน้าปลายทางจะเปิดขึ้นมาโล่ง ๆ แล้วคนต้องพิมพ์ซ้ำอีกรอบ
 *
 * ล้าง `q` ออกจาก URL หลังรับแล้ว ด้วยเหตุผลสองข้อ: กดปุ่มล้างตัวกรองแล้วคำค้น
 * ต้องไม่ฟื้นกลับมาตอนรีเฟรช และลิงก์ที่คนก๊อปไปแปะต่อจะได้ไม่พาคนอื่นไปเจอ
 * ตัวกรองของเราค้างอยู่
 */
export function useUrlSearchTerm(apply: (term: string) => void): void {
  const [params, setParams] = useSearchParams()
  const term = params.get('q')

  useEffect(() => {
    if (!term) return
    apply(term)
    const next = new URLSearchParams(params)
    next.delete('q')
    setParams(next, { replace: true })
    /* apply เปลี่ยนตัวตนทุกเรนเดอร์ในหน้าที่เขียนเป็น arrow ตรง ๆ — ใส่ลงในรายการ
       ที่เฝ้าดูแล้วจะวนไม่จบ ตัวที่ตัดสินจริงคือ term ตัวเดียว */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term])
}
