import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

/* เทส a11y บางตัว render <App /> ทั้งแอปแล้วรอข้อมูลโหลด
   ค่า default ของ testing-library คือ 1 วินาที ซึ่งไม่พอเมื่อหลายไฟล์รันขนานกัน
   บนเครื่องที่ไม่ได้แรงมาก — เคยล้มแบบ flaky ทั้งที่โค้ดถูก */
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  localStorage.clear()
})
