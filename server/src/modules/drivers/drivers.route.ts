import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { DRIVER_STATUSES } from '../../core/constants.js'
import { DriversController } from './drivers.controller.js'
import { DriversService } from './drivers.service.js'
import { DriversRepository } from './drivers.repository.js'
import type Database from 'better-sqlite3'

const driverSchema = z.object({
  name: z.string().trim().min(1, 'ระบุชื่อ').max(120),
  phone: z.string().trim().max(30).optional().nullable(),
  license_no: z.string().trim().max(30).optional().nullable(),
  license_type: z.string().trim().max(50).optional().nullable(),
  joined_at: z.string().trim().optional().nullable(),
  /* ผูกบัญชีผู้ใช้เข้ากับคนขับ — null = ยังไม่ผูก (ออฟฟิศกรอกแทนให้) */
  user_id: z.coerce.number().int().positive().optional().nullable(),
})

const statusSchema = z.object({ status: z.enum(DRIVER_STATUSES) })

export function driversRoute(db: Database.Database): Router {
  const service = new DriversService(new DriversRepository(db))
  const controller = new DriversController(service)
  const router = Router()

  router.get('/', requireAuth, requirePerm('drivers.view'), controller.list)
  router.get('/available', requireAuth, requirePerm('drivers.view'), controller.listAvailable)
  router.get('/:id', requireAuth, requirePerm('drivers.view'), controller.getById)
  router.post('/', requireAuth, requirePerm('drivers.write'), validate({ body: driverSchema }), controller.create)
  router.put('/:id', requireAuth, requirePerm('drivers.write'), validate({ body: driverSchema }), controller.update)
  router.patch('/:id/status', requireAuth, requirePerm('drivers.write'), validate({ body: statusSchema }), controller.setStatus)
  router.delete('/:id', requireAuth, requirePerm('drivers.delete'), controller.remove)

  return router
}
