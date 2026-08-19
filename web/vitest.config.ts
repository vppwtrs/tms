import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.a11y.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    /* ค่า default ของ vitest คือ 5 วินาที ซึ่งเป็นเส้นเดียวกับที่เทส dashboard
       (render <App /> ทั้งแอป + axe สแกน DOM จริง) แตะพอดีเมื่อไฟล์อื่นรันขนานกัน
       วัดแล้ว: รันเดี่ยว 2.1 วินาที รันพร้อมกัน 5.04 วินาที
       เส้นนี้วัดว่าเครื่องว่างแค่ไหน ไม่ได้วัดความเร็วของโค้ด ตั้งชิดคือเทสแดงสลับเขียว */
    testTimeout: 15000,
    /* src/api/supabase.ts โยน error ทันทีที่ import ถ้าไม่มีค่าสองตัวนี้ ซึ่งถูกแล้วสำหรับของจริง
       แต่ CI ไม่มี .env (ถูก gitignore) เทสที่ import AppCloud เลยตายตั้งแต่ยังไม่ทันรัน
       ค่าหลอกตรงนี้แค่พาให้ createClient ผ่าน ไม่มีการยิงเน็ตจริงในเทส */
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
