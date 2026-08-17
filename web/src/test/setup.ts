import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

/* เทส a11y บางตัว render <App /> ทั้งแอปแล้วรอข้อมูลโหลด
   ค่า default ของ testing-library คือ 1 วินาที ซึ่งไม่พอเมื่อหลายไฟล์รันขนานกัน
   บนเครื่องที่ไม่ได้แรงมาก — เคยล้มแบบ flaky ทั้งที่โค้ดถูก

   ขยับจาก 5000 เป็น 8000 ตอนเพิ่มหน้าฝั่งคลาวด์ (0013): เทส dashboard ตัวเดียว
   รันเดี่ยว ๆ ใช้ 2.1 วินาที แต่รันพร้อมไฟล์อื่นแตะ 5.04 วินาที = ล้มที่เส้น 5 พอดี
   เส้นนี้ไม่ได้วัดความเร็วของโค้ด มันวัดว่าเครื่องว่างแค่ไหน ตั้งชิดเกินคือ
   เทสจะแดงสลับเขียวตามภาระเครื่อง แล้วคนจะเลิกเชื่อผลเทส */
configure({ asyncUtilTimeout: 8000 })

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  localStorage.clear()
})
