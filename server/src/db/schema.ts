import type Database from 'better-sqlite3'

/** Schema ทั้งระบบ — version ถูกติดตามด้วย PRAGMA user_version สำหรับ migration ในอนาคต
 *  v1: ระบบหลัก (users/settings/customers/vehicles/drivers/trips/orders)
 *  v2: pod (หลักฐานการส่งมอบ)
 *  v3: CRM — quotes (ใบเสนอราคา), customer_interactions (ประวัติการติดต่อ),
 *      customer_tasks (งานติดตาม), คอลัมน์ CRM ของลูกค้า (segment/tax_id/credit_terms/tags/price_note)
 *  v4: สิทธิ์รายคน — user_permissions (เก็บเฉพาะที่ต่างจาก preset ของบทบาท),
 *      users.is_active (ปิดบัญชีชั่วคราวโดยไม่ลบประวัติ)
 *  v5: บทบาท 'driver' + drivers.user_id (ผูกบัญชีเข้ากับคนขับ เพื่อกรองข้อมูล
 *      ระดับแถวว่า "เที่ยวไหนเป็นของฉัน")
 */
export const SCHEMA_VERSION = 5

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','dispatcher','viewer','driver')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* สิทธิ์รายคน — เก็บ "ส่วนต่าง" จาก preset ของบทบาทเท่านั้น
   เปลี่ยนบทบาททีหลังแล้วเจตนาที่ admin ตั้งไว้จึงยังอยู่ */
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0,1)),
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  segment TEXT NOT NULL DEFAULT 'B',
  tax_id TEXT,
  credit_terms INTEGER,
  tags TEXT,
  price_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_no TEXT NOT NULL UNIQUE,
  brand TEXT,
  model TEXT,
  vehicle_type TEXT NOT NULL DEFAULT 'pickup' CHECK (vehicle_type IN ('pickup','truck6','truck10','reefer','van')),
  capacity_kg INTEGER NOT NULL DEFAULT 1000,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_trip','maintenance','inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  license_no TEXT,
  license_type TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_trip','off_duty')),
  joined_at TEXT,
  /* บัญชีผู้ใช้ของคนขับคนนี้ (ถ้ามี) — ใช้ตอบคำถาม "เที่ยวไหนเป็นของฉัน"
     NULL ได้: คนขับที่ไม่ได้ใช้แอปเอง ออฟฟิศกรอกแทนให้ */
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_no TEXT NOT NULL UNIQUE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','cancelled')),
  departed_at TEXT,
  arrived_at TEXT,
  fuel_cost INTEGER NOT NULL DEFAULT 0,
  toll_cost INTEGER NOT NULL DEFAULT 0,
  other_cost INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  distance_km INTEGER NOT NULL DEFAULT 0,
  goods_desc TEXT NOT NULL,
  weight_kg INTEGER NOT NULL DEFAULT 0,
  fee INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','assigned','in_transit','delivered','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  scheduled_at TEXT NOT NULL,
  delivered_at TEXT,
  trip_id INTEGER REFERENCES trips(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_trip ON orders(trip_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_scheduled ON orders(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);

CREATE TABLE IF NOT EXISTS pod (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  recipient_name TEXT NOT NULL,
  signature_data TEXT NOT NULL,
  photo_path TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'collected' CHECK (status IN ('collected','verified')),
  lat REAL,
  lng REAL,
  collected_by INTEGER NOT NULL REFERENCES users(id),
  collected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pod_order ON pod(order_id);
CREATE INDEX IF NOT EXISTS idx_pod_status ON pod(status);

/* ===== CRM (v3) ===== */
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  distance_km INTEGER NOT NULL DEFAULT 0,
  goods_desc TEXT NOT NULL,
  weight_kg INTEGER NOT NULL DEFAULT 0,
  fee INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  valid_until TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  converted_order_id INTEGER REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);

CREATE TABLE IF NOT EXISTS customer_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  type TEXT NOT NULL DEFAULT 'call' CHECK (type IN ('call','email','meeting','line','other')),
  subject TEXT NOT NULL,
  note TEXT,
  happened_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interactions_customer ON customer_interactions(customer_id);

CREATE TABLE IF NOT EXISTS customer_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  title TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_customer ON customer_tasks(customer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON customer_tasks(status);
`

/** คอลัมน์ CRM ที่เพิ่มในตาราง customers (มีอยู่แล้วใน DDL สำหรับฐานข้อมูลใหม่) */
const CUSTOMER_CRM_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'segment', ddl: `ALTER TABLE customers ADD COLUMN segment TEXT NOT NULL DEFAULT 'B'` },
  { name: 'tax_id', ddl: 'ALTER TABLE customers ADD COLUMN tax_id TEXT' },
  { name: 'credit_terms', ddl: 'ALTER TABLE customers ADD COLUMN credit_terms INTEGER' },
  { name: 'tags', ddl: 'ALTER TABLE customers ADD COLUMN tags TEXT' },
  { name: 'price_note', ddl: 'ALTER TABLE customers ADD COLUMN price_note TEXT' },
]

/** คอลัมน์ที่เพิ่มทีหลังในตารางเดิม — เช็คจาก PRAGMA ทุกครั้ง ไม่ผูกกับเลข version
 *
 *  ทำไมไม่อยู่ในบล็อกที่ gate ด้วย user_version:
 *  ถ้า DDL ถูกแก้แล้วมี server รันค้างอยู่ระหว่างพัฒนา เลข version จะขยับก่อนที่
 *  โค้ดเพิ่มคอลัมน์จะถูกเขียนเสร็จ แล้ว migration จะถูกข้ามถาวร (ฐานข้อมูลค้างครึ่งทาง
 *  โดยไม่มีใครรู้จนกว่าจะ query คอลัมน์นั้น) — เช็คทุกครั้งแบบนี้ราคาถูกและซ่อมตัวเองได้ */
const ADDED_COLUMNS: { table: string; name: string; ddl: string }[] = [
  ...CUSTOMER_CRM_COLUMNS.map((c) => ({ table: 'customers', ...c })),
  { table: 'users', name: 'is_active', ddl: `ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1` },
  {
    table: 'drivers',
    name: 'user_id',
    ddl: `ALTER TABLE drivers ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  },
]

/** ขยาย CHECK ของ users.role ให้รับบทบาท 'driver'
 *
 *  SQLite แก้ CHECK constraint ตรง ๆ ไม่ได้ ต้องสร้างตารางใหม่แล้วย้ายข้อมูล
 *  เช็คจาก DDL จริงใน sqlite_master ว่ามีคำว่า 'driver' อยู่แล้วหรือยัง —
 *  ถ้ามีก็ข้าม (ฐานข้อมูลใหม่ได้จาก DDL ตั้งแต่แรกอยู่แล้ว) */
function ensureDriverRole(db: Database.Database): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`).get() as
    | { sql: string }
    | undefined
  if (!row || row.sql.includes(`'driver'`)) return

  /* ต้องปิด foreign_keys ก่อน DROP TABLE users เพราะตารางอื่น (pod.collected_by,
     quotes.created_by, …) อ้างถึงอยู่ · PRAGMA นี้ถูกเมินถ้าสั่งกลาง transaction
     ฟังก์ชันนี้จึงต้องถูกเรียกนอก BEGIN/COMMIT และเปิด transaction ของตัวเอง */
  db.pragma('foreign_keys = OFF')
  db.exec(`
    BEGIN;
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','dispatcher','viewer','driver')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users_new (id, username, password_hash, name, role, is_active, created_at)
      SELECT id, username, password_hash, name, role, is_active, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    COMMIT;
  `)
  db.pragma('foreign_keys = ON')
}

function ensureColumns(db: Database.Database): void {
  for (const col of ADDED_COLUMNS) {
    const cols = (db.prepare(`PRAGMA table_info(${col.table})`).all() as { name: string }[]).map((c) => c.name)
    if (!cols.includes(col.name)) db.exec(col.ddl)
  }
}

export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number

  if (current < SCHEMA_VERSION) {
    db.exec('BEGIN')
    try {
      db.exec(DDL)
      ensureColumns(db)
      db.pragma(`user_version = ${SCHEMA_VERSION}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  } else {
    // version ตรงแล้ว แต่ยังต้องเช็คโครงสร้างเผื่อ migration รอบก่อนหยุดกลางคัน
    ensureColumns(db)
  }

  // นอก transaction เสมอ — ดูเหตุผลในตัวฟังก์ชัน
  ensureDriverRole(db)
}
