/** สิทธิ์การเข้าถึง — แหล่งความจริงเดียวของทั้งระบบ (server บังคับ, web ใช้ซ่อน/แสดงปุ่ม)
 *
 *  โมเดล: บทบาท = "ชุดสำเร็จ" (preset) · แล้ว admin ปรับรายคนทับได้
 *    สิทธิ์ที่ใช้จริง = preset ของบทบาท ∪ ที่เปิดเพิ่ม − ที่ปิดไว้
 *  ตารางที่เก็บส่วน "ปรับรายคน" คือ user_permissions (เก็บเฉพาะที่ต่างจาก preset)
 *
 *  ชื่อสิทธิ์เป็น <ทรัพยากร>.<การกระทำ> เสมอ — เพิ่มใหม่ต้องเติมทั้ง PERMISSIONS
 *  และ PERMISSION_GROUPS ไม่งั้นจะมีสิทธิ์ที่ตั้งค่าจากหน้าจอไม่ได้
 */

export const PERMISSIONS = [
  'dashboard.view',
  'orders.view', 'orders.write', 'orders.cancel',
  'dispatch.view', 'dispatch.write',
  'quotes.view', 'quotes.write', 'quotes.convert',
  'customers.view', 'customers.write', 'customers.delete',
  'vehicles.view', 'vehicles.write', 'vehicles.delete',
  'drivers.view', 'drivers.write', 'drivers.delete',
  'pod.view', 'pod.write', 'pod.verify',
  'reports.view', 'reports.export',
  'csv.view', 'csv.export',
  'users.manage',
  'settings.manage',
  /* สิทธิ์แบบ "เฉพาะของตัวเอง" — ต่างจากข้างบนตรงที่ไม่ได้เปิดทั้งตาราง
     แต่เปิดเฉพาะแถวที่ผูกกับบัญชีคนนั้น (ผ่าน drivers.user_id)
     server กรองระดับแถวให้ ไม่ใช่แค่ปล่อยผ่านแล้วหวังว่าหน้าจอจะซ่อนถูก */
  'myjobs.view',
  'myjobs.progress',
  'myjobs.pod',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const PERMISSION_LABEL: Record<Permission, string> = {
  'dashboard.view': 'ดูหน้าภาพรวม (มีตัวเลขรายได้)',
  'orders.view': 'ดูออเดอร์ทั้งหมด (เห็นค่าขนส่ง)',
  'orders.write': 'สร้าง/แก้ไขออเดอร์',
  'orders.cancel': 'ยกเลิกออเดอร์',
  'dispatch.view': 'ดูแผนงานขนส่ง',
  'dispatch.write': 'สร้าง/จัดการเที่ยววิ่ง',
  'quotes.view': 'ดูใบเสนอราคา',
  'quotes.write': 'สร้าง/แก้ไขใบเสนอราคา',
  'quotes.convert': 'แปลงใบเสนอราคาเป็นออเดอร์',
  'customers.view': 'ดูข้อมูลลูกค้า',
  'customers.write': 'สร้าง/แก้ไขลูกค้า · บันทึกการติดต่อ',
  'customers.delete': 'ลบลูกค้า',
  'vehicles.view': 'ดูข้อมูลรถ',
  'vehicles.write': 'สร้าง/แก้ไขรถ · เปลี่ยนสถานะ',
  'vehicles.delete': 'ลบรถ',
  'drivers.view': 'ดูข้อมูลพนักงานขับ',
  'drivers.write': 'สร้าง/แก้ไขพนักงานขับ · เปลี่ยนสถานะ',
  'drivers.delete': 'ลบพนักงานขับ',
  'pod.view': 'ดูหลักฐานการส่งมอบ',
  'pod.write': 'เก็บ/แก้ไขหลักฐานการส่งมอบ',
  'pod.verify': 'ยืนยันหลักฐาน (ล็อกถาวร)',
  'reports.view': 'ดูรายงาน',
  'reports.export': 'ส่งออกรายงาน Excel',
  'csv.view': 'ดูหน้าข้อมูล CSV',
  'csv.export': 'สั่งเขียนไฟล์ CSV ใหม่',
  'users.manage': 'จัดการผู้ใช้และสิทธิ์',
  'settings.manage': 'แก้ไขการตั้งค่าองค์กร',
  'myjobs.view': 'ดูเที่ยววิ่งของตัวเอง (ไม่เห็นค่าขนส่ง)',
  'myjobs.progress': 'กดเริ่มเดินทาง / ส่งเสร็จ เที่ยวของตัวเอง',
  'myjobs.pod': 'เก็บหลักฐานส่งมอบของออเดอร์ในเที่ยวตัวเอง',
}

/** คำเตือนสำหรับสิทธิ์ที่ให้แล้วถอนคืนยาก — หน้าจอเอาไปแสดงเป็นหมายเหตุ */
export const PERMISSION_WARNING: Partial<Record<Permission, string>> = {
  'orders.cancel': 'ยกเลิกแล้วย้อนกลับไม่ได้',
  'pod.verify': 'ยืนยันแล้วแก้หลักฐานไม่ได้อีก',
  'customers.delete': 'ลบแล้วกู้คืนไม่ได้',
  'vehicles.delete': 'ลบแล้วกู้คืนไม่ได้',
  'drivers.delete': 'ลบแล้วกู้คืนไม่ได้',
  'users.manage': 'ให้สิทธิ์นี้ = ให้สิทธิ์แจกสิทธิ์ต่อได้ทุกอย่าง',
}

/** จัดกลุ่มตามหน้าจอที่ผู้ใช้เห็นจริง — ไม่ใช่ตามตารางในฐานข้อมูล */
export const PERMISSION_GROUPS: { key: string; label: string; perms: Permission[] }[] = [
  { key: 'myjobs', label: 'งานของฉัน (คนขับ)', perms: ['myjobs.view', 'myjobs.progress', 'myjobs.pod'] },
  { key: 'overview', label: 'ภาพรวม', perms: ['dashboard.view'] },
  { key: 'orders', label: 'ออเดอร์', perms: ['orders.view', 'orders.write', 'orders.cancel'] },
  { key: 'dispatch', label: 'แผนงานขนส่ง', perms: ['dispatch.view', 'dispatch.write'] },
  { key: 'quotes', label: 'ใบเสนอราคา', perms: ['quotes.view', 'quotes.write', 'quotes.convert'] },
  { key: 'customers', label: 'ลูกค้า (CRM)', perms: ['customers.view', 'customers.write', 'customers.delete'] },
  { key: 'vehicles', label: 'รถยนต์', perms: ['vehicles.view', 'vehicles.write', 'vehicles.delete'] },
  { key: 'drivers', label: 'พนักงานขับ', perms: ['drivers.view', 'drivers.write', 'drivers.delete'] },
  { key: 'pod', label: 'หลักฐานการส่งมอบ (POD)', perms: ['pod.view', 'pod.write', 'pod.verify'] },
  { key: 'reports', label: 'รายงาน', perms: ['reports.view', 'reports.export'] },
  { key: 'csv', label: 'ข้อมูล CSV', perms: ['csv.view', 'csv.export'] },
  { key: 'admin', label: 'ผู้ดูแลระบบ', perms: ['users.manage', 'settings.manage'] },
]

/** สิทธิ์ของคนขับ — แยกออกมาเพราะเป็นชุดที่ "ห้ามหลุด" ไปอยู่ในบทบาทอื่นโดยไม่ตั้งใจ */
const DRIVER_PERMS: Permission[] = ['myjobs.view', 'myjobs.progress', 'myjobs.pod']

const OFFICE = PERMISSIONS.filter((p) => !DRIVER_PERMS.includes(p))
const VIEW_ONLY: Permission[] = OFFICE.filter((p) => p.endsWith('.view'))

/** ชุดสำเร็จของแต่ละบทบาท — ต้องตรงกับสิ่งที่ผู้ใช้คาดหวังจากชื่อบทบาท */
export const ROLE_PRESET: Record<string, Permission[]> = {
  /* ผู้ดูแล — ทุกอย่าง ยกเว้นสิทธิ์คนขับ (admin ไม่ได้ผูกกับ driver record
     ให้ไปก็ใช้ไม่ได้ เพราะไม่มีเที่ยวของตัวเอง — ให้ไปจะเกิดเมนูที่กดแล้วว่างเปล่า) */
  admin: [...OFFICE],
  /* ผู้วางแผน — งานประจำวันครบ แต่ลบข้อมูลหลักไม่ได้ และแตะผู้ใช้/ตั้งค่าไม่ได้ */
  dispatcher: OFFICE.filter(
    (p) => !p.endsWith('.delete') && p !== 'users.manage' && p !== 'settings.manage',
  ),
  /* ดูอย่างเดียว */
  viewer: [...VIEW_ONLY, 'reports.export'],
  /* คนขับ — เห็นเฉพาะงานของตัวเอง ไม่เห็นออเดอร์รวม ลูกค้า ราคา หรือรายงาน */
  driver: [...DRIVER_PERMS],
}

export function isPermission(v: string): v is Permission {
  return (PERMISSIONS as readonly string[]).includes(v)
}

/** สิทธิ์ที่ใช้จริงของผู้ใช้คนหนึ่ง = preset ของบทบาท ปรับด้วย override รายคน
 *  override เก็บเฉพาะรายการที่ "ต่างจาก preset" — เปลี่ยนบทบาททีหลังจึงยังคงเจตนาเดิมไว้ */
export function effectivePermissions(role: string, overrides: Record<string, boolean>): Permission[] {
  const preset = new Set(ROLE_PRESET[role] ?? [])
  for (const [perm, allowed] of Object.entries(overrides)) {
    if (!isPermission(perm)) continue
    if (allowed) preset.add(perm)
    else preset.delete(perm)
  }
  return PERMISSIONS.filter((p) => preset.has(p))
}
