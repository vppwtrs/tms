import type { CapacitorConfig } from '@capacitor/cli'

/**
 * แอป iOS สำหรับคนขับ — เปลือก Capacitor ที่ห่อหน้าเว็บเดิมไว้
 *
 * แยกออกมาจาก web/capacitor.config.ts เพราะแอปตัวนี้ไม่ใช่ระบบทั้งระบบ
 * มีแต่จอของคนขับ และมีสิทธิ์ที่ฝั่งออฟฟิศไม่ต้องขอ (พิกัดเบื้องหลัง กล้อง)
 *
 * ลำดับ:
 *   1. npm run build:cloud -w web      # ได้ web/dist
 *   2. npm run sync -w ios-driver      # คัดลอก dist มาที่ ios-driver/www แล้ว cap sync
 *   3. build จริงต้องใช้ macOS — ดู .github/workflows/ios-driver.yml
 */
const config: CapacitorConfig = {
  appId: 'com.transplus.tms.driver',
  appName: 'TMS คนขับ',
  webDir: 'www',
  ios: {
    /* คนขับใช้กลางแดดในรถ ธีมสว่างอ่านง่ายกว่า และตรงกับค่าตั้งต้นของเว็บ */
    preferredContentMode: 'mobile',
  },
}

export default config
