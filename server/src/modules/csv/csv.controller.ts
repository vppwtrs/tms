import type { Request, Response } from 'express'
import path from 'node:path'
import type { CsvStore } from '../../db/csv.js'
import { AUTO_SYNC_MS } from '../../db/csv.js'
import { err } from '../../core/errors.js'

export class CsvController {
  constructor(private readonly store: CsvStore) {}

  /** สถานะไฟล์ export — ใช้หน้า "ข้อมูล CSV" ในเว็บ */
  status = (_req: Request, res: Response): void => {
    res.json({ data: { csvDir: this.store.dir, autoSyncMs: AUTO_SYNC_MS, tables: this.store.status() } })
  }

  /** เขียนไฟล์ CSV ทั้งหมดใหม่จากข้อมูลล่าสุด (บังคับ) */
  exportAll = (_req: Request, res: Response): void => {
    const files = this.store.exportAll()
    res.json({ data: { files, total: files.length } })
  }

  /** ดาวน์โหลดไฟล์ CSV (export เท่านั้น — ข้อมูลจริงอยู่ที่ DB จัดการผ่านเว็บ) */
  download = (req: Request, res: Response): void => {
    const raw = req.params.file
    const absPath = this.store.resolveExportFile(typeof raw === 'string' ? raw : '')
    if (!absPath) throw err.notFound('ไม่พบไฟล์ CSV นี้')
    res.download(absPath, path.basename(absPath))
  }
}
