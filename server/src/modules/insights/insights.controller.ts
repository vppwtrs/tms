import type { Request, Response } from 'express'
import type { InsightsService } from './insights.service.js'

export class InsightsController {
  constructor(private readonly service: InsightsService) {}

  daily = (_req: Request, res: Response): void => {
    res.json({ data: this.service.daily() })
  }
}
