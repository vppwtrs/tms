/**
 * ส่งออกทั้งเว็บเป็นเทมเพลตแบบไฟล์ (เหมือนระบบจริง) — เปิดโดยไม่ต้องรัน server
 *
 * โครงสร้างผลลัพธ์ที่ web-static/:
 *   index.html      — ไฟล์เดียว (SPA) มี sidebar + topbar + สลับเนื้อหาแต่ละหน้า
 *   css/styles.css  — design system ทั้งหมด (token/ฐาน/คอมโพเนนต์/animation)
 *   js/pages.js     — เนื้อหาแต่ละหน้า (ข้อมูลจริงฝังอยู่)
 *   js/app.js       — ตัวนำทาง (hash routing + active menu + สลับหน้า)
 *   เอกสาร/         — เทมเพลตเอกสาร (ใบนำส่ง/รายงาน)
 *   ข้อมูล/         — ข้อมูล 9 ตารางเป็น CSV
 *
 * วิธีทำงาน: บูต API จริงจาก SQLite ชั่วคราว → jsdom + React render แต่ละหน้า
 *            → ดึง sidebar/topbar (จากหน้าแรก) + เนื้อหาแต่ละหน้า → ประกอบเป็นชุดเดียว
 *
 * รัน: npm run static:export
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import * as React from 'react' // classic JSX runtime ของ tsx ต้องการ React ใน scope
import type { Root } from 'react-dom/client'
import { openDb } from '../../server/src/db/connection.js'
import { migrate } from '../../server/src/db/schema.js'
import { createApp } from '../../server/src/app.js'
import { config } from '../../server/src/config.js'
import { createCsvStore } from '../../server/src/db/csv.js'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(webRoot, '..')
const outDir = path.join(projectRoot, 'web-static')

const css = ['tokens.css', 'base.css', 'components.css', 'animations.css']
  .map((f) => fs.readFileSync(path.join(webRoot, 'src/styles', f), 'utf8'))
  .join('\n')
const indexHtml = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8')
const fonts = indexHtml.match(/<link[^>]*fonts[^>]*>/g)?.join('\n') ?? ''
const favicon = indexHtml.match(/<link rel="icon"[^>]*>/)?.[0] ?? ''

const EXTRA_CSS = `
/* ===== เวอร์ชันไฟล์สำเร็จรูป — เพิ่มเติมจากระบบจริง ===== */
/* แถบนำทางลอย (ไม่มีในเวอร์ชันรัน server) */
.static-nav {
  position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 4px; align-items: center; flex-wrap: wrap; max-width: 96vw;
  background: rgba(255, 255, 255, 0.95); border: 1px solid rgba(122, 99, 52, 0.2);
  border-radius: 999px; padding: 7px 10px; box-shadow: 0 6px 22px rgba(60, 50, 30, 0.2);
  z-index: 300; font-size: 12.5px; backdrop-filter: blur(6px);
}
.static-nav a {
  color: #5b4a2a; text-decoration: none; font-weight: 600;
  padding: 4px 10px; border-radius: 999px; white-space: nowrap;
}
.static-nav a:hover { background: #f4e9cd; }
.static-nav .badge { color: #8a7f66; font-size: 11px; border-left: 1px solid #ddd5c2; padding-left: 10px; margin-left: 4px; }
@media print { .static-nav { display: none; } }

/* หน้าเข้าสู่ระบบ — เต็มจอแทน shell */
#loginSection { display: none; }
body.login-mode #loginSection { display: block; }
body.login-mode .app-shell { display: none; }
body.login-mode .static-nav { display: none; }
`

/* ลิงก์ของ react-router → hash route (#/...) ให้สลับหน้าได้ในเวอร์ชันไฟล์ */
function fixHashLinks(html: string): string {
  const map: [string, string][] = [
    ['href="/"', 'href="#/"'],
    ['href="/orders"', 'href="#/orders"'],
    ['href="/dispatch"', 'href="#/dispatch"'],
    ['href="/quotes"', 'href="#/quotes"'],
    ['href="/customers"', 'href="#/customers"'],
    ['href="/vehicles"', 'href="#/vehicles"'],
    ['href="/drivers"', 'href="#/drivers"'],
    ['href="/reports"', 'href="#/reports"'],
    ['href="/data"', 'href="#/data"'],
    ['href="/settings"', 'href="#/settings"'],
    ['href="/login"', 'href="#/login"'],
  ]
  let out = html
  for (const [from, to] of map) out = out.split(from).join(to)
  // ลิงก์รายละเอียดลูกค้า: /customers/N → #/customers/N
  out = out.replace(/href="\/customers\/(\d+)"/g, 'href="#/customers/$1"')
  return out
}

async function waitFor(predicate: () => boolean, timeoutMs = 20000, label = 'เนื้อหา'): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 60))
  }
  throw new Error(`⏱ รอ${label}ไม่ทัน (${timeoutMs}ms)`)
}

const APP_JS = `/* TMS เวอร์ชันไฟล์ — hash routing: สลับหน้าโดยไม่ต้องรัน server */
(function () {
  'use strict'
  var PAGES = window.TMS_PAGES || {}
  var TITLES = window.TMS_TITLES || {}
  var content = document.getElementById('content')

  function normalize(h) {
    try { return decodeURIComponent(h.replace(/^#\\/?/, '')) } catch (e) { return '' }
  }

  function render(route) {
    if (route === 'login') {
      document.body.classList.add('login-mode')
    } else {
      document.body.classList.remove('login-mode')
      var html = PAGES[route]
      if (html === undefined) { route = ''; html = PAGES[''] }
      content.innerHTML = html
      window.scrollTo(0, 0)
    }
    var links = document.querySelectorAll('.nav-link')
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('active', normalize(links[i].getAttribute('href') || '') === route)
    }
    document.title = (TITLES[route] ? TITLES[route] + ' — ' : '') + 'TMS (ไฟล์สำเร็จรูป)'
  }

  window.addEventListener('hashchange', function () { render(normalize(location.hash)) })
  // คลิกซ้ำที่ลิงก์เดิม → เลื่อนขึ้นบนสุด
  document.addEventListener('click', function (e) {
    var t = e.target
    var a = t && t.closest ? t.closest('a[href^="#/"]') : null
    if (a && normalize(a.getAttribute('href')) === normalize(location.hash)) window.scrollTo(0, 0)
  })
  render(normalize(location.hash))
})()
`

async function main(): Promise<void> {
  // 1) บูต API จริง
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })
  const db = openDb(config.dbPath)
  migrate(db)
  const csv = createCsvStore(db)
  const server = createApp(db, csv).listen(0)
  await new Promise((r) => server.once('listening', r))
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`
  ;(globalThis as { __TMS_API_BASE__?: string }).__TMS_API_BASE__ = base
  console.log(`✔ API ชั่วคราวพร้อม: ${base} (ฐานข้อมูลจริง: ${config.dbPath})`)

  // 2) ล็อกอิน
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  const loginJson = (await loginRes.json()) as { data: { token: string } }
  const token = loginJson.data.token

  // 3) jsdom
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: `${base}/`,
    pretendToBeVisual: true,
  })
  const { window } = dom
  const g = globalThis as Record<string, unknown>
  g.window = window
  g.document = window.document
  g.localStorage = window.localStorage
  g.location = window.location
  g.history = window.history
  g.getComputedStyle = window.getComputedStyle.bind(window)
  // clock เดียวสำหรับ count-up: performance.now + rAF ของเราเอง (jsdom performance มีบั๊ก)
  const clockStart = Date.now()
  const fakePerf = { now: (): number => Date.now() - clockStart }
  Object.defineProperty(globalThis, 'performance', { value: fakePerf, configurable: true })
  let rafSeq = 0
  const rafCbs = new Map<number, FrameRequestCallback>()
  g.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = ++rafSeq
    rafCbs.set(id, cb)
    setTimeout(() => {
      if (!rafCbs.has(id)) return
      rafCbs.delete(id)
      cb(fakePerf.now())
    }, 16)
    return id
  }
  g.cancelAnimationFrame = (id: number): void => {
    rafCbs.delete(id)
  }
  // Node 21+ มี global navigator เป็น getter-only
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
  window.localStorage.setItem('tms_token', token)

  // 4) React
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router-dom')
  const { AuthProvider } = await import('../src/context/AuthContext')
  const { ToastProvider } = await import('../src/context/ToastContext')
  const App = (await import('../src/App')).default

  const rootEl = document.getElementById('root')!
  let root: Root = createRoot(rootEl)

  const routes: { route: string; title: string; waitText?: string }[] = [
    { route: '/', title: 'ภาพรวม' },
    { route: '/orders', title: 'จัดการออเดอร์', waitText: 'จัดการออเดอร์' },
    { route: '/dispatch', title: 'แผนงานขนส่ง' },
    { route: '/quotes', title: 'ใบเสนอราคา' },
    { route: '/customers', title: 'ลูกค้า' },
    { route: '/vehicles', title: 'รถยนต์' },
    { route: '/drivers', title: 'พนักงานขับ' },
    { route: '/reports', title: 'รายงาน' },
    { route: '/data', title: 'ข้อมูล CSV' },
    { route: '/settings', title: 'ตั้งค่าระบบ' },
  ]

  const pages: Record<string, string> = {}
  const titles: Record<string, string> = {}
  const customerIds = new Set<string>()

  async function renderRoute(route: string): Promise<string> {
    root.unmount()
    root = createRoot(rootEl)
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>,
    )
    return rootEl.innerHTML
  }

  // หน้าแรกก่อน — ใช้ดึง sidebar/topbar (shell กลาง)
  let raw = await renderRoute('/')
  await waitFor(() => !document.querySelector('.skeleton') && !!document.querySelector('.content'), undefined, 'หน้าแรก')
  await new Promise((r) => setTimeout(r, 1200))
  const sidebar = fixHashLinks(document.querySelector('.sidebar')?.outerHTML ?? '')
  const topbar = document.querySelector('.topbar')?.outerHTML ?? ''
  pages[''] = document.querySelector('.content')?.innerHTML ?? ''
  titles[''] = 'ภาพรวม'
  console.log('  ✔ shell (sidebar + topbar)')

  for (const r of routes) {
    if (r.route === '/') continue
    raw = await renderRoute(r.route)
    await waitFor(() => !document.querySelector('.skeleton') && !!document.querySelector('.content'), undefined, `หน้า ${r.route}`)
    if (r.waitText) {
      await waitFor(() => document.body.textContent?.includes(r.waitText) ?? false, undefined, `หัวข้อ ${r.waitText}`)
    }
    await new Promise((rs) => setTimeout(rs, 1200)) // รอ count-up + animation ให้จบ
    if (r.route === '/customers') {
      for (const m of raw.matchAll(/href="\/customers\/(\d+)"/g)) customerIds.add(m[1]!)
    }
    const key = r.route.replace(/^\//, '')
    pages[key] = document.querySelector('.content')?.innerHTML ?? ''
    titles[key] = r.title
    console.log(`  ✔ ${key} (${(pages[key]!.length / 1024).toFixed(1)} KB)`)
  }

  // หน้ารายละเอียดลูกค้า
  for (const id of customerIds) {
    await renderRoute(`/customers/${id}`)
    await waitFor(() => !document.querySelector('.skeleton') && !!document.querySelector('.content'), undefined, `ลูกค้า ${id}`)
    await new Promise((r) => setTimeout(r, 1000))
    pages[`customers/${id}`] = document.querySelector('.content')?.innerHTML ?? ''
    titles[`customers/${id}`] = `ลูกค้า #${id}`
    console.log(`  ✔ customers/${id}`)
  }

  // หน้าเข้าสู่ระบบ (ไม่มี token — ต้องลบก่อน render ไม่งั้น redirect กลับหน้าแรก) — เต็มจอ
  window.localStorage.removeItem('tms_token')
  await renderRoute('/login')
  await waitFor(() => document.body.textContent?.includes('เข้าสู่ระบบ') ?? false, undefined, 'หน้าเข้าสู่ระบบ')
  await new Promise((r) => setTimeout(r, 400))
  pages['login'] = rootEl.innerHTML
  titles['login'] = 'เข้าสู่ระบบ'
  console.log('  ✔ login')

  // 5) เขียนไฟล์: css/ + js/ + index.html
  const cssDir = path.join(outDir, 'css')
  const jsDir = path.join(outDir, 'js')
  fs.mkdirSync(cssDir, { recursive: true })
  fs.mkdirSync(jsDir, { recursive: true })
  fs.writeFileSync(path.join(cssDir, 'styles.css'), css + '\n' + EXTRA_CSS)
  fs.writeFileSync(path.join(jsDir, 'pages.js'), `/* เนื้อหาแต่ละหน้า — ข้อมูลจริงจากฐานข้อมูล (สร้างด้วย npm run static:export) */\nwindow.TMS_PAGES = ${JSON.stringify(pages)};\nwindow.TMS_TITLES = ${JSON.stringify(titles)};\n`)
  fs.writeFileSync(path.join(jsDir, 'app.js'), APP_JS)

  const navLinks = [
    ['', 'ภาพรวม'],
    ['orders', 'ออเดอร์'],
    ['dispatch', 'แผนงาน'],
    ['quotes', 'ใบเสนอราคา'],
    ['customers', 'ลูกค้า'],
    ['vehicles', 'รถยนต์'],
    ['drivers', 'คนขับ'],
    ['reports', 'รายงาน'],
    ['data', 'ข้อมูล CSV'],
    ['settings', 'ตั้งค่า'],
    ['login', 'เข้าสู่ระบบ'],
  ] as const
  const nav = navLinks.map(([r, label]) => `<a href="#/${r}">${label}</a>`).join('')

  const htmlOut = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TMS (ไฟล์สำเร็จรูป)</title>
${favicon}
${fonts}
<link rel="stylesheet" href="css/styles.css">
</head>
<body>
<div class="app-shell" id="appShell">
${sidebar}
  <div class="main">
    ${topbar}
    <main class="content page-enter" id="content"></main>
  </div>
</div>
<section id="loginSection" aria-label="เข้าสู่ระบบ">${pages['login']}</section>
<nav class="static-nav" aria-label="นำทางเวอร์ชันไฟล์">
${nav}
<span class="badge">เวอร์ชันไฟล์สำเร็จรูป · เปิดโดยไม่ต้องรัน server</span>
</nav>
<script src="js/pages.js"></script>
<script src="js/app.js"></script>
</body>
</html>`
  fs.writeFileSync(path.join(outDir, 'index.html'), htmlOut)
  console.log('  ✔ index.html + css/styles.css + js/app.js + js/pages.js')

  // 6) ลบไฟล์ html เดี่ยวรุ่นเก่า (ถ้ามี) — เหลือแค่ index.html
  for (const f of fs.readdirSync(outDir)) {
    if (f.endsWith('.html') && f !== 'index.html') fs.rmSync(path.join(outDir, f), { force: true })
  }

  // 7) รวมเอกสารเทมเพลต + ข้อมูล CSV
  const docsDir = path.join(outDir, 'เอกสาร')
  const dataDir = path.join(outDir, 'ข้อมูล')
  fs.mkdirSync(docsDir, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })
  for (const f of ['bol-form.html', 'bol-form.xlsx', 'report-template.xlsx']) {
    fs.copyFileSync(path.join(projectRoot, 'server/data/templates', f), path.join(docsDir, f))
  }
  const csvSrc = path.join(projectRoot, 'server/data/csv')
  for (const f of fs.readdirSync(csvSrc).filter((f) => f.endsWith('.csv'))) {
    fs.copyFileSync(path.join(csvSrc, f), path.join(dataDir, f))
  }
  console.log('  ✔ เอกสาร/ + ข้อมูล/ รวมเข้าชุดแล้ว')

  // 8) README
  fs.writeFileSync(
    path.join(outDir, 'README.md'),
    `# 📦 TMS — ชุดไฟล์สำเร็จรูปทั้งระบบ (ไม่ต้องรัน server)

เปิด **\`index.html\`** ในเบราว์เซอร์ (double-click) — เป็นไฟล์เดียวเหมือนระบบจริง: มีเมนูข้างซ้าย เปลี่ยนหน้าได้ทันที (ไม่ต้องเปิดหลายไฟล์)
โครงสร้างแยกเป็นโฟลเดอร์เหมือนโปรเจกต์จริง:

| โฟลเดอร์ | มีอะไร |
|---|---|
| \`css/styles.css\` | design system ทั้งหมด (สี/ตัวอักษร/คอมโพเนนต์/animation) |
| \`js/pages.js\` | เนื้อหาทุกหน้า (ข้อมูลจริงจากฐานข้อมูล ฝังในไฟล์) |
| \`js/app.js\` | ตัวนำทาง — สลับหน้า, เมนู active, เปลี่ยน title |
| \`เอกสาร/\` | เทมเพลตเอกสาร (ใบนำส่ง .html/.xlsx, เทมเพลตรายงาน Excel) |
| \`ข้อมูล/\` | ข้อมูล 9 ตารางเป็น CSV (เปิดใน Excel ได้) |

## 📄 เอกสาร (\`เอกสาร/\`)
- \`bol-form.html\` — แบบฟอร์มใบนำส่ง กรอกในเบราว์เซอร์ + พิมพ์
- \`bol-form.xlsx\` — แบบฟอร์มใบนำส่งเปล่า (Excel)
- \`report-template.xlsx\` — เทมเพลตรายงาน 9 ชีต เอา CSV มาแปะต่อได้

## 🗄 ข้อมูล (\`ข้อมูล/\`)
9 ไฟล์ CSV (ลูกค้า/รถ/คนขับ/เที่ยว/ออเดอร์/POD/ใบเสนอราคา/ประวัติติดต่อ/งานติดตาม)

---
⚠️ เป็น **snapshot สถิต**: ปุ่มที่ต้องบันทึกข้อมูลจะไม่ทำงาน (ต้องรัน server จริงเพื่อใช้งานเต็มรูปแบบ) — เหมาะสำหรับดู/สาธิต/พิมพ์/นำไปแจก
อัปเดตข้อมูลใหม่ได้ด้วย \`npm run static:export\`
`,
  )

  server.close()
  db.close()
  console.log('\n✔ เสร็จเรียบร้อย — ชุดไฟล์ครบที่ web-static/ (เปิด index.html ได้เลย ไม่ต้องรัน server)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
