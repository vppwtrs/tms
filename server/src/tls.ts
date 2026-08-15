import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import selfsigned from 'selfsigned'
import { config } from './config.js'

/**
 * ใบรับรอง TLS สำหรับใช้ในวง LAN
 *
 * ทำไมต้องมี: กล้องในหน้าเว็บ (`navigator.mediaDevices.getUserMedia`) ทำงานเฉพาะบน
 * secure context เท่านั้น เปิดผ่าน http://192.168.x.x เบราว์เซอร์จะไม่ยอมให้ใช้กล้องเลย
 * คนขับจึงถ่ายรูปหน้างานไม่ได้ ถ้าไม่เปิด HTTPS
 *
 * ใบรับรองสร้างเองอัตโนมัติ เก็บที่ server/data/cert/ อายุ 2 ปี
 * ครอบคลุม localhost + IP ทุกใบในวง LAN ของเครื่องนี้ (SAN)
 *
 * เครื่องคนขับจะขึ้นเตือน "ไม่ปลอดภัย" ครั้งแรก เพราะไม่มี CA ที่เครื่องรู้จักเซ็นให้
 * ทางแก้: ส่งไฟล์ server/data/cert/cert.pem ไปติดตั้งเป็น trusted certificate
 * บนมือถือคนขับครั้งเดียว (iOS: Settings > General > VPN & Device Management
 * แล้วเปิด Certificate Trust Settings ด้วย)
 *
 * ถ้ามีใบรับรองจริงอยู่แล้ว ตั้ง SSL_CERT / SSL_KEY ชี้ไฟล์เอง ระบบจะใช้ตัวนั้นแทน
 */
export interface TlsFiles {
  cert: string
  key: string
}

/**
 * IP ที่ใช้งานได้จริงของเครื่องนี้ — ใส่ลง SAN เพื่อให้เปิดจากมือถือในวง LAN
 * ได้โดยไม่เตือนว่าชื่อไม่ตรง
 *
 * ตัด 169.254.x (APIPA) ทิ้ง: Windows แจกให้การ์ดที่ไม่ได้ต่อเน็ตจริง เช่น
 * Bluetooth, VPN ที่ไม่ได้เชื่อม, Ethernet ที่ไม่ได้เสียบสาย เครื่องหนึ่งมีได้หลายใบ
 * และเปลี่ยนทุกครั้งที่เสียบ/ถอด ถ้าเอามาใส่ SAN ด้วย ใบรับรองจะถูกออกใหม่แทบทุกครั้ง
 * ที่เปิดเครื่อง แล้วมือถือคนขับต้องกดยอมรับใบใหม่ซ้ำ ๆ
 */
function localAddresses(): string[] {
  const ips = new Set<string>(['127.0.0.1'])
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')) ips.add(n.address)
    }
  }
  return [...ips]
}

async function generate(certPath: string, keyPath: string): Promise<TlsFiles> {
  const ips = localAddresses()
  const notAfterDate = new Date()
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 2)

  const pems = await selfsigned.generate([{ name: 'commonName', value: 'TMS' }], {
    notAfterDate,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      /* cA + keyCertSign: จำเป็นถ้าจะเอาไปติดตั้งเป็น trusted root บนมือถือคนขับ
         extKeyUsage serverAuth: iOS/Android ปฏิเสธใบที่ไม่ระบุไว้ */
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2 as const, value: 'localhost' },
          ...ips.map((ip) => ({ type: 7 as const, ip })),
        ],
      },
    ],
  })
  fs.mkdirSync(path.dirname(certPath), { recursive: true })
  fs.writeFileSync(certPath, pems.cert)
  fs.writeFileSync(keyPath, pems.private)
  // จด IP ที่ออกใบไว้ — ตัว PEM เป็น base64 อ่านย้อนไม่ได้ตรง ๆ
  fs.writeFileSync(path.join(path.dirname(certPath), 'cert.meta.json'), JSON.stringify({ ips }))
  return { cert: pems.cert, key: pems.private }
}

/** ใบเก่าที่ไม่ครอบคลุม IP ปัจจุบัน เปิดจากมือถือแล้วจะเตือน "ชื่อไม่ตรง" — ต้องออกใหม่ */
function coversCurrentIps(dir: string): boolean {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'cert.meta.json'), 'utf8')) as { ips?: string[] }
    const issued = new Set(meta.ips ?? [])
    return localAddresses().every((ip) => issued.has(ip))
  } catch {
    return false
  }
}

/**
 * คืนใบรับรองที่พร้อมใช้ — สร้างใหม่ให้อัตโนมัติถ้ายังไม่มี
 * สร้างใหม่ด้วยถ้า IP ของเครื่องเปลี่ยนไปจากตอนออกใบ (ย้ายออฟฟิศ/เปลี่ยน Wi-Fi)
 */
export async function loadOrCreateCert(): Promise<TlsFiles> {
  if (config.sslCertPath && config.sslKeyPath) {
    return {
      cert: fs.readFileSync(config.sslCertPath, 'utf8'),
      key: fs.readFileSync(config.sslKeyPath, 'utf8'),
    }
  }

  const certPath = path.join(config.certDir, 'cert.pem')
  const keyPath = path.join(config.certDir, 'key.pem')

  if (fs.existsSync(certPath) && fs.existsSync(keyPath) && coversCurrentIps(path.dirname(certPath))) {
    return {
      cert: fs.readFileSync(certPath, 'utf8'),
      key: fs.readFileSync(keyPath, 'utf8'),
    }
  }

  return generate(certPath, keyPath)
}
