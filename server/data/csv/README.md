# 📁 ไฟล์ CSV — ไฟล์ส่งออก (export) ของระบบ

ไฟล์ในโฟลเดอร์นี้คือ **ข้อมูลส่งออกจากระบบ** — เปิดด้วย Excel / โปรแกรมตารางคำนวณได้ (มี BOM + CRLF → ภาษาไทยแสดงถูกต้อง)

## ⚙️ หลักการทำงาน

| หัวข้อ | คำตอบ |
|---|---|
| **ข้อมูลจริงอยู่ที่ไหน?** | ฐานข้อมูล `server/data/tms.db` — แหล่งเดียวของความจริง |
| **ใครเป็นคนจัดการข้อมูล?** | **หน้าเว็บเท่านั้น** (ออเดอร์/เที่ยว/รถ/ลูกค้า/CRM...) |
| **ไฟล์ CSV คืออะไร?** | สำเนาส่งออกของข้อมูลปัจจุบัน — อัปเดตอัตโนมัติทุกครั้งที่ข้อมูลเปลี่ยน (ทุก 3 วินาที) |
| **แก้ไฟล์ CSV ตรง ๆ ได้ไหม?** | ❌ **ไม่** — ระบบจะเขียนทับกลับด้วยข้อมูลจริงจากฐานข้อมูลภายในไม่กี่วินาที ถ้าต้องการแก้ข้อมูลให้แก้ที่หน้าเว็บ |
| **นำไฟล์ไปใช้ทำอะไรได้?** | เปิด/วิเคราะห์ใน Excel, ส่งให้ทีมบัญชี, นำเข้า BI tool, เก็บเป็น snapshot รายวัน |

## 📄 แต่ละไฟล์ใช้กับอะไร

| ไฟล์ | ใช้กับ | คอลัมน์สำคัญ |
|---|---|---|
| `01_customers.csv` | **ลูกค้า** | name, contact_person, phone, segment (VIP/A/B/C), tax_id, credit_terms, tags, price_note |
| `02_vehicles.csv` | **รถยนต์** | plate_no, brand, vehicle_type, capacity_kg, status |
| `03_drivers.csv` | **พนักงานขับ** | name, phone, license_no, license_type, status, joined_at |
| `04_trips.csv` | **เที่ยวขนส่ง** | trip_no, vehicle_id, driver_id, status, departed_at, arrived_at, fuel_cost, toll_cost |
| `05_orders.csv` | **ออเดอร์** | order_no, customer_id, origin, destination, distance_km, goods_desc, weight_kg, fee, status, priority, scheduled_at, trip_id |
| `06_pod.csv` | **หลักฐาน POD** | order_id, recipient_name, signature_data, status, lat, lng, collected_by, collected_at |
| `07_quotes.csv` | **ใบเสนอราคา** (CRM) | quote_no, customer_id, origin, destination, weight_kg, fee, status, valid_until, converted_order_id |
| `08_interactions.csv` | **ประวัติติดต่อ** (CRM) | customer_id, type, subject, note, happened_at |
| `09_tasks.csv` | **งานติดตาม** (CRM) | customer_id, title, due_at, status, note |

## 🔗 ความสัมพันธ์ระหว่างไฟล์ (อ่านข้อมูลอ้างอิงได้จาก id)

```
01_customers  ◄── 05_orders.customer_id    04_trips.vehicle_id ──► 02_vehicles
                ◄── 07_quotes.customer_id   04_trips.driver_id  ──► 03_drivers
                ◄── 08_interactions         05_orders.trip_id   ──► 04_trips
                ◄── 09_tasks                06_pod.order_id     ──► 05_orders
```

> ℹ️ ไม่มีไฟล์ users/settings — บัญชีผู้ใช้ รหัสผ่าน และการตั้งค่าระบบไม่ใช่ข้อมูลธุรกิจ จึงไม่ออกเป็นไฟล์

## 🛠 วิธีใช้

- **ดาวน์โหลดจากเว็บ:** หน้า "ข้อมูล CSV" → กดปุ่ม ⬇ ข้างไฟล์ที่ต้องการ
- **หาไฟล์บนเครื่อง:** เปิดโฟลเดอร์ `server/data/csv/` — ไฟล์ใหม่จะมาเองเมื่อข้อมูลเปลี่ยน
- **อยากได้ข้อมูลสด:** กดปุ่ม "เขียนไฟล์ใหม่จากข้อมูลล่าสุด" บนหน้า "ข้อมูล CSV" (ปกติระบบทำอัตโนมัติอยู่แล้ว)
