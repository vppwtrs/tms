import type { Request, Response } from 'express'
import type { CustomersService } from './customers.service.js'

export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  list = (req: Request, res: Response): void => {
    const result = this.service.list(req.query as { q?: string; segment?: string; page?: unknown; limit?: unknown })
    res.json({ data: result.rows, meta: { pagination: result.pagination } })
  }

  listAll = (req: Request, res: Response): void => {
    res.json({ data: this.service.listAll() })
  }

  getById = (req: Request, res: Response): void => {
    res.json({ data: this.service.getById(Number(req.params.id)) })
  }

  getDetail = (req: Request, res: Response): void => {
    res.json({ data: this.service.getDetail(Number(req.params.id)) })
  }

  create = (req: Request, res: Response): void => {
    res.status(201).json({ data: this.service.create(req.body) })
  }

  update = (req: Request, res: Response): void => {
    res.json({ data: this.service.update(Number(req.params.id), req.body) })
  }

  remove = (req: Request, res: Response): void => {
    this.service.remove(Number(req.params.id))
    res.status(204).end()
  }

  /* ===== CRM ===== */

  createInteraction = (req: Request, res: Response): void => {
    const userId = (req as Request & { user?: { id: number } }).user?.id ?? null
    res.status(201).json({ data: this.service.createInteraction(Number(req.params.id), req.body, userId) })
  }

  listInteractions = (req: Request, res: Response): void => {
    res.json({ data: this.service.listInteractions(Number(req.params.id)) })
  }

  removeInteraction = (req: Request, res: Response): void => {
    this.service.removeInteraction(Number(req.params.id), Number(req.params.interactionId))
    res.status(204).end()
  }

  createTask = (req: Request, res: Response): void => {
    const userId = (req as Request & { user?: { id: number } }).user?.id ?? null
    res.status(201).json({ data: this.service.createTask(Number(req.params.id), req.body, userId) })
  }

  listTasks = (req: Request, res: Response): void => {
    res.json({ data: this.service.listTasks(Number(req.params.id)) })
  }

  setTaskStatus = (req: Request, res: Response): void => {
    res.json({ data: this.service.setTaskStatus(Number(req.params.id), Number(req.params.taskId), req.body.status) })
  }

  removeTask = (req: Request, res: Response): void => {
    this.service.removeTask(Number(req.params.id), Number(req.params.taskId))
    res.status(204).end()
  }
}
