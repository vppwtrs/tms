#!/usr/bin/env node
/**
 * ตัวเปิด/ปิด server แบบพกพา — ย้ายเครื่องแล้วใช้ได้เลย
 *
 *   node scripts/serve.mjs start     เปิด (bootstrap ให้อัตโนมัติ)
 *   node scripts/serve.mjs stop      ปิด
 *   node scripts/serve.mjs restart   ปิดแล้วเปิดใหม่
 *   node scripts/serve.mjs status    ดูสถานะ
 *
 * ไม่มี path ตายตัว ไม่มี secret ฝังในไฟล์ — อ้างอิงตำแหน่งไฟล์นี้เป็นหลัก
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runDir = path.join(root, '.run')
const pidFile = path.join(runDir, 'server.pid')
const logFile = path.join(runDir, 'server.log')
const isWin = process.platform === 'win32'
const npm = isWin ? 'npm.cmd' : 'npm'
const PORT = Number(process.env.PORT ?? 3100)
/* HTTPS เป็นค่าเริ่มต้น — กล้องของคนขับ (getUserMedia) ใช้ได้เฉพาะ secure context
   ต้องตรงกับ config.https ฝั่ง server */
const SCHEME = process.env.HTTPS === '0' ? 'http' : 'https'

const log = (m) => console.log(m)
const die = (m) => { console.error(`✗ ${m}`); process.exit(1) }

/** รันคำสั่งแบบ blocking แล้วโชว์ output สด ๆ */
function run(cmd, args, label) {
  log(`… ${label}`)
  // บน Windows ต้องใช้ shell (npm.cmd); ต่อเป็น string เดียวเพื่อไม่โดน
  // คำเตือน DEP0190 ของ Node 24 (args + shell:true) และกัน path ที่มีช่องว่าง
  const r = isWin
    ? spawnSync([cmd, ...args].join(' '), { cwd: root, stdio: 'inherit', shell: true })
    : spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) die(`${label} ไม่สำเร็จ (exit ${r.status})`)
}

function nodeMajor() {
  return Number(process.versions.node.split('.')[0])
}

/** ตรวจว่าโค้ด src ใหม่กว่า dist หรือไม่
 *  ถ้าใหม่ = build เก่า ต้อง rebuild ก่อนเปิด — ไม่งั้นผู้ใช้แก้โค้ดแล้ว
 *  กด start.cmd ยังได้เวอร์ชันเก่าอยู่โดยไม่รู้ตัว (บั๊กที่เจอจริง) */
function isStale(distFile, srcDir) {
  if (!fs.existsSync(distFile)) return true
  const distTime = fs.statSync(distFile).mtimeMs
  let newest = 0
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx|css|html)$/.test(e.name)) newest = Math.max(newest, fs.statSync(p).mtimeMs)
    }
  }
  walk(srcDir)
  return newest > distTime
}

/** เตรียมทุกอย่างที่ขาด — เครื่องใหม่จะผ่านตรงนี้ครั้งเดียว */
function bootstrap() {
  if (nodeMajor() < 20) die(`ต้องใช้ Node 20 ขึ้นไป (เครื่องนี้ ${process.versions.node}) — ดาวน์โหลด https://nodejs.org`)

  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    run(npm, ['install'], 'ติดตั้ง dependencies (ครั้งแรกใช้เวลาสักครู่)')
  }

  const needBuild =
    isStale(path.join(root, 'server', 'dist', 'index.js'), path.join(root, 'server', 'src')) ||
    isStale(path.join(root, 'web', 'dist', 'index.html'), path.join(root, 'web', 'src'))
  if (needBuild) run(npm, ['run', 'build'], 'build โปรเจกต์ (โค้ดเปลี่ยนไปจากรอบที่แล้ว)')

  const dbPath = process.env.DB_PATH ?? path.join(root, 'server', 'data', 'tms.db')
  if (!fs.existsSync(dbPath)) run(npm, ['run', 'seed'], 'สร้างฐานข้อมูล + ข้อมูลตัวอย่าง')
}

/** เลข IP ในวง LAN — ไว้เปิดจากมือถือ/เครื่องอื่น
 *
 *  เครื่องออฟฟิศมักมี IP หลายใบ ส่วนใหญ่ใช้ไม่ได้จริง:
 *  169.254.x คือที่อยู่ที่ Windows แจกเองให้การ์ดที่ไม่ได้ต่อเน็ต (Bluetooth,
 *  VPN ที่ไม่ได้เชื่อม, Ethernet ที่ไม่ได้เสียบสาย) — เคยมีเครื่องที่หยิบใบพวกนี้
 *  ขึ้นมาโชว์ แล้วคนขับเปิดตาม URL ไม่ได้เลย
 *  จึงตัดทิ้ง แล้วเลือกวง LAN มาตรฐาน (192.168 / 10 / 172.16–31) ก่อนเสมอ */
function lanIp() {
  const candidates = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family !== 'IPv4' || n.internal) continue
      if (n.address.startsWith('169.254.')) continue
      candidates.push(n.address)
    }
  }
  const isPrivate = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
  return candidates.find(isPrivate) ?? candidates[0] ?? null
}

/** เรียก /api/health — ข้ามการตรวจใบรับรอง เพราะเป็นใบที่ server สร้างเอง */
function healthy() {
  return new Promise((resolve) => {
    const mod = SCHEME === 'https' ? https : http
    const req = mod.request(
      { host: '127.0.0.1', port: PORT, path: '/api/health', method: 'GET', rejectUnauthorized: false, timeout: 3000 },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      },
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

function portBusy(port) {
  return new Promise((resolve) => {
    const s = createServer()
    s.once('error', () => resolve(true))
    s.once('listening', () => s.close(() => resolve(false)))
    s.listen(port, '0.0.0.0')
  })
}

/** เปิดเบราว์เซอร์เริ่มต้นไปที่หน้าเว็บ — ใช้กับ start.cmd (--open) */
function openBrowser(url) {
  try {
    if (isWin) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* เบราว์เซอร์เปิดไม่ได้ — ไม่ใช่เรื่อง fatal */
  }
}

function readPid() {
  if (!fs.existsSync(pidFile)) return null
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim())
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0) // ส่ง signal 0 = เช็คว่ายังอยู่มั้ย ไม่ได้ฆ่า
    return pid
  } catch {
    fs.rmSync(pidFile, { force: true }) // pid ค้างจากรอบที่แล้ว
    return null
  }
}

async function start() {
  const running = readPid()
  if (running) {
    log(`• server เปิดอยู่แล้ว (pid ${running}) → ${SCHEME}://localhost:${PORT}`)
    return
  }
  if (await portBusy(PORT)) {
    die(`port ${PORT} ถูกใช้อยู่โดยโปรแกรมอื่น — ปิดโปรแกรมนั้น หรือสั่ง PORT=3200 แล้วเปิดใหม่`)
  }

  bootstrap()
  fs.mkdirSync(runDir, { recursive: true })

  const out = fs.openSync(logFile, 'a')
  const child = spawn(process.execPath, [path.join(root, 'server', 'dist', 'index.js')], {
    cwd: path.join(root, 'server'),
    env: { ...process.env, PORT: String(PORT) },
    /* แยกออกจาก terminal เพื่อให้ปิดหน้าต่างแล้ว server ยังอยู่
       บน Windows ถ้าไม่ detach ลูกจะผูกกับ console ของพ่อ แล้วตายตามทันทีที่ shell ปิด */
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  })
  child.unref()
  fs.writeFileSync(pidFile, String(child.pid))

  // รอให้ server ตอบจริงก่อนบอกว่าสำเร็จ (เครื่องช้าอาจใช้เวลาถึง ~15 วิ)
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (!readPid()) die(`server ปิดตัวเองตอนเริ่ม — ดู log: ${logFile}`)
    if (await healthy()) break
    if (i === 59) log('! server ยังไม่ตอบ health check — อาจกำลังเริ่ม ดู log ถ้าเปิดไม่ขึ้น')
  }

  const ip = lanIp()
  log('')
  log(`✓ เปิด server แล้ว (pid ${child.pid})`)
  log(`  เครื่องนี้    ${SCHEME}://localhost:${PORT}`)
  if (ip) log(`  เครื่องอื่น   ${SCHEME}://${ip}:${PORT}`)
  if (SCHEME === 'https') {
    log('  หมายเหตุ   ใบรับรองสร้างเอง เปิดครั้งแรกเบราว์เซอร์จะเตือน — กด "ดำเนินการต่อ" ได้')
  }
  log(`  log        ${logFile}`)
  log(`  ปิด        node scripts/serve.mjs stop`)

  if (process.argv.includes('--open')) openBrowser(`${SCHEME}://localhost:${PORT}`)
}

function stop() {
  const pid = readPid()
  if (!pid) {
    log('• ไม่มี server ที่เปิดอยู่')
    return
  }
  if (isWin) {
    // /T = ปิดลูกด้วย, Windows ไม่มี process group แบบ POSIX
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* ตายไปแล้ว */ } }
  }
  fs.rmSync(pidFile, { force: true })
  log(`✓ ปิด server แล้ว (pid ${pid})`)
}

async function status() {
  const pid = readPid()
  if (pid) log(`● กำลังทำงาน — pid ${pid} · ${SCHEME}://localhost:${PORT}`)
  else if (await portBusy(PORT)) log(`? port ${PORT} มีโปรแกรมอื่นใช้อยู่ (ไม่ใช่ตัวที่สคริปต์นี้เปิด)`)
  else {
    log('○ ปิดอยู่')
    // เตือนว่าโค้ดเปลี่ยนไปแล้ว — เปิดครั้งหน้าจะ build ให้อัตโนมัติ
    if (
      isStale(path.join(root, 'server', 'dist', 'index.js'), path.join(root, 'server', 'src')) ||
      isStale(path.join(root, 'web', 'dist', 'index.html'), path.join(root, 'web', 'src'))
    ) {
      log('  ! โค้ดเปลี่ยนไปจาก build ล่าสุด — เปิดใหม่ (start) จะ build ให้อัตโนมัติ')
    }
  }
}

const cmd = process.argv[2] ?? 'start'
if (cmd === 'start') await start()
else if (cmd === 'stop') stop()
else if (cmd === 'restart') { stop(); await new Promise((r) => setTimeout(r, 1200)); await start() }
else if (cmd === 'status') await status()
else die(`ไม่รู้จักคำสั่ง "${cmd}" — ใช้ start | stop | restart | status`)
