import type { UserRole } from '../types/database.js'

export type PermissionInfo = { permission: string; label: string; group: string; description: string }

export const ROLE_INFO: Record<UserRole, { label: string; description: string }> = {
  admin: { label: 'ผู้ดูแลระบบ', description: 'จัดการผู้ใช้ สิทธิ์ และข้อมูลทั้งหมด' },
  dispatcher: { label: 'วางแผนงาน', description: 'ดูและจัดการงานขนส่งประจำวัน' },
  viewer: { label: 'ดูอย่างเดียว', description: 'เปิดดูข้อมูลโดยไม่แก้ไขงาน' },
  driver: { label: 'พนักงานขับรถ', description: 'ดูงานของฉันและส่งสถานะ/POD' },
}

export const PERMISSION_INFO: PermissionInfo[] = [
  ['dashboard.view', 'ดูหน้าสรุป', 'ภาพรวม', 'เปิดหน้าภาพรวมระบบ'],
  ['customers.view', 'ดูลูกค้า', 'ลูกค้า', 'เปิดดูรายชื่อลูกค้าและรายละเอียด'],
  ['customers.write', 'จัดการลูกค้า', 'ลูกค้า', 'เพิ่มและแก้ไขข้อมูลลูกค้า'],
  ['customers.delete', 'ลบลูกค้า', 'ลูกค้า', 'ลบลูกค้าที่ยังไม่มีออเดอร์ในระบบ'],
  ['orders.view', 'ดูออเดอร์', 'ออเดอร์', 'เปิดดูรายการออเดอร์'],
  ['orders.write', 'จัดการออเดอร์', 'ออเดอร์', 'สร้างและแก้ไขออเดอร์'],
  ['dispatch.view', 'ดูเที่ยวและแผนงาน', 'เที่ยวและการจัดส่ง', 'ดูเที่ยวและแผนงานขนส่ง'],
  ['dispatch.write', 'จัดการเที่ยวและแผนงาน', 'เที่ยวและการจัดส่ง', 'สร้างและเปลี่ยนแปลงแผนงาน'],
  ['drivers.view', 'ดูพนักงานขับรถ', 'พนักงานขับรถ', 'เปิดดูข้อมูลพนักงานขับรถ'],
  ['drivers.write', 'จัดการพนักงานขับรถ', 'พนักงานขับรถ', 'เพิ่มและแก้ไขข้อมูลพนักงานขับรถ'],
  ['drivers.delete', 'ลบพนักงานขับรถ', 'พนักงานขับรถ', 'ลบพนักงานขับรถที่ยังไม่มีงานผูกอยู่'],
  ['vehicles.view', 'ดูรถยนต์', 'รถยนต์', 'เปิดดูข้อมูลรถยนต์'],
  ['vehicles.write', 'จัดการรถยนต์', 'รถยนต์', 'เพิ่มและแก้ไขข้อมูลรถยนต์'],
  ['vehicles.delete', 'ลบรถยนต์', 'รถยนต์', 'ลบรถที่ยังไม่มีเที่ยวผูกอยู่'],
  ['pod.view', 'ดูหลักฐานการส่ง', 'POD', 'เห็นหลักฐานของทุกคน ไม่ใช่เฉพาะของตัวเอง'],
  ['pod.insert', 'ส่งหลักฐานการส่ง', 'POD', 'บันทึกหลักฐานการส่งสินค้า'],
  ['pod.update', 'แก้ไขหลักฐานการส่ง', 'POD', 'แก้ไขหลักฐานของงานที่รับผิดชอบ'],
  ['pod.write', 'จัดการหลักฐานการส่ง', 'POD', 'แนบหรือแก้หลักฐานของงานที่ไม่ได้ขับเอง'],
  ['pod.verify', 'ยืนยันหลักฐานการส่ง', 'POD', 'ตรวจแล้วยืนยันว่าหลักฐานใช้ได้'],
  ['myjobs.view', 'ดูงานของฉัน', 'งานของฉัน', 'ดูงานที่ได้รับมอบหมาย'],
  ['myjobs.progress', 'เดินงานของฉัน', 'งานของฉัน', 'รับงาน เริ่มเดินทาง ปิดจุดส่ง และปิดเที่ยว'],
  ['myjobs.pod', 'เก็บหลักฐานการส่ง', 'งานของฉัน', 'ถ่ายรูปและบันทึก POD ของงานที่รับผิดชอบ'],
  ['users.manage', 'จัดการผู้ใช้และสิทธิ์', 'ผู้ใช้และสิทธิ์', 'สงวนให้ผู้ดูแลระบบเท่านั้น'],
].map(([permission, label, group, description]) => ({ permission: permission!, label: label!, group: group!, description: description! }))

export const permissionInfo = (permission: string): PermissionInfo =>
  PERMISSION_INFO.find((p) => p.permission === permission) ?? { permission, label: permission, group: 'อื่นๆ', description: 'สิทธิ์ระบบ' }

/** ชั้นบนของหมวดสิทธิ์ — เรียงตามเมนูข้างซ้าย ไม่ได้ตั้งใหม่
 *
 *  อยู่ที่นี่เพราะมีสองหน้าจอที่ต้องเรียงเหมือนกัน: สิทธิ์เริ่มต้นของกลุ่ม กับสิทธิ์รายคน
 *  ถ้าต่างหน้าต่างเรียง คนที่เปิดสองหน้าเทียบกันจะหาบรรทัดเดียวกันไม่เจอ
 *  ซึ่งเป็นสิ่งที่ต้องทำทุกครั้งที่ตั้งข้อยกเว้นให้ใครสักคน */
export const PERMISSION_SECTIONS: { label: string; hint: string; groups: string[] }[] = [
  { label: 'ปฏิบัติการ', hint: 'งานประจำวันที่เกิดขึ้นบนหน้าจอ', groups: ['ภาพรวม', 'ออเดอร์', 'เที่ยวและการจัดส่ง', 'POD'] },
  { label: 'ข้อมูลหลัก', hint: 'ทะเบียนที่งานประจำวันหยิบไปใช้', groups: ['ลูกค้า', 'รถยนต์', 'พนักงานขับรถ'] },
  { label: 'งานของคนขับ', hint: 'สิทธิ์ที่ใช้ในแอปคนขับเท่านั้น', groups: ['งานของฉัน'] },
  { label: 'ระบบ', hint: 'สงวนให้ผู้ดูแลระบบ', groups: ['ผู้ใช้และสิทธิ์'] },
]

/** จัดสิทธิ์เข้าหมวดแล้วเข้าชั้น ตามลำดับของ PERMISSION_SECTIONS
 *
 *  หมวดที่ยังไม่ถูกจัดชั้น (สิทธิ์ใหม่ที่เพิ่มใน PERMISSION_INFO แล้วลืมมาต่อที่นี่)
 *  ต้องยังโผล่ในชั้น "อื่น ๆ" ไม่ใช่หายเงียบจนไม่มีใครรู้ว่ามันตั้งค่าไม่ได้
 *
 *  @param available รายการสิทธิ์ที่ตั้งได้จริงจาก catalog — ว่าง = ยังโหลดไม่เสร็จ ให้เอาทั้งหมด
 */
export function sectionedPermissions(
  available: string[],
): { label: string; hint: string; groups: { group: string; entries: PermissionInfo[] }[] }[] {
  const source = PERMISSION_INFO.filter((p) => available.length === 0 || available.includes(p.permission))
  const byGroup = source.reduce<Record<string, PermissionInfo[]>>((acc, p) => {
    (acc[p.group] ??= []).push(p)
    return acc
  }, {})
  const placed = new Set(PERMISSION_SECTIONS.flatMap((s) => s.groups))
  const rest = Object.keys(byGroup).filter((g) => !placed.has(g))

  return [...PERMISSION_SECTIONS, { label: 'อื่น ๆ', hint: 'ยังไม่ได้จัดหมวด', groups: rest }]
    .map((section) => ({
      label: section.label,
      hint: section.hint,
      /* หมวดที่ไม่มีสิทธิ์เหลือให้ตั้ง (catalog ตัดไปแล้ว) ต้องไม่เหลือหัวข้อลอยไว้ */
      groups: section.groups.filter((g) => byGroup[g]?.length).map((g) => ({ group: g, entries: byGroup[g]! })),
    }))
    .filter((section) => section.groups.length > 0)
}
