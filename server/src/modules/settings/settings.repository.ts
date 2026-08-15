import type Database from 'better-sqlite3'

export interface SettingsRow {
  org_name: string
  currency_code: string
  currency_symbol: string
}

const KEYS = ['org_name', 'currency_code', 'currency_symbol'] as const

/** ตั้งค่าองค์กร — เก็บเป็น key/value */
export class SettingsRepository {
  constructor(private readonly db: Database.Database) {}

  getAll(): SettingsRow {
    const rows = this.db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[]
    const map = new Map(rows.map((r) => [r.key, r.value]))
    return {
      org_name: map.get('org_name') ?? 'บริษัท ขนส่ง จำกัด',
      currency_code: map.get('currency_code') ?? 'THB',
      currency_symbol: map.get('currency_symbol') ?? '฿',
    }
  }

  set(key: (typeof KEYS)[number], value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value)
  }
}
