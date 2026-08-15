# แผน: ให้พนักงานขับถ่ายรูปอัปเดตเข้าระบบ

## ของที่มีอยู่ตอนนี้

| ส่วน | สถานะ |
|---|---|
| `POST /api/pod` (ฝั่งออฟฟิศ) | รับรูปได้ 1 ใบ ผ่าน multer field `photo`, ≤ 5MB, JPG/PNG/WebP |
| `POST /api/my-jobs/pod` (ฝั่งคนขับ) | **JSON เท่านั้น ไม่รับรูป** |
| ตาราง `pod` | `photo_path TEXT` — รูปเดียวต่อ POD |
| `web/src/pages/MyJobs.tsx` | มีฟอร์มลายเซ็น ไม่มี UI กล้อง |
| ที่เก็บไฟล์ | `server/data/pod/` เสิร์ฟผ่าน `GET /api/pod/:id/photo` ที่ต้องล็อกอิน |

ใน `myjobs.route.ts` เขียน comment ไว้ว่าจงใจไม่รับรูปจากมือถือ เพราะ "บนรถสัญญาณมักไม่พอส่งรูป" แล้วให้แนบทีหลังที่ออฟฟิศ — ข้อจำกัดนี้คือต้นเหตุของช่องว่างทั้งหมดข้างล่าง

## ช่องว่าง

1. คนขับถ่ายรูปตอนอยู่หน้างานไม่ได้ ต้องกลับมาแนบที่ออฟฟิศ ซึ่งจริง ๆ แล้วมักไม่มีใครแนบ
2. รูปเดียวไม่พอ งานจริงต้องการ สภาพสินค้า / จุดส่ง / ใบส่งของที่เซ็นแล้ว / จุดเสียหาย
3. ไม่มีรูปตอน **รับของ** — เวลาลูกค้าเคลมของเสียหาย พิสูจน์ไม่ได้ว่าเสียมาก่อนหรือเสียระหว่างขน
4. เน็ตหลุดแล้วข้อมูลหาย ไม่มีคิวส่งซ้ำ

## เฟส 1 — คนขับแนบรูปได้ (MVP) ✅ ทำแล้ว

ทำจริงต่างจากแผนเดิมตรงที่เลือกกล้องในหน้าเว็บ (`getUserMedia`) แทน `<input capture>`
เพื่อไม่ให้รูปตกลง Photos ของคนขับ และปิดช่องเลือกรูปเก่าจาก gallery มาปิดงาน
ผลพ่วงคือ **ต้องเปิด HTTPS** ซึ่งทำไปพร้อมกันแล้ว (ดู `server/src/tls.ts`)

ไฟล์ที่เกี่ยวข้อง: `server/src/middleware/upload.ts`, `server/src/tls.ts`,
`web/src/components/CameraCapture.tsx`, `web/src/utils/image.ts`,
เทส `server/src/modules/myjobs/myjobs.route.test.ts`

### แผนเดิมของเฟสนี้

เป้า: ถ่ายรูปตอนส่งของเสร็จ แนบไปกับ POD ในครั้งเดียว

- `POST /api/my-jobs/pod` รับ `multipart/form-data` เพิ่ม (ยังรับ JSON แบบเดิมได้ ของเก่าไม่พัง) ใช้ `uploadSingle` ตัวเดียวกับ `pod.route.ts` — ย้ายไป `src/middleware/upload.ts` ให้สองโมดูลใช้ร่วมกัน
- `MyJobsService.createPod` ส่ง `photo_path` ต่อให้ `PodService.create` ที่รองรับอยู่แล้ว → **ฝั่ง service แทบไม่ต้องแก้**
- Web: `<input type="file" accept="image/*" capture="environment">` เปิดกล้องหลังของมือถือได้ตรง ๆ ทั้ง iOS Safari และ Capacitor ไม่ต้องลง native plugin
- **บีบรูปฝั่ง client ก่อนส่ง** ผ่าน canvas: ย่อด้านยาวสุดเหลือ 1600px, JPEG quality 0.7 → รูปจากมือถือ 4MB เหลือ ~300KB ส่งผ่าน 4G/3G ได้จริง นี่คือส่วนที่ทำให้ข้อกังวลเรื่องสัญญาณเดิมหมดไป
- สิทธิ์: ใช้ `myjobs.pod` เดิม ไม่ต้องเพิ่ม permission ใหม่

แรง: ~0.5–1 วัน

## เฟส 2 — หลายรูป + แยกประเภท

- ตารางใหม่:

```sql
CREATE TABLE IF NOT EXISTS pod_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pod_id INTEGER NOT NULL REFERENCES pod(id),
  filename TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('delivery','goods','document','issue')),
  caption TEXT,
  lat REAL,
  lng REAL,
  taken_at TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pod_photos_pod ON pod_photos(pod_id);
```

- คง `pod.photo_path` ไว้อ่านข้อมูลเก่า (โปรเจ็คไม่มี migration tool) ของใหม่เขียนลงตารางใหม่ทั้งหมด ตอนอ่านให้ service รวมสองแหล่งเป็น list เดียว
- `POST /api/pod/:id/photos` (`multer.array`, สูงสุด 6 ใบ), `DELETE /api/pod/photos/:photoId`
- ล็อกเมื่อ `status = 'verified'` เหมือนกฎเดิมของ POD
- `GET /api/pod/:id/photo` ตัวเดิมคงไว้ เพิ่ม `GET /api/pod/photos/:photoId` สำหรับรูปใหม่

แรง: ~1–2 วัน

## เฟส 3 — รูปตอนรับของ / ระหว่างทาง

ปัญหาเชิงโครงสร้าง: POD สร้างได้เฉพาะออเดอร์ที่ `delivered` แล้ว ทำให้ผูกรูป "ตอนรับของ" เข้ากับ POD ไม่ได้

- แยกตาราง `order_photos` ที่ผูกกับ `order_id` ตรง ๆ ไม่ผ่าน POD ใช้ `stage` = `'pickup' | 'transit' | 'delivery'`
- คนขับถ่ายได้ตั้งแต่ออเดอร์ยัง `in_transit`
- หน้ารายละเอียดออเดอร์ฝั่งออฟฟิศแสดงรูปเรียงตามเวลา = ไทม์ไลน์ของงาน ใช้สู้เคลมได้

แรง: ~1 วัน

## เฟส 4 — ทนสัญญาณหลุด

- คิวใน IndexedDB: กด "บันทึก" แล้วเก็บลงเครื่องทันที แล้วค่อย sync เบื้องหลัง
- แสดงสถานะ "รอส่ง N รายการ" บนหน้า MyJobs
- กันส่งซ้ำด้วย `client_uuid TEXT UNIQUE` ในตาราง pod — ส่งซ้ำได้ปลอดภัย

แรง: ~2 วัน

## เรื่องที่ต้องตัดสินใจก่อนเริ่ม

- **พื้นที่เก็บ** 6 รูป × 300KB × 100 ออเดอร์/วัน ≈ 180MB/วัน ≈ 5GB/เดือน ต้องมีนโยบายล่วงหน้า เช่น รูปเก่ากว่า 1 ปีบีบซ้ำหรือย้ายออกจากเครื่อง server
- **EXIF** ควรลบ metadata ทิ้งตอนบีบรูป (canvas ทำให้อยู่แล้ว) แล้วเก็บพิกัดจาก `navigator.geolocation` เองแทน — ได้ทั้งขนาดเล็กลงและควบคุมข้อมูลส่วนบุคคลได้ชัด
- **multer ใช้ memoryStorage** อยู่ ถ้าเปิดรับ 6 ไฟล์ × 5MB พร้อมกัน = 30MB ต่อ request ค้างใน RAM ควรลดลิมิตต่อไฟล์เหลือ 2MB (client บีบมาแล้ว) หรือเปลี่ยนเป็น diskStorage
- **`signature_data` เก็บเป็น data URL ใน DB** ทำให้ไฟล์ DB โตเร็ว ถ้าจะรื้อเรื่องรูปอยู่แล้ว ควรพิจารณาย้ายลายเซ็นไปเป็นไฟล์เหมือนรูปในคราวเดียวกัน

## ลำดับที่แนะนำ

เฟส 1 ก่อนตัวเดียว แล้วปล่อยให้คนขับใช้จริงสัก 2 สัปดาห์ ค่อยดูว่าที่ขาดจริง ๆ คือ "หลายรูป" (เฟส 2) หรือ "รูปตอนรับของ" (เฟส 3) — อย่าทำพร้อมกันทั้งสองเพราะทั้งคู่แตะ schema
