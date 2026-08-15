import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor — แปลงเว็บ TMS เป็นแอป native (iOS/Android)
 *
 * ขั้นตอน (ต้องใช้ macOS + Xcode สำหรับ iOS):
 *   1. npm run build -w web                          # build frontend -> web/dist
 *   2. VITE_API_BASE=https://tms.example.com npm run build -w web   # (ถ้า API อยู่คนละโดเมน)
 *   3. npx cap sync -w web                           # คัดลอก dist + assets เข้า ios/
 *   4. เปิดบน Mac: npx cap open ios                  # เปิด Xcode แล้วกด Run / Archive
 *
 * ⚠️ เปลี่ยน appId ก่อนขึ้น App Store — ต้องตรงกับ Apple Developer Team
 */
const config: CapacitorConfig = {
  appId: 'com.transplus.tms',
  appName: 'ทรานส์พลัส TMS',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
