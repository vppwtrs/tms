import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* โหมดสาธิต — สลับชั้น api ทั้งชั้นไปหาไฟล์ใน src/demo ที่ไม่ยิงออกเน็ตเลย
   ทำที่ alias แทนการใส่ if ลงในไฟล์ api จริง เพราะโค้ดที่ขึ้น production
   ไม่ควรมีทางแยกสำหรับข้อมูลปลอมอยู่ข้างในตั้งแต่แรก */
const demoModule = (name: string): string =>
  fileURLToPath(new URL(`./src/demo/${name}.ts`, import.meta.url))

/* regex ต้องกินทั้งเส้น เพราะ replacement ของ alias ทับเฉพาะส่วนที่ match
   จับแค่ท้ายเส้นจะได้ '..' ค้างอยู่หน้าพาธเต็มแล้วหาไฟล์ไม่เจอ */
const demoAliases = ['myjobs', 'auth', 'tmsAuth', 'storage', 'tracking', 'pod', 'supabase'].map((name) => ({
  find: new RegExp(String.raw`^\.\./api/${name}(\.js)?$`),
  replacement: demoModule(name),
}))

const apiPort = process.env.PORT ?? 3100

/* GitHub Pages เสิร์ฟที่ <user>.github.io/<repo>/ ไม่ใช่ราก asset ทุกตัวจึงต้องมี prefix
   ตั้งผ่าน VITE_BASE ใน workflow — เว้นว่างตอน dev และตอน build ลง server ของตัวเอง */
const base = process.env.VITE_BASE ?? '/'

export default defineConfig(({ mode }) => ({
  base,
  resolve: {
    alias: mode === 'demo' ? demoAliases : [],
  },
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
}))
