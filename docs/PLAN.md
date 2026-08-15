# TMS — Transport Management System (ระบบบริหารจัดการขนส่ง)

## 1. วิสัยทัศน์

ระบบ TMS แบบครบวงจรสำหรับบริษัทขนส่งที่มีรถเป็นของตัวเอง (private fleet carrier)
ครอบคลุมตั้งแต่รับออเดอร์ → วางแผนจัดคิว → มอบหมายรถ/คนขับ → ติดตามสถานะ → รายงานผล

**หลักการออกแบบ**
- ใช้งานง่าย เรียนรู้ได้ใน 5 นาที ไม่ต้องอบรม
- ลื่นไหล มี animation เพื่อ UX ที่ดี แต่ใช้ CSS เท่านั้น (ประหยัดทรัพยากร)
- รันได้บนเครื่องเก่า (2016 ขึ้นไป): bundle เล็ก, ใช้ GPU-friendly animation (transform/opacity)
- Backend สะอาด เป็นชั้น (layered) ทดสอบได้
- **หน้าจอต้องเงียบ** — ถ้าจะเพิ่มอะไร ต้องลดอะไรออก · คำอธิบายอยู่ติดของที่มันอธิบาย ไม่ตั้งเป็นย่อหน้าแยก · สี = สถานะเท่านั้น
- **UI ภาษาไทยเป็นหลัก** — กติกาตัวอักษรไทยอยู่ใน §6 (ห้าม uppercase / ห้าม tracking ติดลบ)

## 2. ขอบเขตฟีเจอร์ (MVP ครบวงจร)

| โมดูล | ฟีเจอร์ |
|---|---|
| **ภาพรวม (Dashboard)** | รายได้เดือนนี้ (hero) · แถบเมตริก 3 ตัว: ออเดอร์วันนี้ / กำลังขนส่ง / ส่งสำเร็จเดือนนี้ (พร้อมเทียบ 7 วันก่อน) · **AI สรุปประจำวัน** + แนะนำการกระทำถัดไป · กราฟรายได้ 30 วัน · สัดส่วนสถานะ · ออเดอร์ล่าสุด · ความพร้อมรถ/คนขับ |
| **แผนงานขนส่ง (Dispatch)** | สร้างเที่ยวขนส่ง (Trip) = รถ + คนขับ + ออเดอร์หลายใบ · เช็คความจุรถ/ความพร้อมคนขับ · เริ่ม/เสร็จ/ยกเลิกเที่ยว · เปลี่ยนสถานะออเดอร์อัตโนมัติ |
| **ออเดอร์ (Orders)** | CRUD · สถานะ: รอจัดคิว → จัดคิวแล้ว → กำลังขนส่ง → ส่งสำเร็จ / ยกเลิก · ลำดับความสำคัญ (ด่วน/ปกติ) · ค้นหา/กรอง · ยกเลิกออเดอร์ |
| **รถ (Vehicles)** | CRUD · ประเภท: กระบะ, 6 ล้อ, 10 ล้อ, ห้องเย็น · ความจุ (กก.) · สถานะ: ว่าง / กำลังขนส่ง / ซ่อมบำรุง / ไม่ใช้งาน |
| **พนักงานขับ (Drivers)** | CRUD · เบอร์โทร · เลขใบขับขี่ · สถานะ: ว่าง / กำลังขนส่ง / หยุดงาน |
| **ลูกค้า (Customers)** | CRUD · ชื่อ/ผู้ติดต่อ/เบอร์/ที่อยู่ · **กลุ่มลูกค้า (VIP/A/B/C), เลขภาษี, เครดิต, แท็ก, เงื่อนไขราคา** |
| **ใบเสนอราคา (Quotes)** | CRUD + สถานะ: ร่าง → ส่งแล้ว → ตกลงราคา/ปัดตก/หมดอายุ · **แปลงเป็นออเดอร์** (1 quote = 1 ออเดอร์, transaction เดียว) |
| **CRM (ลูกค้าสัมพันธ์)** | โปรไฟล์ลูกค้าเต็ม (tabs: ออเดอร์ / ใบเสนอราคา / การติดต่อ / งานติดตาม) · บันทึกการติดต่อ · งานติดตาม (ครบกำหนด/ค้าง/เสร็จ) |
| **รายงาน (Reports)** | ตัวกรองช่วงวันที่ · ออเดอร์ต่อสถานะ · รายได้/ค่าใช้จ่าย/กำไร · เวลาส่งเฉลี่ย · ประสิทธิภาพคนขับ (เที่ยว, อัตราตรงเวลา) · ลูกค้าอันดับสูงสุด · กราฟ SVG · **CRM analytics: อัตราแปลง quote, ลูกค้าใหม่ vs ซ้ำ, ลูกค้าเสี่ยง (เงียบ 30+ วัน), มูลค่าลูกค้า** |
| **บัญชีผู้ใช้ (Auth)** | ล็อกอิน JWT · บทบาท: admin / dispatcher / viewer · ตั้งค่า org (ชื่อบริษัท, สกุลเงิน) |
| **POD (หลักฐานการส่งมอบ)** | เก็บ POD ต่อออเดอร์ที่ส่งสำเร็จ: ลายเซ็นอิเล็กทรอนิกส์ (canvas), รูปถ่ายหลักฐาน, ตำแหน่ง GPS (ถ้าอนุญาต), หมายเหตุ, ผู้รับ · สถานะ: เก็บแล้ว → ยืนยันแล้ว · แก้ไขได้จนกว่าจะยืนยัน |
| **เอกสาร / ส่งออก** | ใบนำส่ง BOL (โมดัล A4 + พิมพ์) · รายงาน Excel `.xlsx` 9 ชีต (เขียนเองไร้ dependency) · พิมพ์ PDF ผ่าน `window.print()` + print CSS · เทมเพลตเอกสารเปล่าใน `server/data/templates/` |
| **ข้อมูล CSV** | DB = แหล่งความจริงเดียว จัดการผ่านเว็บเท่านั้น · ระบบ export ทิศเดียว DB → CSV 9 ไฟล์ ทุก 3 วิเมื่อข้อมูลเปลี่ยน · หน้า `/data` ดูสถานะ + ดาวน์โหลดทีละไฟล์ (whitelist กัน path traversal) |
| **ชุดไฟล์ static** | `npm run static:export` → `web-static/` เปิด `index.html` ใช้ได้โดยไม่ต้องรัน server (สาธิต/พิมพ์/แจก) |

## 3. Domain Model

### สถานะ (State Machine)

```
ออเดอร์ (order):
  pending ──assign──▶ assigned ──trip start──▶ in_transit ──trip complete──▶ delivered
    │                   │                                                  ▲
    └──cancel──▶ cancelled  └──────trip cancel──▶ (กลับไป pending) ──────────┘

เที่ยวขนส่ง (trip):
  planned ──start──▶ in_progress ──complete──▶ completed
      │                 │
      └──cancel──▶ cancelled

รถ (vehicle):  available ⇄ on_trip  /  maintenance  /  inactive
คนขับ (driver): available ⇄ on_trip  /  off_duty
```

### กฎธุรกิจ (Business Rules)
1. จัดออเดอร์เข้าทริปได้เฉพาะออเดอร์ `pending` เท่านั้น
2. รถ/คนขับต้องมีสถานะ `available` ถึงจะถูกจัดลงทริปได้ และห้ามซ้ำในทริปที่ยังไม่เสร็จ 2 ทริปพร้อมกัน
3. รวมน้ำหนักสินค้าในทริปต้องไม่เกิน `capacity_kg` ของรถ (แจ้งเตือนแต่บังคับไม่ได้ถ้าเกิน — ผู้วางแผนยืนยันได้)
4. `trip start` → ออเดอร์ในทริปทั้งหมดเป็น `in_transit`, รถ/คนขับเป็น `on_trip`
5. `trip complete` → ออเดอร์เป็น `delivered` (บันทึก delivered_at), รถ/คนขับกลับเป็น `available`
6. `trip cancel` → ออเดอร์กลับเป็น `pending`, รถ/คนขับกลับเป็น `available`
7. ยกเลิกออเดอร์ได้เฉพาะ `pending`/`assigned`; ถ้าอยู่ในทริปที่เริ่มแล้วจะถูกบล็อก
8. ลบ master data (ลูกค้า/รถ/คนขับ) เฉพาะเมื่อไม่มีข้อมูลอ้างอิง (ออเดอร์/ทริป) — ใช้ soft delete โดยเปลี่ยนสถานะเป็น inactive แทน

### ตารางข้อมูล (SQLite)
**11 ตาราง** (ดูของจริงที่ `server/src/db/schema.ts` — versioned migration ผ่าน `PRAGMA user_version`)

*แกนขนส่ง*
- `users` (id, username, password_hash, name, role, created_at)
- `settings` (key, value) — org_name, currency
- `customers` (id, name, contact_person, phone, email, address, **segment, tax_id, credit_days, tags, price_terms**, created_at)
- `vehicles` (id, plate_no, brand, model, vehicle_type, capacity_kg, status, created_at)
- `drivers` (id, name, phone, license_no, license_type, status, joined_at, created_at)
- `orders` (id, order_no, customer_id, origin, destination, distance_km, goods_desc, weight_kg, fee, status, priority, scheduled_at, delivered_at, notes, trip_id NULL, created_at, updated_at)
- `trips` (id, trip_no, vehicle_id, driver_id, status, departed_at, arrived_at, fuel_cost, toll_cost, other_cost, notes, created_at)
- `pod` (id, order_id UNIQUE, recipient_name, signature_data, photo_path, notes, status, lat, lng, collected_by, collected_at, updated_at)

*แกน CRM / การขาย*
- `quotes` (id, quote_no, customer_id, origin, destination, distance_km, goods_desc, weight_kg, fee, status, valid_until, converted_order_id NULL, notes, created_at, updated_at)
- `customer_interactions` (id, customer_id, kind, summary, occurred_at, created_by, created_at) — บันทึกการติดต่อ
- `customer_tasks` (id, customer_id, title, due_date, status, created_by, created_at) — งานติดตาม

ทริป 1 ใบสามารถบรรทุกได้หลายออเดอร์ (`orders.trip_id` — many-to-one) · POD 1 ใบต่อ 1 ออเดอร์ที่ส่งสำเร็จ (`pod.order_id` unique) · ใบเสนอราคา 1 ใบแปลงเป็นออเดอร์ได้ครั้งเดียว (`quotes.converted_order_id`)

### โมดูล POD (Proof of Delivery)

**อะไรคือ POD**: หลักฐานยืนยันว่าสินค้าส่งถึงผู้รับจริง — ลายเซ็นผู้รับ + รูปถ่ายหลักฐาน + เวลาที่บันทึก ใช้ระงับข้อพิพาทและตรวจสอบคุณภาพงานขนส่ง

**ข้อมูลที่เก็บ** (ต่อออเดอร์ที่ส่งสำเร็จ):
1. ชื่อผู้รับ (required)
2. ลายเซ็นอิเล็กทรอนิกส์ — วาดด้วยมือ/เมาส์บน canvas → PNG data URL (required)
3. รูปถ่ายหลักฐาน (สินค้าที่ส่ง/ใบรับสินค้า) — อัปโหลดไฟล์ เก็บที่ `server/data/pod/` (optional)
4. ตำแหน่ง GPS ของผู้บันทึก (จากเบราว์เซอร์ ถ้าผู้ใช้ยินยอม) (optional)
5. หมายเหตุ (optional) · บันทึกโดยใคร + เมื่อไหร่ (server บันทึกอัตโนมัติ)

**กฎธุรกิจ:**
1. เก็บ POD ได้เฉพาะออเดอร์สถานะ `delivered` เท่านั้น
2. 1 ออเดอร์มี POD ได้ 1 ใบ (order_id UNIQUE)
3. สถานะ: `collected` (เก็บแล้ว) → `verified` (ยืนยันแล้วโดย admin/dispatcher)
4. แก้ไข POD ได้เฉพาะสถานะ `collected`; เมื่อยืนยันแล้วจะล็อก (หลักฐานชัดเจน ไม่แก้ย้อนหลัง)
5. รูปหลักฐานเปิดดูได้เฉพาะผู้ที่ล็อกอิน (เสิร์ฟผ่าน endpoint ที่ต้องใช้ JWT) — ไม่อยู่ในโฟลเดอร์สาธารณะ
6. ยืนยัน POD ได้โดย admin / dispatcher (viewer ไม่ได้)

## 4. สถาปัตยกรรม Backend

```
server/
  src/
    index.ts          ← entry point (HTTP server)
    app.ts            ← Express app + middleware wiring
    config.ts         ← env config
    db/
      connection.ts   ← better-sqlite3 (single connection, synchronous, fast)
      migrate.ts      ← schema versioning (PRAGMA user_version)
      seed.ts         ← ข้อมูลตัวอย่างภาษาไทย
    core/
      errors.ts       ← AppError + HTTP mapping
      constants.ts    ← status enums
    modules/          ← 13 โมดูล แต่ละโมดูลแยก 4 ชั้น
      auth · customers · vehicles · drivers · orders · trips · pod ·
      quotes · dashboard · insights · reports · csv · settings
      <module>/
        route.ts      ← กำหนด path + ต่อ middleware (validation, auth)
        controller.ts ← แปลง HTTP ⇄ service (ไม่เขียน logic)
        service.ts    ← กฎธุรกิจ (business rules)
        repository.ts ← SQL เท่านั้น (data access)
    middleware/
      auth.ts         ← JWT verify + role check
      validate.ts     ← Zod schema validation
      errorHandler.ts ← จัดการ error กลาง → JSON { error: { code, message } }
    utils/            ← id, date, money helpers
```

**ทางเลือกสแตก** — เหตุผล:
- **Node.js + Express 5 + TypeScript**: น้ำหนักเบา, รู้จักกันแพร่หลาย, TS ให้ความปลอดภัยของชนิดข้อมูล
- **better-sqlite3**: synchronous API → โค้ดง่าย, ไม่ต้อง async/await ยุ่ง, เร็วมาก; ไฟล์เดียวพกพาได้ ไม่ต้องติดตั้ง DB server
- **Zod**: validate payload ที่ boundary ทั้งหมด (single source of truth ของ schema)
- **JWT + bcryptjs**: auth มาตรฐาน, bcryptjs เป็น pure JS ไม่ต้อง compile native

## 5. สถาปัตยกรรม Frontend

```
web/
  src/
    main.tsx / App.tsx      ← Router + providers
    api/client.ts           ← fetch wrapper + error handling + token
    context/                ← AuthContext, ToastContext
    hooks/                  ← useApi, useCountUp, useDebounce
    components/             ← Layout, ui.tsx (Button/Badge/Field/Modal/Table/Toast/
                              ConfirmDialog/Skeleton/EmptyState/Pagination/HelpTip/
                              StatCard), charts.tsx (SVG), icons.tsx,
                              BolModal, PodModal, SignaturePad
    pages/                  ← Login, Dashboard, Dispatch, Orders, Quotes, Customers,
                              CustomerDetail, Vehicles, Drivers, Reports, Data,
                              Settings, NotFound   (lazy-loaded ทุกหน้า)
    a11y/                   ← axe-core tests (design system · Login · Dashboard)
    styles/                 ← tokens.css, base.css, components.css, animations.css
    utils/                  ← format (date/currency/weight/route), constants
```

- **React 19 + Vite**: bundle ~110KB gzip, dev server เร็ว
- **Router**: react-router-dom (lazy routes → แยก chunk)
- **ไม่ใช้ UI framework หนัก** (MUI/AntD) — สร้าง design system เอง ควบคุมขนาดและ animation ได้เต็มที่
- **Charts**: SVG เขียนเอง (ไม่ใช้ chart lib) → bundle เล็ก, สวย, animate ได้
- **ไม่ใช้ animation library** (framer-motion ฯลฯ) — ใช้ CSS transition/keyframe บน transform+opacity เท่านั้น (GPU-accelerated, ไม่ jank บนเครื่องเก่า)

## 6. UX / UI Spec — ธีม Aurora v5

> ประวัติธีม: v3 "Soft & Calm" (ครีม + อำพัน + serif display) → **v5 "Aurora"** (ขาวอมม่วง +
> periwinkle/violet/rose + sans ล้วน) คือธีมที่ใช้อยู่จริง · รายละเอียดรอบปรับที่ `ROADMAP-2026.md` §3.5–3.6

### Design Tokens — 3 ชั้น (ดู `web/src/styles/tokens.css`)
```css
/* Layer 1 · GLOBAL — ค่าดิบ */
--violet-600: #6b52ad;   --blue-500: #6c7be8;    --rose-500: #e8829f;
--paper: #faf9fd;        --surface: #ffffff;      --ink: #241f33;
--dur-2: 180ms;          --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

/* Layer 2 · SEMANTIC — บทบาท */
--bg: var(--paper);      --accent: var(--violet-600);
--muted: #706a86;        --faint: #6f6a85;        /* ผ่าน WCAG AA */
--motion-base: var(--dur-2);  --ease-enter: var(--ease-out);
--focus-ring: var(--violet-500);   /* 4.1:1 — ผ่าน 1.4.11 non-text contrast */

/* Layer 3 · COMPONENT — ต่อคอมโพเนนต์ */
--btn-accent-bg: var(--violet-600);   --card-border: rgba(44,33,80,.09);
--table-head: var(--faint);           --sidebar-bg: var(--surface);
```

- **Typography**: IBM Plex Sans Thai ตัวเดียวทั้งระบบ — ลำดับชั้นมาจาก **น้ำหนัก + ขนาด + สี** ไม่ใช่การสลับตระกูลฟอนต์ (Aurora ไม่ใช้ serif) · โหลดผ่าน Google Fonts (`display=swap`)
- **กติกาตัวอักษรไทย (บังคับ)**
  1. ห้าม `text-transform: uppercase` บนป้ายที่มีข้อความไทย — ไทยไม่มีตัวพิมพ์ใหญ่ ได้แต่ tracking ที่ผลักสระ/วรรณยุกต์ออกจากพยัญชนะ
  2. ห้าม `letter-spacing` ติดลบบนข้อความไทย — สระบน/ล่างจะชนตัวข้างเคียง (ตัวเลขล้วนใช้ได้)
  3. `line-height` หัวข้อไทย ≥ 1.35 ให้รูปสระมีที่หายใจ
- **Radius**: ไล่ตามขนาดชิ้นงาน — ปุ่ม/ฟิลด์ 12 · การ์ด 16 · โมดัล 22 · แผงใหญ่ 26 · ป้าย pill 999 · spacing 4px grid
- **Gradient**: มีโควตา **4 จุดทั้งระบบ** (โลโก้ sidebar · avatar · โลโก้หน้าล็อกอิน · เมนูที่เลือกอยู่) — ที่เหลือใช้สีทึบ
- **WCAG 2.2 AA**: คอนทราสต์ทุกคู่สีตรวจด้วย `node web/scripts/contrast.mjs` (**26/26 ผ่าน** รวมเกณฑ์ 3:1 ของ focus ring/ขอบฟิลด์) — แก้ที่ token ชั้นเดียวทั้งระบบ

### Layout
- Sidebar ซ้าย **268px** พื้นขาวอมม่วง + Topbar **68px** (วันที่, ผู้ใช้, logout)
- Content max-width 1560px, padding 32px/40px, จัดเรียงแบบ grid, card-based
- Responsive: < 1100px grid ยุบเหลือคอลัมน์เดียว, < 900px sidebar กลายเป็น drawer + ปุ่ม burger, < 560px KPI เรียงเดี่ยว

### กติกาตาราง (กันหน้าจอรก — ดู ROADMAP §3.6)
| กฎ | เหตุผล |
|---|---|
| คอลัมน์ ≤ 8 | เกินนั้นเซลล์แคบจนข้อความแตกบรรทัด — ข้อมูลรองให้ลงบรรทัดที่สองของเซลล์หลักแทน |
| เลขที่เอกสาร/วันที่/จำนวนเงิน = `nowrap` | `.cell-no` `.cell-date` `.num` — เดิม `ORD-2026-0069` แตก 3 บรรทัด |
| หัวการ์ดกับคำอธิบายคนละบรรทัด | `.card-subtitle { flex-basis: 100% }` — เดิมแย่งพื้นที่จนคำไทยแตกกลางคำ |
| ปุ่มท้ายแถวห่อบรรทัด ไม่ล้น | `.table .actions { flex-wrap: wrap }` |
| ป้ายสถานะแสดงเฉพาะตอนผิดปกติ | "ปกติ" ไม่ต้องบอก — ประหยัดได้ทั้งคอลัมน์ |

### Motion (CSS-only, GPU)
| จุด | Animation |
|---|---|
| สลับหน้า | fade + translateY 12px → 0 (240ms ease-out) |
| Card hover | translateY(-1px) + shadow เพิ่ม (180ms) — เฉพาะการ์ดที่คลิกได้ (`.card-hover`) |
| Modal | scale 0.96→1 + fade (200ms) |
| Toast | slide-in จากขวา (240ms) + auto dismiss |
| KPI ตัวเลข | count-up (requestAnimationFrame, ~800ms) |
| Badge กำลังขนส่ง | dot กระพริบ (keyframes opacity) |
| Skeleton | shimmer ไล่เฉด (background-position) |
| Sidebar active | indicator bar เลื่อน + background fade |
| Button | hover lift **เฉพาะปุ่มสั่งการหลัก** (primary/accent/danger/success) — ปุ่มไอคอนในแถวตารางไม่ยก ไม่งั้นเลื่อนเมาส์ผ่านแล้วเด้งทั้งแถว · active scale(0.98) · focus ring 3px ทึบ |
| Chart | bar เติบโตความสูง / line วาดเส้น (stroke-dashoffset) |
| Table row | hover background, เพิ่มแถวใหม่ highlight flash |

**ข้อควรระวัง performance** — `prefers-reduced-motion: reduce` ปิด animation ทั้งหมด; ใช้ `will-change` เฉพาะจุดจำเป็น; หลีกเลี่ยง box-shadow/blur animation บ่อยๆ

## 7. API Design

- รูปแบบ: `GET/POST/PUT/PATCH/DELETE /api/...`
- Response: `{ data }` / `{ data, meta }` (pagination) / `{ error: { code, message } }`
- Auth: `Authorization: Bearer <jwt>`; บทบาท admin = จัดการทุกอย่าง, dispatcher = วางแผน+แก้ไขออเดอร์, viewer = อ่านอย่างเดียว
- Pagination: `?page=&limit=` (default 20) + `?q=&status=&from=&to=`
- Endpoints หลัก: `/auth/login` · `/customers` (+ `/:id` โปรไฟล์เต็ม, `/interactions`, `/tasks`) · `/vehicles` · `/drivers` · `/orders` (+ `/:id/bol` ใบนำส่ง, `/pending-unassigned`) · `/trips` (+ `/board`, `/:id/start|complete|cancel|orders`) · `/quotes` (+ `/:id/convert`) · `/pod` · `/dashboard/summary` · `/insights/daily` (AI สรุปประจำวัน) · `/reports` (+ `/export` → .xlsx) · `/csv/status` · `/csv/download/:file` · `/settings`

## 8. กลยุทธ์รองรับเครื่องเก่า (2016+)

| ปัจจัย | มาตรการ |
|---|---|
| CPU/RAM ต่ำ | bundle ~110KB gzip (code-split ตาม route), CSS animation แทน JS |
| การ์ดจอไม่แรง | animate เฉพาะ transform/opacity, ไม่ใช้ blur/box-shadow บ่อย |
| ดิสก์ช้า | lazy load images (ไม่มีภาพหนัก), ใช้ cache headers |
| เบราว์เซอร์เก่า | ไม่ใช้ฟีเจอร์ bleeding-edge JS (รองรับ ES2020+), autoprefix CSS |

## 9. การทดสอบ

| ชุด | คำสั่ง | ครอบคลุม | สถานะ |
|---|---|---|---|
| Type safety | `npm run typecheck` | server + web | 0 error |
| Unit — กฎธุรกิจ | `npm test -w server` | order/trip state machine, capacity, POD, quotes, CRM, CSV export layer, BOL, xlsx writer | **51/51** |
| A11y — axe-core | `npm run test:a11y` | design system ทั้งชุด + หน้า Login + Dashboard บน DOM จริง (WCAG 2 A/AA + best-practice) | **4/4** |
| Contrast | `node web/scripts/contrast.mjs` | ทุกคู่สีใน token + focus ring + ขอบฟิลด์ผิดพลาด | **26/26** |
| Production build | `npm run build` | web + server | ผ่าน |
| Manual E2E | เบราว์เซอร์ | สร้างออเดอร์ → จัดทริป → เริ่ม → เสร็จ → เก็บ POD → ดูรายงาน → พิมพ์ BOL/PDF → ส่งออก Excel | — |

CI (GitHub Actions, `.github/workflows/ci.yml`) รันทั้งหมดทุก push/PR

> axe-core จับบั๊กจริงมาแล้ว: label ไม่ผูก input, dialog ไร้ชื่อ, กราฟ `role="img"` ไร้คำอธิบาย, heading ข้ามระดับ

## 10. Roadmap

1. ✅ วางแผน + scaffold
2. ✅ Backend ครบ (schema, seed, 13 โมดูล)
3. ✅ Frontend ครบ (design system, 13 หน้า, animation)
4. ✅ ทดสอบ + polish + docs
5. ✅ CRM (ใบเสนอราคา → ออเดอร์, โปรไฟล์ลูกค้า, การติดต่อ, งานติดตาม)
6. ✅ POD (ลายเซ็น/รูป/GPS) · BOL · export Excel/PDF · CSV export layer · ชุดไฟล์ static
7. ✅ ธีม Aurora v5 + รอบ audit/ลดความรก (ROADMAP §3.5–3.6)
8. 🔜 ค้นหาทั่วระบบ Ctrl+K · driver app มือถือ · GPS real-time · multi-stop routing · LINE Notify/webhook
