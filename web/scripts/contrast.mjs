/**
 * ตรวจ WCAG contrast ratio (AA) ของคู่สีใน design system
 * รัน: node scripts/contrast.mjs
 * ผ่าน AA: ข้อความปกติ ≥ 4.5:1, ข้อความใหญ่/UI ≥ 3:1
 * ค่าทั้งหมดต้องตรงกับ Layer 2/3 ใน styles/tokens.css
 */
function lum(hex) {
  const c = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
  const f = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return ((l1 + 0.05) / (l2 + 0.05)).toFixed(2)
}
function row(name, fg, bg, need = 4.5) {
  const r = parseFloat(ratio(fg, bg))
  console.log(`${r >= need ? '✅' : '❌'} ${name.padEnd(46)} ${ratio(fg, bg).padStart(5)}:1  (${fg} on ${bg})`)
  return r >= need
}
console.log('=== WCAG AA audit — Aurora (เป้าหมาย 4.5:1 ข้อความปกติ) ===\n')
const pass = []
// หมึกบนพื้นผิว
pass.push(row('ink on surface', '#241f33', '#ffffff'))
pass.push(row('ink on paper (bg)', '#241f33', '#faf9fd'))
pass.push(row('ink-soft on surface', '#4a4360', '#ffffff'))
pass.push(row('muted on surface', '#706a86', '#ffffff'))
pass.push(row('muted on paper (bg)', '#706a86', '#faf9fd'))
pass.push(row('muted on surface-2 (inputs)', '#706a86', '#fbfafe'))
pass.push(row('faint on surface (table head 11px)', '#6f6a85', '#ffffff'))
pass.push(row('faint on paper-deep', '#6f6a85', '#f1eff8'))
// ลิงก์
pass.push(row('link (violet-700) on surface', '#533f8c', '#ffffff'))
pass.push(row('link hover (violet-800) on surface', '#3e2f6b', '#ffffff'))
// ปุ่ม
pass.push(row('white on btn-accent (violet-600)', '#ffffff', '#6b52ad'))
pass.push(row('white on btn-primary (ink)', '#f2f0fb', '#241f33'))
pass.push(row('white on btn-danger', '#ffffff', '#b8405b'))
pass.push(row('white on btn-success', '#ffffff', '#1f7a5f'))
// Badges — คู่สีตัวอักษร + พื้นอ่อน (เข้มขึ้นให้ผ่าน AA)
pass.push(row('success on success-bg (badge)', '#1f7a5f', '#e4f5ef'))
pass.push(row('danger on danger-bg (badge)', '#b8405b', '#fce9ee'))
pass.push(row('warning on warning-bg (badge)', '#8f5a15', '#fcf1df'))
pass.push(row('info on info-bg (badge)', '#4e5fc7', '#e7eafd'))
pass.push(row('neutral on neutral-bg (badge)', '#5f5a74', '#efedf6'))
// Sidebar
pass.push(row('sidebar text (ink-2) on surface', '#4a4360', '#ffffff'))
pass.push(row('sidebar faint (section label)', '#6f6a85', '#ffffff'))
pass.push(row('white on sidebar active (grad mid)', '#ffffff', '#6551a8'))
pass.push(row('white on nav-badge (rose-700)', '#ffffff', '#b4576f'))
// องค์ประกอบที่ไม่ใช่ข้อความ — เกณฑ์ 3:1 (WCAG 1.4.11 Non-text Contrast)
pass.push(row('focus ring (violet-500) on surface', '#8a6bd1', '#ffffff', 3))
pass.push(row('focus ring (violet-500) on paper', '#8a6bd1', '#faf9fd', 3))
pass.push(row('ขอบฟิลด์ผิดพลาด (danger) on surface', '#b8405b', '#ffffff', 3))
// ---------- โหมดมืด (Aurora กลางคืน) ----------
console.log('\n--- โหมดมืด ---')
pass.push(row('ink on surface (dark)', '#edeaf7', '#1c1830'))
pass.push(row('ink on paper (dark)', '#edeaf7', '#14111f'))
pass.push(row('ink-2 on surface (dark)', '#cfc9e4', '#1c1830'))
pass.push(row('muted on surface (dark)', '#a49dbd', '#1c1830'))
pass.push(row('faint on surface (dark, table head)', '#9b94b4', '#1c1830'))
pass.push(row('link (violet-300) on surface (dark)', '#c3b0ec', '#1c1830'))
pass.push(row('success on success-bg (dark)', '#4cbf9c', '#16302a'))
pass.push(row('danger on danger-bg (dark)', '#ee8098', '#331e26'))
pass.push(row('warning on warning-bg (dark)', '#e0ae5c', '#322715'))
pass.push(row('info on info-bg (dark)', '#93a0f2', '#1f2444'))
pass.push(row('neutral on neutral-bg (dark)', '#a49dbd', '#262038'))
pass.push(row('white on sidebar active (dark, grad mid)', '#ffffff', '#6551a8'))
pass.push(row('ink on btn-primary (dark)', '#120e19', '#8a6bd1'))
pass.push(row('focus ring (violet-300) on surface (dark)', '#c3b0ec', '#1c1830', 3))
pass.push(row('focus ring (violet-300) on paper (dark)', '#c3b0ec', '#14111f', 3))

const ok = pass.filter(Boolean).length
console.log(`\n${ok}/${pass.length} ผ่าน AA`)
