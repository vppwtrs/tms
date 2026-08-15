# Supabase — schema และ RLS

ร่างสำหรับย้าย backend จาก Express + SQLite ไปเป็น Postgres + RLS บน Supabase
โดยที่ SPA ต่อตรงเข้า Supabase ไม่มี Node server อยู่ตรงกลางอีกต่อไป

## ลำดับการรัน

```
0001_schema.sql       ตาราง แปลงจาก server/src/db/schema.ts
0002_permissions.sql  ย้าย ROLE_PRESET จากโค้ดมาเป็นข้อมูล + ฟังก์ชันที่ policy เรียกใช้
0003_rls.sql          policy ทุกตาราง
0004_driver_api.sql   view และฟังก์ชันฝั่งคนขับ
0005_storage.sql      ถังเก็บรูป POD + policy ของถัง
```

ต้องรันตามลำดับ ไฟล์หลังอ้างถึงของในไฟล์หน้า
`all.sql` คือทั้งหมดรวมกัน สำหรับวางใน SQL Editor ทีเดียว (สร้างด้วย `cat migrations/*.sql > all.sql`)

## ของอื่นที่ประกอบกันเป็นระบบ

| ที่อยู่ | ทำอะไร |
|---|---|
| `supabase/functions/tms-sync/` | Edge Function ล็อกอิน TMS บริษัท แล้ว upsert ลง `tms_shipments` |
| `web/src/api/supabase.ts` | ตัวเชื่อม + แปลง error ของ Postgres เป็นข้อความไทย |
| `web/src/api/auth.ts` | ล็อกอิน/โปรไฟล์/สิทธิ์ แทน `modules/auth` |
| `web/src/api/myjobs.ts` | ฝั่งคนขับ ยิงผ่าน view และ RPC เท่านั้น |
| `web/src/api/storage.ts` | อัปโหลด/อ่านรูป POD ผ่าน signed URL |
| `web/src/types/database.ts` | ชนิดข้อมูลของตาราง เขียนมือ ต้องแก้ตามเมื่อ migration เปลี่ยน |
| `.github/workflows/deploy-pages.yml` | build แล้ว deploy ขึ้น GitHub Pages |

## แนวคิดที่ต้องเข้าใจก่อนแก้ไฟล์พวกนี้

**ด่านตรวจสิทธิ์มีที่เดียวคือ RLS** ของเดิม Express เป็นกำแพง client ยิง DB ตรงไม่ได้
ของใหม่ SPA ถือ anon key ที่เปิดเผยอยู่ในหน้าเว็บ ใครก็ยิง PostgREST ตรงได้
ตารางไหนลืม `enable row level security` คือเปิดสาธารณะทันที ไม่มีอะไรกันอีกชั้น

**ไม่มี policy = ปฏิเสธ** ไม่ใช่ปล่อยผ่าน คนขับจึงถูกกันออกจาก `orders` / `trips` เอง
โดยไม่ต้องเขียนกฎห้าม เพราะเขาไม่มีสิทธิ์ `orders.view` ตั้งแต่ต้น

**RLS กันคอลัมน์ไม่ได้** กันได้แค่ว่าแถวไหนเห็นได้ นี่คือเหตุผลที่คนขับอ่านผ่าน
`my_trips` / `my_orders` แทนตารางจริง — เพราะ `trips` มี `fuel_cost` / `toll_cost` /
`other_cost` และ `orders` มี `fee` ให้ policy select ไปเมื่อไหร่ คนขับเลือกคอลัมน์เองได้ทันที
กฎเดิมของโปรเจ็ค "ห้ามให้ตัวเลขเงินโผล่ในหน้าคนขับ" ยังอยู่ แค่เปลี่ยนวิธีบังคับ

**การกระทำของคนขับเป็นฟังก์ชัน ไม่ใช่ update ตรง** `complete_trip()` เหมาออเดอร์ที่เหลือ
เป็น delivered ให้หมด ถ้าปล่อยให้หน้าจอยิง update เอง คนขับปิดงานที่ยังไม่ได้ส่งได้ทั้งเที่ยว
ปุ่มที่ disable ไว้กันคนที่ยิง API ตรงไม่ได้ กฎจริงต้องอยู่ใน DB

## สิ่งที่ยังไม่ได้ทำ

- **ยังไม่ได้รันจริง** เครื่องนี้ไม่มี psql / docker / supabase CLI ไฟล์พวกนี้ตรวจด้วยสายตาอย่างเดียว
  ต้องเอาขึ้น Supabase แล้วรันจริงก่อนเชื่อ
- สคริปต์ย้ายข้อมูลจาก SQLite เดิมเข้า Postgres
- การผูกผู้ใช้เดิมเข้ากับ `auth.users` (คอลัมน์ `auth_id` ยังว่าง ผู้ใช้ที่ `auth_id` เป็น null ล็อกอินไม่ได้)
- **หน้าจอยังเรียก `web/src/api/client.ts` ตัวเดิมอยู่** — ตัวเชื่อม Supabase สร้างไว้ครบแล้ว
  แต่ยังไม่ได้สลับให้ `pages/` มาใช้ ทำแบบนี้ตั้งใจ: ของเดิมยังรันได้ปกติระหว่างที่ย้ายทีละหน้า
- โมดูลออฟฟิศ (orders, trips, customers, vehicles, quotes, reports) ยังไม่มีตัวเชื่อมฝั่ง Supabase
- เทส RLS — ควรมีชุดเทสที่ล็อกอินเป็น driver จริงแล้วยืนยันว่า `select * from orders` ได้ 0 แถว

## กับดักที่เจอแล้วและเลี่ยงไว้

**ห้าม `force row level security` บนตาราง `users`** ฟังก์ชัน `app.current_user_id()` เป็น
security definer ที่อ่าน `users` — เจ้าของตารางได้รับยกเว้น RLS อยู่ ถึงไม่เกิดวงวน
ถ้าเปิด force เมื่อไหร่ policy จะเรียกฟังก์ชัน ฟังก์ชันไปอ่าน users แล้วโดน policy ตัวเดิมอีก วนไม่จบ

**ทุกฟังก์ชัน security definer ล็อก `search_path`** ถ้าไม่ล็อก คนสร้างตารางชื่อซ้ำใน schema
ตัวเองแล้วหลอกให้ฟังก์ชันไปอ่านของปลอมได้

**`revoke all ... from anon` ครอบเฉพาะตารางที่มีอยู่ตอนรัน** ตารางที่สร้างทีหลังต้อง revoke เอง
หรือแก้ default privileges

## service_role ข้าม RLS ทั้งหมด

key ตัวนี้ไม่สนใจ policy ในไฟล์ `0003` เลยแม้แต่บรรทัดเดียว มีไว้ให้ Edge Function
กับสคริปต์ sync ใช้เท่านั้น **ห้ามอยู่ใน frontend หรือใน repo เด็ดขาด**
