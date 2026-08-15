import type { Request, Response } from 'express'
import type { DashboardService } from './dashboard.service.js'

export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  summary = (_req: Request, res: Response): void => {
    res.json({ data: this.service.summary() })
  }
}
