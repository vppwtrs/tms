import type { Request, Response } from 'express'
import type { QuotesService } from './quotes.service.js'

export class QuotesController {
  constructor(private readonly service: QuotesService) {}

  list = (req: Request, res: Response): void => {
    const result = this.service.list(req.query as Record<string, unknown>)
    res.json({ data: result.rows, meta: { pagination: result.pagination } })
  }

  listByCustomer = (req: Request, res: Response): void => {
    res.json({ data: this.service.listByCustomer(Number(req.params.customerId)) })
  }

  getById = (req: Request, res: Response): void => {
    res.json({ data: this.service.getById(Number(req.params.id)) })
  }

  create = (req: Request, res: Response): void => {
    const userId = (req as Request & { user?: { id: number } }).user?.id ?? null
    res.status(201).json({ data: this.service.create(req.body, userId) })
  }

  update = (req: Request, res: Response): void => {
    res.json({ data: this.service.update(Number(req.params.id), req.body) })
  }

  setStatus = (req: Request, res: Response): void => {
    res.json({ data: this.service.setStatus(Number(req.params.id), req.body.status) })
  }

  convertToOrder = (req: Request, res: Response): void => {
    const { scheduled_at, notes } = req.body
    const result = this.service.convertToOrder(Number(req.params.id), scheduled_at, notes)
    res.status(201).json({ data: result })
  }
}
