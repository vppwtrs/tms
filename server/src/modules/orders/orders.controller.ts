import type { Request, Response } from 'express'
import type { OrdersService } from './orders.service.js'

export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  list = (req: Request, res: Response): void => {
    const result = this.service.list(req.query as Record<string, unknown>)
    res.json({ data: result.rows, meta: { pagination: result.pagination } })
  }

  pendingUnassigned = (req: Request, res: Response): void => {
    res.json({ data: this.service.listPendingUnassigned(String(req.query.q ?? '')) })
  }

  getById = (req: Request, res: Response): void => {
    res.json({ data: this.service.getById(Number(req.params.id)) })
  }

  bol = (req: Request, res: Response): void => {
    res.json({ data: this.service.getBol(Number(req.params.id)) })
  }

  create = (req: Request, res: Response): void => {
    res.status(201).json({ data: this.service.create(req.body) })
  }

  update = (req: Request, res: Response): void => {
    res.json({ data: this.service.update(Number(req.params.id), req.body) })
  }

  cancel = (req: Request, res: Response): void => {
    res.json({ data: this.service.cancel(Number(req.params.id)) })
  }
}
