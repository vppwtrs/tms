/**
 * build.js — ฝัง payload.js ลงใน launcher HTML
 * รัน: node build.js
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
let payload = fs.readFileSync(path.join(dir, 'payload.js'), 'utf8');
const shell = fs.readFileSync(path.join(dir, 'launcher.template.html'), 'utf8');

// ตัวเขียน .xlsx ใช้ร่วมกับเวอร์ชัน server — ดึงมาจากไฟล์ต้นทางเสมอ
// จะได้ไม่มีสำเนาที่หลุดเวอร์ชันกัน แก้ที่เดียวจบทั้งสองแอป
const xlsxSrc = fs.readFileSync(
  path.join(dir, '..', 'tms-extractor', 'public', 'xlsx.js'), 'utf8');

// ไฟล์ต้นทางห่อด้วย IIFE ที่แขวน buildXlsx ไว้บน window — ในนี้ไม่ต้องแตะ window
const inner = xlsxSrc
  .replace(/^[\s\S]*?\(function \(root\) \{/, '')
  .replace(/root\.buildXlsx = buildXlsx;[\s\S]*$/, '');

if (!/function buildXlsx/.test(inner)) {
  console.error('แกะ xlsx.js ไม่ออก — ตรวจว่าโครงไฟล์ยังเป็น IIFE (function (root) {...}) อยู่');
  process.exit(1);
}
payload = payload.replace('__XLSX__', inner.trim());

// กัน parser ปิด script tag กลางคัน
const safe = payload.replace(/<\/script/gi, '<\\/script');

const out = shell.replace('__PAYLOAD__', safe);
fs.writeFileSync(path.join(dir, '..', 'tms-extractor-standalone.html'), out);

console.log('สร้าง tms-extractor-standalone.html แล้ว —', out.length, 'bytes');
