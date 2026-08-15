import type { Request, Response } from 'express'
import type { VehiclesService } from './vehicles.service.js'

export class VehiclesController {
  constructor(private readonly service: VehiclesService) {}

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
