import type { Request, Response } from 'express'
import type { TripsService } from './trips.service.js'

export class TripsController {
  constructor(private readonly service: TripsService) {}

  list = (req: Request, res: Response): void => {
    const result = this.service.list(req.query)
    res.json({ data: result.rows, meta: { pagination: result.pagination } })
  }

  board = (_req: Request, res: Response): void => {
    res.json({ data: this.service.board() })
  }

  getById = (req: Request, res: Response): void => {
    res.json({ data: this.service.getDetail(Number(req.params.id)) })
  }

  create = (req: Request, res: Response): void => {
    const result = this.service.create(req.body)
    res.status(201).json({ data: result.trip, warning: result.warning })
  }

  addOrders = (req: Request, res: Response): void => {
    const result = this.service.addOrders(Number(req.params.id), req.body.order_ids)
    res.json({ data: result.trip, warning: result.warning })
  }

  removeOrder = (req: Request, res: Response): void => {
    res.json({ data: this.service.removeOrder(Number(req.params.id), Number(req.params.orderId)) })
  }

  start = (req: Request, res: Response): void => {
    res.json({ data: this.service.start(Number(req.params.id)) })
  }

  complete = (req: Request, res: Response): void => {
    res.json({ data: this.service.complete(Number(req.params.id)) })
  }

  cancel = (req: Request, res: Response): void => {
    res.json({ data: this.service.cancel(Number(req.params.id)) })
  }

  updateCosts = (req: Request, res: Response): void => {
    res.json({ data: this.service.updateCosts(Number(req.params.id), req.body) })
  }
}
