import type { Request, Response } from 'express'
import type { SettingsService } from './settings.service.js'

export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  get = (_req: Request, res: Response): void => {
    res.json({ data: this.service.get() })
  }

  update = (req: Request, res: Response): void => {
    res.json({ data: this.service.update(req.body) })
  }
}
