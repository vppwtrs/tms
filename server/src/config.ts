import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const config = {
  port: Number(process.env.PORT ?? 3100),
  /** ใน production server จะเสิร์ฟ static frontend ที่ build แล้วด้วย */
  webDistPath: process.env.WEB_DIST ?? path.resolve(__dirname, '../../web/dist'),
  dbPath: process.env.DB_PATH ?? path.resolve(__dirname, '../data/tms.db'),
  /** โฟลเดอร์เก็บรูปหลักฐาน POD (ไม่อยู่ใน web root — เสิร์ฟผ่าน endpoint ที่ต้องล็อกอิน) */
  podDir: process.env.POD_DIR ?? path.resolve(__dirname, '../data/pod'),
  /** เปิด HTTPS — จำเป็นสำหรับกล้องในหน้าเว็บ (getUserMedia ใช้ได้เฉพาะ secure context) */
  https: process.env.HTTPS !== '0',
  /** ใบรับรองจริง (ถ้ามี) — ไม่ตั้งค่า ระบบจะสร้างใบ self-signed ให้เอง */
  sslCertPath: process.env.SSL_CERT ?? '',
  sslKeyPath: process.env.SSL_KEY ?? '',
  certDir: process.env.CERT_DIR ?? path.resolve(__dirname, '../data/cert'),
  jwtSecret: process.env.JWT_SECRET ?? 'tms-dev-secret-change-me',
  jwtTtl: '12h',
  bcryptRounds: 10,
} as const
