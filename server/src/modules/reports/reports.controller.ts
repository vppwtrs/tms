import type { Request, Response } from 'express'
import { buildXlsx } from '../../utils/xlsx.js'
import type { ReportsService } from './reports.service.js'

export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  generate = (req: Request, res: Response): void => {
    const { from, to } = req.query
    res.json({ data: this.service.generate(String(from), String(to)) })
  }

  /** ส่งออกเป็นไฟล์ .xlsx จริง (เปิดใน Excel ได้ทันที) */
  exportExcel = (req: Request, res: Response): void => {
    const { from, to } = req.query
    const sheets = this.service.exportData(String(from), String(to))
    const buf = buildXlsx(sheets)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="tms-report-${String(from)}-${String(to)}.xlsx"`)
    res.send(buf)
  }
}
