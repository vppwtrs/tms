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
  ['customers.write', 'จัดการลูกค้า', 'ลูกค้า', 'เพิ่ม แก้ไข หรือลบข้อมูลลูกค้า'],
  ['orders.view', 'ดูออเดอร์', 'ออเดอร์', 'เปิดดูรายการออเดอร์'],
  ['orders.write', 'จัดการออเดอร์', 'ออเดอร์', 'สร้างและแก้ไขออเดอร์'],
  ['dispatch.view', 'ดูเที่ยวและแผนงาน', 'เที่ยวและการจัดส่ง', 'ดูเที่ยวและแผนงานขนส่ง'],
  ['dispatch.write', 'จัดการเที่ยวและแผนงาน', 'เที่ยวและการจัดส่ง', 'สร้างและเปลี่ยนแปลงแผนงาน'],
  ['drivers.view', 'ดูพนักงานขับรถ', 'พนักงานขับรถ', 'เปิดดูข้อมูลพนักงานขับรถ'],
  ['drivers.write', 'จัดการพนักงานขับรถ', 'พนักงานขับรถ', 'เพิ่มและแก้ไขข้อมูลพนักงานขับรถ'],
  ['vehicles.view', 'ดูรถยนต์', 'รถยนต์', 'เปิดดูข้อมูลรถยนต์'],
  ['vehicles.write', 'จัดการรถยนต์', 'รถยนต์', 'เพิ่มและแก้ไขข้อมูลรถยนต์'],
  ['pod.view', 'ดูหลักฐานการส่ง', 'POD', 'เห็นหลักฐานของทุกคน ไม่ใช่เฉพาะของตัวเอง'],
  ['pod.insert', 'ส่งหลักฐานการส่ง', 'POD', 'บันทึกหลักฐานการส่งสินค้า'],
  ['pod.update', 'แก้ไขหลักฐานการส่ง', 'POD', 'แก้ไขหลักฐานของงานที่รับผิดชอบ'],
  ['pod.write', 'จัดการหลักฐานการส่ง', 'POD', 'แนบหรือแก้หลักฐานของงานที่ไม่ได้ขับเอง'],
  ['pod.verify', 'ยืนยันหลักฐานการส่ง', 'POD', 'ตรวจแล้วยืนยันว่าหลักฐานใช้ได้'],
  ['myjobs.view', 'ดูงานของฉัน', 'งานของฉัน', 'ดูงานที่ได้รับมอบหมาย'],
  ['myjobs.progress', 'เดินงานของฉัน', 'งานของฉัน', 'รับงาน เริ่มเดินทาง ปิดจุดส่ง และปิดเที่ยว'],
  ['myjobs.pod', 'เก็บหลักฐานการส่ง', 'งานของฉัน', 'ถ่ายรูปและบันทึก POD ของงานที่รับผิดชอบ'],
  ['users.manage', 'จัดการผู้ใช้และสิทธิ์', 'ผู้ใช้และสิทธิ์', 'สงวนให้ผู้ดูแลระบบเท่านั้น'],
  ['data.manage', 'จัดการข้อมูลระบบ', 'ข้อมูลระบบ', 'ดูแลข้อมูลระบบและชุดทดสอบ'],
].map(([permission, label, group, description]) => ({ permission: permission!, label: label!, group: group!, description: description! }))

export const permissionInfo = (permission: string): PermissionInfo =>
  PERMISSION_INFO.find((p) => p.permission === permission) ?? { permission, label: permission, group: 'อื่นๆ', description: 'สิทธิ์ระบบ' }
