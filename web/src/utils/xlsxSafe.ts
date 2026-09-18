/** กัน Excel formula injection — ค่าที่มาจาก TMS import หรือชื่อคน/รถซึ่งเราไม่คุมเนื้อหา
 *  ถ้าขึ้นต้นด้วย =+-@ ให้เติม ' นำหน้า ไม่งั้น Excel จะตีความเป็นสูตรตอนเปิดไฟล์ */
export function xlsxSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}
