import axe from 'axe-core'
import { expect } from 'vitest'

/**
 * ตั้งค่า axe ร่วมสำหรับทุกเทส
 * - ตรวจ wcag2a / wcag2aa / best-practice
 * - ปิด rule ที่ครอบคลุมโดยเครื่องมืออื่นหรือเป็นงานแยก:
 *   · color-contrast — jsdom คำนวณสีไม่ได้ ครอบคลุมโดย web/scripts/contrast.mjs (WCAG AA 18/18)
 *   · region — landmark/semantic HTML ยังเป็นงานค้างใน Phase 2 (ดู docs/ROADMAP-2026.md)
 *   · page-has-heading-one — เทสระดับชิ้นส่วน ไม่ได้เป็นหน้าจริง
 */
export const AXE_CONFIG: axe.RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'best-practice'] },
  rules: {
    'color-contrast': { enabled: false },
    region: { enabled: false },
    'page-has-heading-one': { enabled: false },
  },
}

/** รัน axe บน DOM ที่เรนเดอร์แล้ว — ห้ามมี violation ใด ๆ */
export async function expectNoAxeViolations(root: HTMLElement = document.body): Promise<void> {
  const results = await axe.run(root, AXE_CONFIG)
  const pretty = results.violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`)
    .join('\n')
  expect(results.violations, pretty).toEqual([])
}
