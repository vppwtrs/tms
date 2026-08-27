import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/* ===== Content Security Policy =====
   GitHub Pages ตั้ง HTTP header เองไม่ได้ ทางเดียวที่เหลือคือ meta ในหน้า
   หน้าที่ของมันคือจำกัดว่าหน้านี้โหลดของจากที่ไหนได้ ถ้ามี XSS หลุดเข้ามา
   สคริปต์ที่ฝังมาจะยิงข้อมูลออกไปหาโดเมนของคนร้ายไม่ได้

   ฉีดตอน build เท่านั้น ไม่เขียนลง index.html ตรง ๆ เพราะ dev server ของ Vite
   ใช้สคริปต์ inline ของตัวเอง (HMR, React Refresh) ซึ่งจะโดนบล็อกจนแก้โค้ดไม่ได้

   เติมโดเมนใหม่ที่นี่ทุกครั้งที่เพิ่มบริการภายนอก ไม่งั้นของจะไม่โหลดแบบเงียบ ๆ
   error ไปโผล่ที่ console ไม่ใช่ที่หน้าจอ

   ข้อจำกัดที่แก้ไม่ได้: frame-ancestors ใช้ใน meta ไม่ได้ตามสเปก การกันเว็บอื่น
   เอาเราไปฝัง iframe จึงทำด้วยสคริปต์ดีดตัวเองใน index.html แทน

   'unsafe-inline' ของ style-src จำเป็นจริง — React กับ Leaflet เขียน style ใส่
   element ตรง ๆ ตลอดเวลา ส่วน script-src ไม่ใช้ ใช้ hash ของสคริปต์ inline แทน
   ซึ่งคำนวณสดจากตัวไฟล์ทุกครั้งที่ build จึงไม่มีทางค้างไม่ตรงกับของจริง */
const cspPlugin = (): Plugin => ({
  name: 'tms-csp',
  apply: 'build',
  transformIndexHtml(html) {
    /* ต้องแปลง CRLF เป็น LF ก่อนคำนวณ ไม่ใช่แค่เรื่องความสวยงาม:
       เบราว์เซอร์คิด hash จากเนื้อสคริปต์ "หลังผ่านตัวแยกวิเคราะห์ HTML" ซึ่งสเปก
       บังคับให้แปลง 

 เป็น 
 ตั้งแต่ขั้นอ่านสตรีม ถ้าคำนวณจากไบต์ในไฟล์ตรง ๆ
       บนเครื่อง Windows ที่ git ตั้ง autocrlf ไว้ จะได้คนละค่ากับที่เบราว์เซอร์คิด
       ผลคือสคริปต์โดนบล็อกทั้งที่ hash "ถูกต้อง" เมื่อเทียบกับไฟล์

       เจอตอนทดสอบจริง 27 ส.ค. 69 — หน้าเว็บยังขึ้นปกติทุกอย่าง ผิดแค่ธีมไม่ถูกทา
       กับตัวกัน iframe ไม่ทำงาน ซึ่งไม่มีใครสังเกตจากการเปิดดูเฉย ๆ */
    const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map(m => `'sha256-${createHash('sha256').update((m[1] ?? '').split('\r').join('')).digest('base64')}'`)
      .join(' ')

    const policy = [
      "default-src 'self'",
      `script-src 'self' ${hashes}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      /* data:/blob: คือรูปกับลายเซ็นที่คนขับเพิ่งถ่าย ยังไม่ได้อัปขึ้นถัง
         longdo กับ openstreetmap คือ tile ของแผนที่ติดตามรถ */
      "img-src 'self' data: blob: https://*.supabase.co https://tile.openstreetmap.org https://ms.longdo.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      'upgrade-insecure-requests',
    ].join('; ')

    /* ต่อท้าย <meta charset> เอง ไม่ใช้ injectTo: 'head-prepend' เพราะนั่นดัน
       charset ให้ถอยไปข้างหลัง ซึ่งสเปกบังคับว่าต้องอยู่ใน 1024 ไบต์แรกของไฟล์
       และนโยบายเส้นนี้ยาวพอที่จะเบียดมันจนเสี่ยง */
    const charset = '<meta charset="UTF-8" />'
    const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
    return html.replace(charset, `${charset}
    ${meta}`)
  },
})

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
  plugins: [react(), cspPlugin()],
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
