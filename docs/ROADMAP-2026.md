# 🗺️ แผนพัฒนาขั้นสูง TMS 2026 — อ้างอิงโมเดลบริษัทระดับโลก

> ศึกษาจาก: Onething "12 Best Design System Examples 2026" (Atlassian / Adobe Spectrum 2 / Material 3 / Apple HIG / Porsche / Uber Base), UX Collective "Experience Design Trends 2026", SaaSUI "7 SaaS UI Trends 2026", Muzli "7 tiny fixes", AdminLTE 2026 (Linear/Stripe/Vercel/Attio)

## 0. อ่านตรงไหนก่อน

| อยากรู้ | ไปที่ |
|---|---|
| ธีมที่ใช้อยู่ตอนนี้คืออะไร | **§3 Phase 1** — คำตอบ: **Aurora v5** (ไม่ใช่ Soft & Calm v3 ที่เขียนไว้ใน §2 ซึ่งเป็นประวัติ) |
| ทำไมโค้ดถึงห้าม uppercase ภาษาไทย / ห้าม tracking ติดลบ | **§3.5** (รอบ audit) |
| ทำไมตารางถึงมีเพดาน 8 คอลัมน์ / ทำไมไม่มีย่อหน้าอธิบายใต้กราฟ | **§3.6** (รอบลดความรก) |
| สเปกปัจจุบันของ token / layout / ตาราง | [PLAN.md §6](PLAN.md) |
| อะไรยังไม่ทำ | **§3 Phase 2–4** ที่ยังเป็น `[ ]` |

> ⚠️ **§1–§2.6 เป็นบันทึกการศึกษาและรอบทำงานในอดีต** — ตัวเลข/ชื่อธีมในนั้นอาจไม่ตรงกับโค้ดปัจจุบัน
> ของจริงที่ใช้อยู่ให้ยึด §3 เป็นต้นไป และ `web/src/styles/tokens.css`

## 1. โมเดลที่บริษัทระดับโลกใช้ใน 2026

| บริษัท / ระบบ | โมเดลหลัก | สิ่งที่เอามาใช้กับ TMS |
|---|---|---|
| **Atlassian** | Design token 3 ชั้น: global → semantic → component | แยก token ให้ชัดเป็นชั้น (ปัจจุบันรวมอยู่ชั้นเดียว) |
| **Adobe Spectrum 2** | Accessibility-first + adaptive theme + **softer geometry** | พื้นฐานของรอบนี้: มุมมนขึ้น, เงานุ่ม, สีอ่อนลง |
| **Material 3** | Dynamic color (tonal palette → semantic role) + **motion token** (easing/duration มีความหมาย) | ตั้งค่า motion เป็น token ไม่ใช่ค่าแข็ง |
| **Apple HIG** | Liquid Glass: **diffused shadows, layered depth, translucent surface** | sidebar สว่าง + พื้นผิวเป็นชั้น, topbar frosted |
| **Linear / Stripe / Vercel** | Quiet chrome: ขอบ/เงาหดลง, hierarchy จาก type weight, **สี = สถานะ** | ทิศทางที่ทำไปแล้ว — ต่อยอดด้วยตารางเป็นราชา |
| **Attio / Hex (AI-native)** | AI output เป็น first-class surface (สรุป/แนะนำการกระทำ) | roadmap ฟีเจอร์ AI |

## 2. หลักที่ใช้ในรอบ v3 (Soft & Calm — แก้ความ "แข็ง") · 📜 ประวัติ ไม่ใช่ของปัจจุบัน

1. **Sidebar สว่าง** — แทนหมึกดำด้วยพื้นครีมอุ่น (แบบ Notion/Linear light) — จุดที่ลดความรุนแรงได้มากที่สุด
2. **Soften contrast** — หมึก/มัด/ฟินต์ อ่อนลง, สีสถานะ desaturate (เขียวเสจ, เทอราโคตตา, ฮันนี่)
3. **Gentle type** — ลดน้ำหนัก serif (700-800 → 600-650), ลดขนาดตัวเลข KPI เล็กลง ฟังดูนุ่มกว่า
4. **Rounder + softer** — มุมการ์ด 18px, ฟอร์ม 12px, เงา diffused แนวตั้งลงเดียว
5. **Air มากขึ้น** — padding เนื้อหา/การ์ดเพิ่ม (whitespace = ความนุ่ม)

## 2.5 รอบรีดีไซน์ตาม "ปัจจัยเรตติ้ง" (เชิงลึก)
> ศึกษา: Awwwards 40/30/20/10 · Google UX Research (17–50ms first impression: **low visual complexity + high prototypicality** = ความงามที่ผู้ใช้ให้คะแนนสูง) · NN/g aesthetic-usability (สวย → รู้สึกใช้ง่าย ให้คะแนนสูงขึ้น) · Stanford (46% ตัดสินความน่าเชื่อถือจากหน้าตา)

- **ลด visual complexity**: แทน 3 การ์ด KPI → **แถบเมตริกเดียว** (หนึ่งการ์ด แบ่ง 3 คอลัมน์ด้วย hairline แบบ Linear/Stripe) — กล่องลดลง 4→1
- **ตัด nesting**: รายการ AI สรุป จากกล่อง tinted ซ้อนในกล่อง → แถวแบนคั่น hairline + จุดสีบอกโทน (แดง/เหลือง/ฟ้า/เขียว)
- **micro-details**: ตัวเลข count-up, tabular-nums ทุกจุด, hero คำทักทายเป็น serif 22px, page-title 30px, content padding แนวตั้ง 32px/แนวนอน 40px
- **prototypicality**: คง pattern ที่คุ้นเคย (sidebar/ตาราง/pill) — ไม่แปลกเกินหมวด dashboard

## 2.6 Phase 5 — Human-first: "มนุษย์เข้าใจง่าย"
> ศึกษา: NN/g UX writing (plain language — อ่านเข้าใจได้ครั้งแรก, อธิบายคำย่อ) · Towards Data Science "Data Humanization" (ตัวเลขต้องเชื่อมกับคน — แปลงหน่วยเป็นความหมาย) · 14 golden rules (อธิบายศัพท์เฉพาะ) · information scent (ปุ่ม/ลิงก์บอกผลลัพธ์)

### แผน 3 ชุด
- [x] **ชุด A — ข้อมูลที่คนอ่านเข้าใจ**: `fmtWeightHuman` (1,000 กก. → "4.1 ตัน"), `fmtRoute` (380 กม. → "≈ 6 ชม." อัตราเฉลี่ยรถบรรทุก 65 กม./ชม.) — ใช้ในตารางออเดอร์/ใบเสนอราคา
- [x] **ชุด B — อธิบายศัพท์**: คอมโพเนนต์ `HelpTip` (ปุ่ม ? native tooltip + a11y) — ใช้อธิบาย POD (หลักฐานการส่งมอบ) และสถานะใบเสนอราคา
- [x] **ชุด C — ภาษาคน + ผลลัพธ์ชัด**: empty state ออเดอร์บอกขั้นตอนถัดไป (สร้าง → จัดคิว → ส่ง + POD) · confirm ยกเลิกบอกผลลัพธ์ ("จะเปลี่ยนเป็นสถานะยกเลิกทันที ไม่สามารถย้อนกลับได้")
- [ ] ชุด D — เที่ยว: แสดงเวลาโดยประมาณบนการ์ดเที่ยวในแผนงาน · สรุปภาษาไทยธรรมชาติในรายงาน (แทนตัวเลขลอย)
- [x] **ชุด E — คำอธิบายครบทุกหน้า**: รายงาน — ทุกกราฟ/ตารางมี `.section-note` 1 ประโยคบอก "อ่านแล้วทำอะไรต่อ" (แนวโน้ม/สัดส่วน/รายได้/ลูกค้าอันดับ/เส้นทาง/พนักงานขับ/ลูกค้าเสี่ยง/ลูกค้าสร้างรายได้) · ลูกค้า — `HelpTip` อธิบายกลุ่มลูกค้า (VIP/A/B/C) และเครดิต (กี่วันหลังส่งของ)

## 2.7 CSV Export Layer — ข้อมูลจริงที่ DB, ไฟล์เป็น export ✅
> **ตัดสินใจปรับ**: เดิมทำสองทาง (แก้ CSV → เข้าระบบ) → เปลี่ยนตามความต้องการ: **ฐานข้อมูล = แหล่งเดียวของความจริง, จัดการผ่านหน้าเว็บเท่านั้น, CSV = ไฟล์ส่งออก**

- [x] **Export ทิศเดียว DB → CSV** (`server/src/db/csv.ts`): เขียนไฟล์ใหม่เมื่อไฟล์บนดิสก์ไม่ตรงกับข้อมูลใน DB (ครอบคลุมทั้งข้อมูลเปลี่ยน และถูกแก้/ลบจากภายนอก → เขียนทับกลับเป็นข้อมูลจริง) — วนตรวจทุก 3 วิ
- [x] **ไม่รับข้อมูลจากไฟล์กลับเข้า**: แก้/เพิ่มแถวใน CSV ตรง ๆ → ระบบเขียนทับกลับด้วยข้อมูลจาก DB ภายในไม่กี่วินาที (การแก้ข้อมูลต้องทำที่หน้าเว็บเท่านั้น)
- [x] **API + หน้า "ข้อมูล CSV"** (`/data`): ตารางไฟล์ 9 ไฟล์ (แถว/ขนาด/อัปเดตล่าสุด) + **ปุ่มดาวน์โหลดทีละไฟล์** (`GET /api/csv/download/:file` — whitelist ชื่อไฟล์ กัน path traversal) + ปุ่ม "เขียนไฟล์ใหม่จากข้อมูลล่าสุด"
- [x] ไฟล์ตัวอย่าง 9 ไฟล์ (ข้อมูล seed ปัจจุบัน) + `server/data/csv/README.md` อธิบายแต่ละไฟล์/คอลัมน์/ความสัมพันธ์ foreign key
- [x] Unit tests 8 ตัว (สร้างไฟล์ครบ/DB เปลี่ยน→ไฟล์อัปเดต/แก้ไฟล์ภายนอก→ไม่เข้าระบบ+เขียนทับ/กัน loop/path traversal/escaping จุลภาค-คำพูด-newline/parseCsv) — server 40/40

## 2.8 ใบนำส่ง (BOL) + ส่งออกรายงาน Excel/PDF ✅

- [x] **BOL — ใบนำส่งสินค้า**: `GET /api/orders/:id/bol` — ออเดอร์ + ลูกค้า (ที่อยู่/ผู้ติดต่อ/โทร/เลขผู้เสียภาษี) + รถ (ทะเบียน/ประเภท) + คนขับ + เที่ยว + ชื่อองค์กรจากตั้งค่า → โมดัลเอกสาร A4 (หัวองค์กร/ตารางสินค้า/เส้นทาง/ลายเซ็นผู้ส่ง-ผู้รับ) + ปุ่ม **พิมพ์** (print CSS — แสดงเฉพาะเอกสารบนกระดาษ)
- [x] **Export Excel จริง** (`.xlsx`): `GET /api/reports/export?from&to` — เขียนเองไร้ dependency (`server/src/utils/xlsx.ts`: zip STORE + SpreadsheetML, inlineStr, ตัวเลขเป็นตัวเลขจริง) → 9 ชีต (สรุปภาพรวม/ออเดอร์รายเดือน/สถานะ/ลูกค้าอันดับ/พนักงานขับ/เส้นทาง/CRM ครบ) — เปิดใน Excel คำนวณต่อได้
- [x] **พิมพ์ PDF** จากหน้าเว็บ: ปุ่ม "พิมพ์ PDF" → `window.print()` + print CSS (ซ่อน sidebar/topbar/toolbar, กราฟ SVG พิมพ์ออกมาชัด) — ฟอนต์ไทยสมบูรณ์แบบ 100% ไม่ต้องพึ่ง engine ฝั่ง server
- [x] Unit tests: BOL (ข้อมูลครบ/ออเดอร์ไม่มี ref/404) + xlsx writer (zip signature/ส่วนประกอบครบ/ตัวเลข-ข้อความ/escape XML/ชื่อชีตซ้ำ/EOCD/สไตล์หัวตาราง+ขอบ) — server 51/51

### เทมเพลตเอกสาร — ใช้ได้โดยไม่ต้องรัน server (`server/data/templates/`)
- [x] `bol-form.xlsx` — แบบฟอร์มใบนำส่งเปล่า (หัวส่วนหนา + เส้นขอบ + ความกว้างคอลัมน์) กรอก/พิมพ์ใน Excel
- [x] `report-template.xlsx` — เทมเพลตรายงาน 9 ชีต หัวตารางตรงกับหน้า export (เอา CSV มาวางต่อได้)
- [x] `bol-form.html` — แบบฟอร์ม BOL กรอกในเบราว์เซอร์ + ปุ่มพิมพ์/เพิ่มแถวสินค้า — เปิด double-click ได้เลย (ไม่ต้อง server)
- [x] สคริปต์สร้าง: `npx tsx server/scripts/make-templates.ts` · xlsx writer เพิ่มสไตล์ขั้นต่ำ (bold/เส้นขอบ/ความกว้างคอลัมน์) — ใช้ได้กับ export ปกติด้วย

### ชุดไฟล์สำเร็จรูปทั้งระบบ — ไม่ต้องรัน server (`web-static/`)
> **ไฟล์เดียว `index.html` เหมือนระบบจริง** (SPA: sidebar + topbar + สลับหน้าภายในหน้าจอเดียว) + แยกโฟลเดอร์ `css/` `js/` — เปิด `index.html` ในเบราว์เซอร์ได้เลย (double-click) + `เอกสาร/` (เทมเพลตใบนำส่ง/รายงาน) + `ข้อมูล/` (CSV 9 ตาราง) + README
- [x] **สคริปต์ `web/scripts/make-static-site.tsx`** (`npm run static:export`): บูต API จริงจาก SQLite ชั่วคราว → jsdom + React render แต่ละหน้า → แยก shell (sidebar/topbar จากหน้าแรก) + เนื้อหา 21 หน้า → ประกอบเป็น **`index.html` + `css/styles.css` + `js/pages.js` + `js/app.js`** (hash routing: `#/orders`, `#/customers/1`, `#/login`; เมนู active; title เปลี่ยน; login โหมดเต็มจอ)
- [x] แก้บั๊กระหว่างทาง: `import.meta.env` นอก Vite (client อ่าน runtime base ได้), global navigator getter-only (defineProperty), fetch ต้องการ URL สัมบูรณ์ (`__TMS_API_BASE__`), count-up clock (rAF + performance.now ตัวเดียวกัน — ตัวเลขไม่ติดลบ), classic/automatic JSX runtime (tsconfig web)
- [x] แถบนำทางแบบลอย (static-nav) + print CSS — ดู/สาธิต/พิมพ์ได้โดยไม่ต้องรัน server

## 3. Roadmap พัฒนาขั้นสูง (4 เฟส)

### Phase 1 — Design System ✅
- [x] **v3 Soft & Calm** (ครีม+อำพัน, serif display): light sidebar + soften tokens — **ถูกแทนที่แล้ว**
- [x] **v5 Aurora** (ขาวอมม่วง + periwinkle/violet/rose, sans ตัวเดียว) = ธีมที่ใช้อยู่จริงในโค้ดตอนนี้ (`web/src/styles/tokens.css`)
- [x] **รอบซ่อม Aurora** — audit + แก้ 12 จุด (ดู §5 ท้ายไฟล์)

### Phase 2 — Foundation (ระบบต้อง "ใหญ่ขึ้นได้")
> ❌ dark mode ถูกตัดออกจากแผนตามความต้องการ (คงธีมสว่างอุ่นแบบเดียว)
- [x] **Token 3 ชั้น**: `tokens.css` จัดเป็น global → semantic → component (ตาม Atlassian) — เปลี่ยนค่าที่ token ที่เดียว
- [x] **Motion tokens**: `--dur-*` / `--ease-*` (global) → `--motion-*` / `--ease-enter|leave` (semantic) — ทุก transition/animation ใน CSS ใช้ token แล้ว + ปิดด้วย `prefers-reduced-motion`
- [x] **Accessibility audit**: WCAG คอนทราสต์ผ่านทุกคู่สี (`node web/scripts/contrast.mjs`) — รอบ v3 ปรับ muted/faint/สถานะ/ลิงก์จนผ่าน 18/18 · ปัจจุบัน **26/26** หลังย้ายมา Aurora + เพิ่มเกณฑ์ 3:1 ของ focus ring/ขอบฟิลด์ (ดู §3.5)
- [ ] Semantic HTML + heading hierarchy (ตามแนว Machine Experience — ให้ AI อ่านเข้าใจ)
- [x] Component tokens: Button (`--btn-*`) / Table (`--table-*`) / Card (`--card-*`) / Form / Sidebar / Link แยก layer แล้ว

### Phase 3 — ฟีเจอร์ AI-native 2026 (ตาม Attio/Hex)
- [x] **AI สรุปประจำวัน**: หนึ่งการ์ด "สรุปวันนี้" บน Dashboard — `GET /api/insights/daily` สังเคราะห์จากข้อมูลจริงทุกโมดูล (ออเดอร์ค้าง/เลยกำหนด, ใบเสนอราคาใกล้หมดอายุ, ลูกค้าเงียบ 30+ วัน, ความพร้อมทรัพยากร, ยอดส่งวันนี้) เป็น headline serif + รายการตามระดับความสำคัญ (แดง→เหลือง→ฟ้า→เขียว)
  > เป็น rule-based engine (กำหนดตายตัว ไม่เรียก LLM ภายนอก — ทำงานออฟไลน์ เร็ว ไม่มีค่าใช้จ่าย) โครงสร้าง `{headline, items[{tone,title,detail,action}]}` พร้อมสลับเป็น AI จริงได้โดยไม่แตะ frontend
- [x] **แนะนำการกระทำถัดไป** (next best action): ทุก item มี `action {label, to}` — quote ใกล้หมดอายุ → ติดตาม, ออเดอร์ด่วน/เลยกำหนด → ไปแผนงาน, ลูกค้าเงียบ → ดูรายชื่อ
- [ ] ค้นหาทั่วระบบ Ctrl+K (command palette)
- [ ] **Driver app** (มี Capacitor อยู่แล้ว): มุมมองมือถือคนขับ + เก็บ POD ณ จุดส่ง

### Phase 4 — Real-time & Integration
- [ ] GPS/telematics real-time (WebSocket/SSE) — บอร์ดแผนงานสด
- [ ] Multi-stop route optimization
- [x] ใบนำส่ง (BOL) + export PDF/Excel (ดู §2.8)
- [ ] Webhook/LINE Notify แจ้งเตือนลูกค้า-คนขับ
- [ ] PWA push notification (ลูกค้าใหม่/เที่ยวใหม่)

## 3.5 รอบซ่อม Aurora — audit + แก้ (คงธีมเดิม ไม่รื้อ) ✅
> ตรวจโค้ดจริงเทียบกฎที่ธีมประกาศไว้เอง + WCAG 2.2 + ระเบียบตัวอักษรไทย
> ผลตรวจหลังแก้: contrast 26/26 · server 51/51 · web a11y 4/4 · typecheck ผ่าน

**P0 — ฟีเจอร์พัง / a11y ตกเกณฑ์**
- [x] **print CSS ฆ่าการพิมพ์รายงาน**: `@media print { body * { visibility: hidden } }` เขียนลอย ๆ มีผลกับการพิมพ์ *ทุกหน้า* แต่ปลดซ่อนแค่ `.bol-print-area` (มีเฉพาะใน BolModal) → ปุ่ม "พิมพ์ PDF" ในหน้ารายงานได้กระดาษเปล่า · แก้: ผูกกับ `body.printing-bol` ที่ `BolModal` ใส่/ถอดตอน mount
- [x] **focus ring คีย์บอร์ดบนฟอร์มแทบมองไม่เห็น**: `.input:focus{outline:none}` specificity สูงกว่า `:focus-visible` ทั่วไป เหลือแค่แสง alpha .16 (~1.1:1) · แก้: เพิ่มกฎ `:focus-visible` ต่อฟิลด์ + ยก `--focus-ring` จาก violet-300 (1.9:1) เป็น violet-500 (**4.1:1** ผ่าน 1.4.11)
- [x] **`:focus-visible` บีบมุมชิ้นงาน**: กฎกลางตั้ง `border-radius: 8px` ทำให้ปุ่ม pill/การ์ดมุม 16–22px กลายเป็น 8px ตอนโฟกัส · แก้: ถอดออก (outline โค้งตามมุมเองอยู่แล้ว)

**P1 — ตัวอักษรไทย + touch target**
- [x] **`text-transform: uppercase` 6 จุดบนป้ายภาษาไทย** (หัวตาราง/stat-label/metric-label/nav-section/bol-sec/bol-goods) — ไทยไม่มีตัวพิมพ์ใหญ่ ได้แต่ `letter-spacing` บวกที่ผลักสระ/วรรณยุกต์ห่างพยัญชนะ · แก้: ถอด uppercase+tracking ทั้งหมด ให้ลำดับชั้นมาจาก **ขนาด + น้ำหนัก + สี**
- [x] **`letter-spacing` ติดลบบนหัวข้อไทย** (`.page-title` −0.01em, `.brand-name`, `.hero-greet`) ทำสระชนตัวข้างเคียง · แก้: ถอดออก + เพิ่ม `line-height` เป็น 1.35 ให้รูปสระบน/ล่างมีที่หายใจ (ตัวเลขล้วนยังใช้ −0.03em ได้)
- [x] **`.help-tip` 16×16px** ตก WCAG 2.2 · 2.5.8 (ขั้นต่ำ 24×24) · แก้: พื้นที่กด 24 วงกลมที่ตาเห็นยัง 16 (ผ่าน `::before` + `isolation: isolate`)
- [x] **ปุ่มบนอุปกรณ์สัมผัส** ขยายพื้นที่กดเป็น 44px ผ่าน `::after` ใน `@media (pointer: coarse)` — ไม่ขยายตัวปุ่ม เลย์เอาต์ไม่ขยับ

**P2 — ความสอดคล้องของธีม**
- [x] **gradient เกินโควตาตัวเอง**: tokens.css ประกาศ "gradient ใช้แค่ 3–5 จุดทั้งระบบ" แต่ `.stat-card::before` ใส่ `--grad-brand` ต่อการ์ด (CustomerDetail มี 4 ใบ = สายรุ้ง 4 แถบ) · แก้: เปลี่ยนเป็น `--accent` สีเดียว — โควตา gradient เหลือ 4 จุด (โลโก้ · avatar · โลโก้ล็อกอิน · เมนูที่เลือก)
- [x] **ปุ่มกระตุกทั้งแถวตาราง**: `.btn:hover{translateY(-1px)}` ใช้กับทุกปุ่มรวมปุ่มไอคอนในคอลัมน์ "จัดการ" · แก้: ยกตัวเฉพาะปุ่มสั่งการหลัก (primary/accent/danger/success)
- [x] **`font-feature-settings:'tnum'` ทั้ง body** บังคับตัวเลขกว้างเท่ากันแม้ในประโยคปกติ · แก้: ย้ายไป `font-variant-numeric` เฉพาะ `.num` / ตัวเลข KPI / เซลล์ตาราง
- [x] **`overflow-x: clip`** บน html/body กันเนื้อหาหลุดแนวนอนบนจอ 320px (ใช้ clip ไม่ใช่ hidden — hidden จะฆ่า `position: sticky` ของ topbar)

**P3 — ความครบของ state**
- [x] **แยก "กำลังทำงาน" ออกจาก "ใช้ไม่ได้"**: `Button` เพิ่ม `data-loading` + `aria-busy` (เดิม loading ใช้ `disabled` เลยดูเป็นปุ่มตาย) · CSS: opacity .8 + `cursor: progress`
- [x] **ฟิลด์ผิดพลาดสื่อสารครบ**: `Field` ผูก `aria-describedby` + `aria-invalid` เข้ากับข้อความ error/hint (เดิม screen reader ได้ยินแค่ชื่อฟิลด์) + ขอบแดงคู่ข้อความ (สีอย่างเดียวไม่พอ WCAG 1.4.1)
- [x] **ถอด token ตาย** `--font-serif` (นิยามไว้ ไม่มีใครเรียกใช้ตั้งแต่ย้ายมา Aurora)
- [x] **contrast script** เพิ่มคู่เกณฑ์ 3:1 (focus ring บน surface/paper, ขอบฟิลด์ผิดพลาด) → 23 → **26 คู่**

## 3.6 รอบลดความรก — "ลบ ไม่ใช่เพิ่ม" ✅
> ปัญหาที่พบ: หน้ารายงานหน้าเดียวมีย่อหน้าอธิบาย **12 ก้อน** (layer-why 4 + section-note 8),
> การ์ด KPI 8 ใบ, inline style 17 จุด — ผู้ใช้ต้องอ่านคำอธิบายก่อนเห็นตัวเลขจริงสักตัว
> ผลตรวจหลังแก้: typecheck 0 error · server 51/51 · web a11y 4/4 · contrast 26/26 · build ผ่าน · API 14/14 endpoint ตอบ 200

**ตัดของซ้ำ / ของเกิน**
- [x] **ทิ้ง `.layer-head` + `.layer-no` + `.layer-why`** (เลขวงกลม 1·2·3·4 + ย่อหน้า "ทำไมต้องดู") → `.section-head` หัวข้อบรรทัดเดียว + เส้นคั่นยืดเต็มความกว้าง — ตัด 7 ย่อหน้าออกจาก ภาพรวม+รายงาน
- [x] **ทิ้ง `.section-note` 8 ย่อหน้า** ในหน้ารายงาน → ย้ายข้อความไปอยู่ `card-subtitle` ใต้หัวการ์ด (**คำอธิบายยังอยู่ครบ** แค่ไปอยู่ติดของที่มันอธิบาย ไม่ใช่ห้อยท้ายเป็นกล่องแยก)
- [x] **การ์ด KPI 8 ใบ → แถบเมตริก 2 แถบ** (`metrics-band-4`) — รายงาน 4+4 ใบ และหน้าลูกค้า 4 ใบ ใช้รูปแบบเดียวกันทั้งระบบแล้ว
- [x] **hero หน้าภาพรวมเลิกซ้ำวันที่** กับ topbar
- [x] ถอด emoji 🎉 ใน empty state

**ตารางที่แตกบรรทัด (ต้นเหตุที่ดู "เลอะ" มากที่สุด)**
- [x] `.cell-no` — เลขที่เอกสาร mono + `nowrap` (เดิม `ORD-2026-0069` แตก 3 บรรทัด)
- [x] `.cell-date` — วันที่ `nowrap` (เดิม `10 ส.ค. 2569` แตก 3 บรรทัด)
- [x] `.table .num` — จำนวนเงิน `nowrap` (เดิม `7,400` กับ `฿` คนละบรรทัด)
- [x] `.card-title` ห่อบรรทัดได้ + `card-subtitle` ลงบรรทัดใหม่เสมอ (เดิมหัวข้อกับคำอธิบายแย่งพื้นที่จนคำไทยแตกกลางคำ: "สัดส่วนสถานะออ / เดอร์")
- [x] `.table .actions` ห่อบรรทัดแทนล้น (เดิมปุ่มท้ายแถวถูกตัดหายบนจอ < 1280px)
- [x] **ยุบคอลัมน์**: ออเดอร์ 9→8 (น้ำหนักไปอยู่บรรทัดรองของเส้นทาง) · ใบเสนอราคา 9→7 (สินค้า+น้ำหนักรวมกับเส้นทาง) · แผนงาน 6→5 (ป้าย "ด่วน" ย้ายไปข้างเลขที่ — สถานะ "ปกติ" ไม่ต้องบอก)
- [x] `fmtRoute` ปัดเป็นครึ่งชั่วโมง — "10 ชม. 46 นาที" (ความแม่นยำลวง ยาวจนตารางแตก) → "≈ 10.5 ชม."

**เลิก inline style → คลาสจริง**
- [x] `.grid-2` · `.card-flush` · `.stack` · `.tabs`/`.tab` · `.res-block`/`.res-head`/`.res-row`
- [x] คอมโพเนนต์ `ResourceBlock` (ภาพรวม) และ `MetricCell` (รายงาน) — เดิมเขียน markup ซ้ำสองชุด/สี่ชุด
- [x] inline style: รายงาน 17→6 · ภาพรวม 19→6 · หน้าลูกค้า 39→31

**หมายเหตุ**: คอมโพเนนต์ `StatCard` ยังอยู่ในดีไซน์ซิสเต็ม (มี a11y test คุม) แต่ไม่มีหน้าไหนเรียกใช้แล้ว — เก็บไว้ก่อน ไม่ลบ

## 4. หลักการยึดตลอด (จากที่ศึกษา)
- **Calm design**: หน้าต้อง "เงียบ" — ถ้าเพิ่มอะไร ให้ลดอะไรออก
- **สี = สถานะเท่านั้น** (Vercel rule) — ส่วนที่เหลือเป็นโทนเดียว · gradient มีโควตา 4 จุดทั้งระบบ
- **Token ก่อนโค้ด**: เปลี่ยนสี/มุม/ระยะ ต้องทำที่ token ที่เดียว แล้วรัน `node web/scripts/contrast.mjs`
- **เครื่องเก่า 2016+**: animation ใช้ transform/opacity เท่านั้น, bundle เล็ก, ฟอนต์ swap
- **ไทยมาก่อน**: ห้าม uppercase / tracking ติดลบ บนข้อความไทย · หัวข้อไทย `line-height` ≥ 1.35
- **คำอธิบายอยู่ติดของที่มันอธิบาย**: ใช้ `card-subtitle` ใต้หัวการ์ด ไม่ตั้งเป็นย่อหน้าลอยใต้กราฟ
- **ตารางไม่เกิน 8 คอลัมน์**: ข้อมูลรองลงบรรทัดที่สองของเซลล์หลัก · เลขที่/วันที่/เงิน `nowrap` เสมอ

## 5. เช็กลิสต์ก่อนปิดงานทุกรอบ
```bash
npm run typecheck && npm test && node web/scripts/contrast.mjs && npm run build
```
เกณฑ์ผ่าน ณ รอบล่าสุด: typecheck 0 error · server 51/51 · web a11y 4/4 · contrast 26/26 · build ผ่าน
แล้วไล่ดูด้วยตาที่ 1440px และ 375px อย่างน้อย: ภาพรวม · ออเดอร์ · ใบเสนอราคา · รายงาน
ถ้าแตะ UI ให้รัน `npm run static:export` ด้วย ไม่งั้น `web-static/` จะค้างเป็นของเก่า
