/* Service Worker — เปิดใช้เฉพาะ production build (ดู web/src/main.tsx)
   กลยุทธ์:
   - ไฟล์ asset (มี hash) → cache-first หลังโหลดครั้งแรก (offline เปิดได้)
   - navigation (หน้า) → network-first, ตกเครือข่ายคืน shell หน้าแรก
   - /api → ไม่ cache (ข้อมูลสดเสมอ) */
const CACHE = 'tms-shell-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']

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
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return

  // navigation → network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/index.html')),
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
