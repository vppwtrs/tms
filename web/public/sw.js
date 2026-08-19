/* Service Worker — เปิดใช้เฉพาะ production build (ดู web/src/main.tsx)
   กลยุทธ์:
   - ไฟล์ asset (มี hash) → cache-first หลังโหลดครั้งแรก (offline เปิดได้)
   - navigation (หน้า) → network-first, ตกเครือข่ายคืน shell หน้าแรก
   - /api → ไม่ cache (ข้อมูลสดเสมอ) */
/* base ที่แอปถูกเสิร์ฟ — '/' บนเครื่องออฟฟิศ แต่ '/tms/' บน GitHub Pages
   คิดจากตำแหน่งของไฟล์นี้เอง ไม่ใช่เขียนตายตัว เพราะไฟล์ใน public/ ไม่ผ่าน Vite
   จึงแทนค่า import.meta.env.BASE_URL ให้ไม่ได้ ถ้าเขียน '/' ตายตัวไว้
   SHELL จะ cache ผิดที่ แล้วเปิด offline เจอจอขาว */
const BASE = new URL('./', self.location).pathname
/* ขึ้นเลขรุ่นเมื่อกติกาการแคชเปลี่ยน — activate ลบแคชที่ชื่อไม่ตรงทิ้งทั้งก้อน
   v2: manifest กับไอคอนย้ายไป network-first (ดูเหตุผลด้านล่าง) */
const CACHE = `tms-shell-${BASE}-v2`
const INDEX = `${BASE}index.html`
const SHELL = [
  BASE,
  INDEX,
  `${BASE}manifest.webmanifest`,
  `${BASE}icons/icon-192.png`,
  `${BASE}icons/icon-512.png`,
  `${BASE}icons/apple-touch-icon.png`,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // เฉพาะ GET + โดเมนเดียวกัน + ข้าม API (ข้อมูลต้องสด)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith(`${BASE}api`)) return

  /* manifest กับไอคอนต้องเอาของใหม่ก่อนเสมอ — ไฟล์พวกนี้ไม่มี hash ในชื่อ
     cache-first จึงแปลว่าเครื่องที่เคยเปิดเว็บแล้วจะถือ manifest รุ่นแรกไปตลอดกาล
     ซึ่งเคยทำให้ "เพิ่มไปยังหน้าจอโฮม" ได้ทางลัดชี้ไปรากเว็บ (start_url เก่า)
     และไอคอนไม่ขึ้นเพราะ path ในไฟล์เก่าชี้ไป /icons/ ที่ไม่มีอยู่จริง */
  const fresh = url.pathname === `${BASE}manifest.webmanifest` || url.pathname.startsWith(`${BASE}icons/`)
  if (fresh) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => caches.match(request)),
    )
    return
  }

  // navigation → network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(INDEX, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(INDEX)),
    )
    return
  }

  // asset → cache-first (ไฟล์มี hash จึงปลอดภัย)
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
          }
          return res
        }),
    ),
  )
})
