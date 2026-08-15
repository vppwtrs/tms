import type Database from 'better-sqlite3'
import type { Role } from '../../core/constants.js'

export interface UserRow {
  id: number
  username: string
  password_hash: string
  name: string
  role: Role
  is_active: number
  created_at: string
}

export interface UserListRow {
  id: number
  username: string
  name: string
  role: Role
  is_active: number
  created_at: string
}

export class AuthRepository {
  constructor(private readonly db: Database.Database) {}

  findByUsername(username: string): UserRow | undefined {
    return this.db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as UserRow | undefined
  }

  findById(id: number): UserRow | undefined {
    return this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined
  }

  updatePassword(id: number, hash: string): void {
    this.db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, id)
  }

  listUsers(): UserListRow[] {
    return this.db
      .prepare(`SELECT id, username, name, role, is_active, created_at FROM users ORDER BY id`)
      .all() as UserListRow[]
  }

  createUser(data: { username: string; password_hash: string; name: string; role: Role }): number {
    const info = this.db
      .prepare(`INSERT INTO users (username, password_hash, name, role) VALUES (@username, @password_hash, @name, @role)`)
      .run(data)
    return Number(info.lastInsertRowid)
  }

  updateUser(id: number, data: { name: string; role: Role }): void {
    this.db.prepare(`UPDATE users SET name = @name, role = @role WHERE id = @id`).run({ ...data, id })
  }

  setActive(id: number, active: boolean): void {
    this.db.prepare(`UPDATE users SET is_active = ? WHERE id = ?`).run(active ? 1 : 0, id)
  }

  /** จำนวน POD ที่บัญชีนี้เป็นคนเก็บ — `pod.collected_by` เป็น NOT NULL ตั้งใจให้เป็นแบบนั้น
   *  เพราะหลักฐานการส่งมอบต้องรู้เสมอว่าใครเป็นคนเก็บ ลบบัญชีทิ้งไม่ได้ */
  countPodCollected(id: number): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM pod WHERE collected_by = ?`).get(id) as { n: number }
    return row.n
  }

  /**
   * ลบบัญชี พร้อมตัดการอ้างอิงที่ยอมให้ว่างได้ออกก่อน
   *
   * `created_by` ของใบเสนอราคา/บันทึกลูกค้า/งานติดตาม ประกาศเป็น nullable ไว้แล้ว
   * แต่ FK ไม่ได้ใส่ ON DELETE SET NULL ไว้ SQLite เลยบล็อกการลบทั้งก้อน
   * เคลียร์เองในทรานแซกชันเดียวกันแทนการแก้ schema — ไม่ต้องสร้างตารางใหม่ทั้งสามตาราง
   */
  deleteUser(id: number): void {
    const tx = this.db.transaction((userId: number): void => {
      for (const table of ['quotes', 'customer_interactions', 'customer_tasks']) {
        this.db.prepare(`UPDATE ${table} SET created_by = NULL WHERE created_by = ?`).run(userId)
      }
      this.db.prepare(`DELETE FROM users WHERE id = ?`).run(userId)
    })
    tx(id)
  }

  /** จำนวนผู้ดูแลที่ยังเปิดใช้งาน — กันไม่ให้ระบบเหลือ admin ศูนย์คน */
  countActiveAdmins(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1`)
      .get() as { n: number }
    return row.n
  }

  listOverrides(userId: number): { permission: string; allowed: number }[] {
    return this.db
      .prepare(`SELECT permission, allowed FROM user_permissions WHERE user_id = ?`)
      .all(userId) as { permission: string; allowed: number }[]
  }

  /** เขียนทับ override ทั้งชุดใน transaction เดียว — ไม่มีสถานะครึ่ง ๆ กลาง ๆ ระหว่างบันทึก */
  replaceOverrides(userId: number, overrides: { permission: string; allowed: boolean }[]): void {
    const del = this.db.prepare(`DELETE FROM user_permissions WHERE user_id = ?`)
    const ins = this.db.prepare(
      `INSERT INTO user_permissions (user_id, permission, allowed) VALUES (?, ?, ?)`,
    )
    this.db.transaction(() => {
      del.run(userId)
      for (const o of overrides) ins.run(userId, o.permission, o.allowed ? 1 : 0)
    })()
  }
}
