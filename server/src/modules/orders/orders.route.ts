import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { PRIORITIES } from '../../core/constants.js'
import { OrdersController } from './orders.controller.js'
import { OrdersService } from './orders.service.js'
import { OrdersRepository } from './orders.repository.js'
import { SettingsRepository } from '../settings/settings.repository.js'
import type Database from 'better-sqlite3'

const orderSchema = z.object({
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  origin: z.string().trim().min(1, 'ระบุต้นทาง').max(200),
  destination: z.string().trim().min(1, 'ระบุปลายทาง').max(200),
  distance_km: z.coerce.number().int().min(0).max(5000),
  goods_desc: z.string().trim().min(1, 'ระบุรายละเอียดสินค้า').max(300),
  weight_kg: z.coerce.number().int().min(0, 'น้ำหนักต้องไม่ติดลบ').max(100000),
  fee: z.coerce.number().int().min(0).max(100_000_000),
  priority: z.enum(PRIORITIES).optional().default('normal'),
  scheduled_at: z.string().min(1, 'ระบุกำหนดส่ง'),
  notes: z.string().trim().max(500).optional().nullable(),
})

export function ordersRoute(db: Database.Database): Router {
  const service = new OrdersService(new OrdersRepository(db), new SettingsRepository(db))
  const controller = new OrdersController(service)
  const router = Router()

  router.get('/', requireAuth, requirePerm('orders.view'), controller.list)
  router.get('/pending-unassigned', requireAuth, requirePerm('orders.view'), controller.pendingUnassigned)
  router.get('/:id/bol', requireAuth, requirePerm('orders.view'), controller.bol)
  router.get('/:id', requireAuth, requirePerm('orders.view'), controller.getById)
  router.post('/', requireAuth, requirePerm('orders.write'), validate({ body: orderSchema }), controller.create)
  router.put('/:id', requireAuth, requirePerm('orders.write'), validate({ body: orderSchema }), controller.update)
  router.post('/:id/cancel', requireAuth, requirePerm('orders.cancel'), controller.cancel)

  return router
}
