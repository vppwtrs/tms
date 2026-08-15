import type { Request, Response } from 'express'
import { PodService } from './pod.service.js'

export class PodController {
  constructor(private readonly service: PodService) {}

  getByOrder = (req: Request, res: Response): void => {
    res.json({ data: this.service.getByOrderId(Number(req.params.orderId)) })
  }

  getById = (req: Request, res: Response): void => {
    res.json({ data: this.service.getById(Number(req.params.id)) })
  }

  create = (req: Request, res: Response): void => {
    // multer เก็บไฟล์ใน memory — บันทึกลงดิสก์หลังผ่าน validation
    let photoPath: string | undefined
    if (req.file) {
      photoPath = PodService.savePhoto(req.file.buffer, req.file.mimetype)
    }
    try {
      const pod = this.service.create({ ...req.body, photo_path: photoPath }, req.user!.id)
      res.status(201).json({ data: pod })
    } catch (e) {
      // validation/กฎธุรกิจ fail → ลบไฟล์ที่เพิ่งบันทึก
      if (photoPath) PodService.deletePhoto(photoPath)
      throw e
    }
  }

  update = (req: Request, res: Response): void => {
    let newPhoto: string | null | undefined
    if (req.file) {
      newPhoto = PodService.savePhoto(req.file.buffer, req.file.mimetype)
    }
    try {
      const pod = this.service.update(Number(req.params.id), req.body, newPhoto)
      res.json({ data: pod })
    } catch (e) {
      if (newPhoto) PodService.deletePhoto(newPhoto)
      throw e
    }
  }

  verify = (req: Request, res: Response): void => {
    res.json({ data: this.service.verify(Number(req.params.id)) })
  }

  photo = (req: Request, res: Response): void => {
    const { absPath } = this.service.resolvePhoto(Number(req.params.id))
    res.sendFile(absPath)
  }
}
