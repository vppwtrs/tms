import type { Request, Response } from 'express'
import { PodService } from '../pod/pod.service.js'
import type { MyJobsService } from './myjobs.service.js'

export class MyJobsController {
  constructor(private readonly service: MyJobsService) {}

  list = (req: Request, res: Response): void => {
    res.json({ data: this.service.list(req.user!.id, req.query.all === '1') })
  }

  start = (req: Request, res: Response): void => {
    res.json({ data: this.service.start(req.user!.id, Number(req.params.id)) })
  }

  complete = (req: Request, res: Response): void => {
    res.json({ data: this.service.complete(req.user!.id, Number(req.params.id)) })
  }

  deliverOrder = (req: Request, res: Response): void => {
    res.json({ data: this.service.deliverOrder(req.user!.id, Number(req.params.id)) })
  }

  createPod = (req: Request, res: Response): void => {
    // multer เก็บรูปไว้ใน memory — เขียนลงดิสก์ก่อน แล้วลบทิ้งถ้ากฎธุรกิจไม่ผ่าน
    let photoPath: string | undefined
    if (req.file) photoPath = PodService.savePhoto(req.file.buffer, req.file.mimetype)
    try {
      res.status(201).json({ data: this.service.createPod(req.user!.id, { ...req.body, photo_path: photoPath }) })
    } catch (e) {
      if (photoPath) PodService.deletePhoto(photoPath)
      throw e
    }
  }
}
