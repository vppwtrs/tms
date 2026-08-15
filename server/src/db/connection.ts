import Database from 'better-sqlite3'

/**
 * เปิด SQLite หนึ่ง connection (synchronous — เร็ว, โค้ดง่าย, เหมาะกับ workload ของทีมเล็ก)
 * WAL mode + foreign keys เปิดตลอด
 */
export function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}
