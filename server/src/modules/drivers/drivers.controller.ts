import type { Request, Response } from 'express'
import type { DriversService } from './drivers.service.js'

export class DriversController {
  constructor(private readonly service: DriversService) {}

  list = (req: Request, res: Response): void => {
    const result = this.service.list(req.query)
    res.json({ data: result.rows, meta: { pagination: result.pagination } })
  }

  listAvailable = (_req: Request, res: Response): void => {
    res.json({ data: this.service.listAvailable() })
  }

  getById = (req: Request, res: Response): void => {
    res.json({ data: this.service.getById(Number(req.params.id)) })
  }

  create = (req: Request, res: Response): void => {
    res.status(201).json({ data: this.service.create(req.body) })
  }

  update = (req: Request, res: Response): void => {
    res.json({ data: this.service.update(Number(req.params.id), req.body) })
  }

  setStatus = (req: Request, res: Response): void => {
    res.json({ data: this.service.setStatus(Number(req.params.id), req.body.status) })
  }

  remove = (req: Request, res: Response): void => {
    this.service.remove(Number(req.params.id))
    res.status(204).end()
  }
}
