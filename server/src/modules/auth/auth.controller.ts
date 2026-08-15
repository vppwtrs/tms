import type { Request, Response } from 'express'
import type { AuthService } from './auth.service.js'
import {
  PERMISSION_GROUPS,
  PERMISSION_LABEL,
  PERMISSION_WARNING,
  ROLE_PRESET,
} from '../../core/permissions.js'

export class AuthController {
  constructor(private readonly service: AuthService) {}

  login = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.login(req.body.username, req.body.password)
    res.json({ data: result })
  }

  me = (req: Request, res: Response): void => {
    res.json({ data: this.service.me(req.user!.id) })
  }

  changePassword = async (req: Request, res: Response): Promise<void> => {
    await this.service.changePassword(req.user!.id, req.body.old_password, req.body.new_password)
    res.json({ data: { ok: true } })
  }

  listUsers = (_req: Request, res: Response): void => {
    res.json({ data: this.service.listUsers() })
  }

  createUser = async (req: Request, res: Response): Promise<void> => {
    const id = await this.service.createUser(req.body)
    res.status(201).json({ data: this.service.getUser(id) })
  }

  getUser = (req: Request, res: Response): void => {
    res.json({ data: this.service.getUser(Number(req.params.id)) })
  }

  updateUser = (req: Request, res: Response): void => {
    this.service.updateUser(Number(req.params.id), req.body)
    res.json({ data: this.service.getUser(Number(req.params.id)) })
  }

  setActive = (req: Request, res: Response): void => {
    const id = Number(req.params.id)
    this.service.setActive(id, req.body.is_active, req.user!.id)
    res.json({ data: this.service.getUser(id) })
  }

  resetPassword = async (req: Request, res: Response): Promise<void> => {
    await this.service.resetPassword(Number(req.params.id), req.body.new_password)
    res.json({ data: { ok: true } })
  }

  deleteUser = (req: Request, res: Response): void => {
    this.service.deleteUser(Number(req.params.id), req.user!.id)
    res.json({ data: { ok: true } })
  }

  setPermissions = (req: Request, res: Response): void => {
    res.json({ data: this.service.setPermissions(Number(req.params.id), req.body.permissions, req.user!.id) })
  }

  /** แคตตาล็อกสิทธิ์ทั้งหมด — หน้าจอสร้างตารางจากก้อนนี้ ไม่ต้อง hardcode ฝั่ง web */
  catalog = (_req: Request, res: Response): void => {
    res.json({
      data: {
        groups: PERMISSION_GROUPS,
        labels: PERMISSION_LABEL,
        warnings: PERMISSION_WARNING,
        presets: ROLE_PRESET,
      },
    })
  }
}
