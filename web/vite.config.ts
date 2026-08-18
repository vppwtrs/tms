import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = process.env.PORT ?? 3100

/* GitHub Pages เสิร์ฟที่ <user>.github.io/<repo>/ ไม่ใช่ราก asset ทุกตัวจึงต้องมี prefix
   ตั้งผ่าน VITE_BASE ใน workflow — เว้นว่างตอน dev และตอน build ลง server ของตัวเอง */
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'es2019',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          /* แผนที่แยกก้อนของตัวเอง — หนักกว่าครึ่งของ vendor เดิม และมีหน้าเดียวที่ใช้
             รวมไว้ใน vendor เท่ากับบังคับให้คนขับโหลดแผนที่ทุกครั้งที่เปิดแอปในรถ */
          if (id.includes('node_modules/leaflet')) return 'map'
          if (id.includes('node_modules')) return 'vendor'
          return undefined
        }
      }
    }
  }
})
