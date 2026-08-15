import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { ROLES } from '../../core/constants.js'
import { PERMISSIONS } from '../../core/permissions.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { AuthRepository } from './auth.repository.js'
import type Database from 'better-sqlite3'

const loginSchema = z.object({
  username: z.string().trim().min(1, 'ระบุชื่อผู้ใช้'),
  password: z.string().min(1, 'ระบุรหัสผ่าน'),
})

const changePasswordSchema = z.object({
  old_password: z.string().min(1, 'ระบุรหัสผ่านเดิม'),
  new_password: z.string().min(6, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร'),
})

const createUserSchema = z.object({
  username: z.string().trim().min(3, 'ชื่อผู้ใช้อย่างน้อย 3 ตัว').max(40),
  password: z.string().min(6, 'รหัสผ่านอย่างน้อย 6 ตัว'),
  name: z.string().trim().min(1, 'ระบุชื่อ').max(120),
  role: z.enum(ROLES),
})

const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'ระบุชื่อ').max(120),
  role: z.enum(ROLES),
})

const activeSchema = z.object({ is_active: z.boolean() })

const resetPasswordSchema = z.object({
  new_password: z.string().min(6, 'รหัสผ่านอย่างน้อย 6 ตัว'),
})

const permissionsSchema = z.object({
  permissions: z.array(z.enum(PERMISSIONS)),
})

export function authRoute(db: Database.Database): Router {
  const service = new AuthService(new AuthRepository(db))
  const controller = new AuthController(service)
  const router = Router()

  router.post('/login', validate({ body: loginSchema }), controller.login)
  router.get('/me', requireAuth, controller.me)
  router.post('/change-password', requireAuth, validate({ body: changePasswordSchema }), controller.changePassword)
  /* จัดการผู้ใช้ — ต้องมีสิทธิ์ users.manage (ไม่ผูกกับบทบาท admin ตรง ๆ อีกต่อไป
     เพื่อให้ admin มอบงานนี้ให้คนอื่นได้โดยไม่ต้องยกบทบาททั้งก้อนให้) */
  const canManage = requirePerm('users.manage')
  router.get('/permissions/catalog', requireAuth, canManage, controller.catalog)
  router.get('/users', requireAuth, canManage, controller.listUsers)
  router.post('/users', requireAuth, canManage, validate({ body: createUserSchema }), controller.createUser)
  router.get('/users/:id', requireAuth, canManage, controller.getUser)
  router.put('/users/:id', requireAuth, canManage, validate({ body: updateUserSchema }), controller.updateUser)
  router.patch('/users/:id/active', requireAuth, canManage, validate({ body: activeSchema }), controller.setActive)
  router.patch('/users/:id/password', requireAuth, canManage, validate({ body: resetPasswordSchema }), controller.resetPassword)
  router.put('/users/:id/permissions', requireAuth, canManage, validate({ body: permissionsSchema }), controller.setPermissions)
  router.delete('/users/:id', requireAuth, canManage, controller.deleteUser)

  return router
}
