# CLAUDE.md

Transport Management System (TMS) — ระบบบริหารจัดการขนส่ง. npm workspaces monorepo, Node >= 20, TypeScript ESM ทั้งโปรเจ็ค. UI และ comment ในโค้ดเป็นภาษาไทย.

## Layout

| Path | ทำอะไร |
|---|---|
| `server/` | Express 5 API + better-sqlite3 |
| `web/` | React 19 + Vite SPA (+ Capacitor iOS) |
| `web-static/` | เว็บ static ที่ export ออกมา (ไม่มี build step) |
| `extractor/` | ตัวดึงข้อมูลจาก TMS บริษัท (เดิมเป็นโปรเจ็คแยกชื่อ "TMS Report") |
| `supabase/` | schema + RLS + Edge Function ของครึ่งคลาวด์ (`migrations/` รันด้วยมือผ่าน SQL Editor ไม่มี migration history ในฐาน — `supabase db push` ใช้ไม่ได้จนกว่าจะ `migration repair`) |
| `scripts/serve.mjs` | ตัวคุม process: start / stop / restart / status |
| `scripts/bootstrap-node.ps1` | ติดตั้ง Node แบบ portable ให้เครื่องที่ยังไม่มี (ไม่ต้อง admin) |
| `docs/` | `PLAN.md`, `ROADMAP-2026.md` |
| `STATUS.md` | **ทำถึงไหนแล้ว ทำอะไรต่อ — อ่านก่อนเริ่มงานทุกครั้ง** |

โปรเจ็คนี้มีสองครึ่งที่คนละเรื่องกัน อย่าปนกัน:

- **ครึ่งที่ใช้งานจริงอยู่ตอนนี้** — `server/` + `web/` รันบน LAN ของออฟฟิศ ใช้ SQLite
- **ครึ่งที่กำลังสร้าง** — `supabase/` + ไฟล์ใหม่ใน `web/src/api/` สำหรับย้ายขึ้น GitHub Pages + Supabase

ครึ่งคลาวด์ใช้งานจริงแล้วที่ https://vppwtrs.github.io/tms/ (build ด้วย `npm run build:cloud -w web`)
ส่วนครึ่ง LAN ยังรันอยู่ที่ออฟฟิศไม่ถูกแตะ — ตั้งใจให้มีสองชุดระหว่างย้าย
สับทีเดียวแล้วพลาดคือออฟฟิศหยุดกลางสัปดาห์ ซึ่งแพงกว่าการมีโค้ดสองชุดอยู่พักหนึ่ง

**แหล่งข้อมูลของครึ่งคลาวด์คือ TMS บริษัท ไม่ใช่ `seed.ts`** และมีสองเส้นที่เสริมกัน:
`/v1/tripheaders/{GUID}/search` = เที่ยวของกองรถเรา (กรองด้วย carrier `Fleet Owner*`) เป็นแหล่งหลัก
`/v1/pickinglistheaders/{รหัส}/search` = ใบที่ยังไม่ถูกจัดเที่ยว (สถานะ New ไม่โผล่ในหน้า Trip)
อ้างคลังคนละแบบ (GUID กับรหัส) ส่งผิดฝั่ง 404 ทุก request — ดู `docs`/STATUS.md ก่อนแก้

`extractor/` ไม่มี `package.json` ไม่ใช่ workspace — เป็นเครื่องมือแยกที่รันด้วย Node เปล่า ๆ

## คำสั่ง

```bash
npm run dev
```

รัน server + web พร้อมกันผ่าน concurrently. อื่น ๆ:

- `npm test` — vitest ทั้ง server และ web
- `npm run typecheck` — tsc --noEmit ทั้งสอง workspace
- `npm run build` — build web แล้ว build server
- `npm run seed` — seed DB (`server/src/db/seed.ts`)
- `npm run serve` / `serve:stop` / `serve:restart` / `serve:status`
- `npm run static:export` — สร้าง `web-static/`
- `npm run static:templates` — สร้าง template ไฟล์ใน `server/data/templates`

CI: `.github/workflows/ci.yml` (push `main` + PR) · deploy ขึ้น Pages: `.github/workflows/deploy-pages.yml` (push `main`)

Edge Function ต้อง deploy เองผ่าน Dashboard หรือ `supabase functions deploy <ชื่อ>` —
CI ไม่แตะฝั่ง Supabase เลย แก้ไฟล์ใน `supabase/functions/` แล้วไม่ deploy = ของเก่ายังรันอยู่

## Server

Entry `server/src/index.ts` เรียก `createApp(db, csv)` ใน `server/src/app.ts`. app.ts คือที่เดียวที่ mount route ทั้งหมด — เพิ่มโมดูลใหม่ต้องแก้ไฟล์นี้.

โครง 1 โมดูล = 1 โฟลเดอร์ใน `server/src/modules/` แยกเป็น 4 ชั้น:

```
orders.route.ts       ผูก path + middleware
orders.controller.ts  อ่าน req / เขียน res
orders.service.ts     business logic (+ .test.ts)
orders.repository.ts  SQL
```

โมดูลปัจจุบัน: auth, csv, customers, dashboard, drivers, insights, myjobs, orders, pod, quotes, reports, settings, trips, vehicles.

ส่วนกลาง:
- `src/core/` — `constants.ts`, `errors.ts`, `permissions.ts`
- `src/middleware/` — `auth.ts`, `validate.ts` (zod), `errorHandler.ts`
- `src/db/` — `connection.ts`, `schema.ts`, `seed.ts`, `permissions.ts`, `csv.ts`
- `src/utils/` — `helpers.ts`, `xlsx.ts`

กติกาที่ต้องรักษา:
- `initPermissions(db)` ต้องรันก่อนสร้าง route เพราะ `requirePerm()` ใช้ store ตัวนั้น
- error response รูปแบบเดียว: `{ error: { code, message } }` (message ภาษาไทย)
- import ภายในต้องใส่นามสกุล `.js` (ESM + tsc)
- prefix `/api` ทุก endpoint; GET ที่ไม่ขึ้นต้นด้วย `/api` จะตกไป SPA fallback
- รูป POD เก็บนอก web root (`server/data/pod`) เสิร์ฟผ่าน endpoint ที่ต้องล็อกอินเท่านั้น

**HTTPS เปิดเป็นค่าเริ่มต้น** (`server/src/tls.ts`) ไม่ใช่เรื่องความปลอดภัยอย่างเดียว แต่เพราะกล้องของคนขับ (`getUserMedia`) และ GPS ทำงานเฉพาะ secure context — เปิดผ่าน `http://192.168.x.x` เบราว์เซอร์จะไม่ให้ใช้กล้องเลย. ใบรับรอง self-signed สร้างอัตโนมัติที่ `server/data/cert/` ครอบคลุม IP ทุกใบของเครื่อง และออกใหม่เองเมื่อ IP เปลี่ยน. ปิดด้วย `HTTPS=0` เมื่ออยู่หลัง reverse proxy ที่ทำ TLS ให้แล้ว.

Config อยู่ที่ `server/src/config.ts` อ่านจาก env: `PORT` (3100), `DB_PATH`, `POD_DIR`, `WEB_DIST`, `JWT_SECRET`, `HTTPS`, `SSL_CERT`, `SSL_KEY`, `CERT_DIR`. JWT ใช้ jose, TTL 12h; รหัสผ่าน bcrypt 10 rounds. **`JWT_SECRET` มีค่า default สำหรับ dev — ต้องตั้งค่าจริงก่อน deploy.**

DB คือ SQLite ไฟล์เดียว `server/data/tms.db` (WAL). ไม่มี migration tool — schema อยู่ใน `src/db/schema.ts`.

## Web

`web/src/` — `App.tsx` + `pages/` (Dashboard, Orders, Dispatch, Customers, CustomerDetail, Drivers, Vehicles, Quotes, Reports, Data, Users, Settings, MyJobs, Login, NotFound), `components/`, `context/`, `hooks/`, `api/`, `styles/`, `types.ts`.

`npm run build -w web` รัน `tsc --noEmit` ก่อน vite build — type error ทำ build ล้ม.

a11y เป็นเทสจริง ไม่ใช่แค่แนวทาง: `web/src/a11y/` ใช้ axe-core, รันด้วย `npm run test:a11y`. หน้าใหม่ควรมีเทสคู่. `asyncUtilTimeout` ตั้งไว้ 5 วินาทีใน `src/test/setup.ts` เพราะเทสที่ render `<App />` ทั้งตัวจะล้มแบบ flaky ด้วยค่า default 1 วินาทีเมื่อหลายไฟล์รันขนานกัน.

### หน้าคนขับ (`components/driver/`)

`MyJobs.tsx` ต่างจากหน้าอื่นทั้งระบบ — ออกแบบตามรูปแบบที่แอปส่งของเชิงพาณิชย์ใช้กัน ไม่ใช่ตามหน้าออฟฟิศ:
- **หนึ่งงานเต็มจอ** ไม่ใช่ list ทุกเที่ยว (`JobFocus`) เที่ยวอื่นอยู่หลังปุ่มเดียว
- **ปุ่มหลักตรึงล่างจอ** (`.job-cta-bar`) พร้อม `env(safe-area-inset-bottom)` กันแถบ home ของ iPhone
- ปุ่มในหน้านี้สูง `--driver-tap` (56px) ไม่ใช่ 40px แบบหน้าออฟฟิศ — คนขับกดตอนรถสั่น/ใส่ถุงมือ
- **ห้ามให้ตัวเลขเงินโผล่ในหน้านี้** — repository ฝั่ง server ไม่ได้ SELECT มาให้ตั้งแต่ต้น อย่าไปดึงเพิ่ม
- `JobProgress` อ่านขั้นตอนจากข้อมูลจริงล้วน ไม่มี state แยก
- **ปิดการส่งทีละจุด** ผ่าน `POST /api/my-jobs/orders/:id/deliver` แล้วเด้งเข้าฟอร์ม POD ต่อทันที
  เที่ยวหนึ่งมีหลายร้าน และ `pod.create()` รับเฉพาะออเดอร์ที่ `delivered` แล้ว — ถ้าไม่มีทางปิดทีละจุด
  คนขับจะเก็บลายเซ็นร้านแรกไม่ได้จนกว่าจะวิ่งครบทุกร้าน ปุ่มปิดเที่ยวถูก disable ไว้จนกว่าจะส่งครบ
  เพราะ `trips.complete()` เหมาออเดอร์ที่เหลือเป็น `delivered` ให้หมด

รูปหน้างานถ่ายผ่าน `getUserMedia` ใน `components/CameraCapture.tsx` ไม่ใช่ `<input capture>` — เพื่อไม่ให้รูปตกลง Photos ของคนขับ และปิดช่องเลือกรูปเก่าจาก gallery มาปิดงาน. บีบด้วย canvas (`utils/image.ts`) เหลือ ~300KB ก่อนส่ง. **นี่คือเหตุผลที่ server ต้องเปิด HTTPS.**

## เครื่องใหม่ / เครื่องที่ไม่มี Node

ดับเบิลคลิก `start.cmd` พอ — ถ้าไม่มี Node มันจะดาวน์โหลด Node LTS แบบ portable ลง `%LOCALAPPDATA%\nodejs` (พร้อมแถบ %), ตรวจ SHA256, เพิ่ม user PATH, แล้วรันต่อในหน้าต่างเดิม ไม่ต้องใช้สิทธิ์ admin และไม่ต้องปิด-เปิดใหม่.

ข้อควรรู้:
- `start.cmd` / `stop.cmd` ต้องเป็น **ASCII ล้วน** — cmd.exe parse ผิดถ้ามีตัวอักษร multi-byte หลัง `chcp 65001` ข้อความไทยไปอยู่ในไฟล์ `.ps1` / `.mjs` แทน
- `bootstrap-node.ps1` ต้องบันทึกเป็น **UTF-8 with BOM** — PowerShell 5.1 อ่านเป็น ANSI ถ้าไม่มี BOM แล้วภาษาไทยทำ syntax พัง
- เวอร์ชัน Node ล็อกไว้ใน `$NODE_VERSION` และรับได้เฉพาะ major ใน `$ALLOWED_MAJOR` (20/22/24) เพราะ `better-sqlite3` มี prebuilt binary แค่ ABI เหล่านี้ เวอร์ชันอื่นจะไป compile ด้วย node-gyp ซึ่งต้องมี Visual Studio C++ (ต้อง admin)
- **`better-sqlite3` ต้องคาไว้ที่ `^12.x`** — v13.0.3 ไม่ปล่อย prebuilt binary เลย ทำให้เครื่องที่ไม่มี C++ toolchain ติดตั้งไม่ผ่าน อัปเป็น 13 ได้ต่อเมื่อ upstream กลับมาปล่อย prebuild
- ออฟฟิศที่บล็อก nodejs.org: ตั้ง `NODE_MIRROR` ชี้ mirror ภายในก่อนรัน

## ก่อนส่งงาน

รัน `npm run typecheck` แล้ว `npm test` ให้ผ่านทั้งคู่.
