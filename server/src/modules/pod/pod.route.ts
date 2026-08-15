import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { uploadPhoto } from '../../middleware/upload.js'
import { validate } from '../../middleware/validate.js'
import { PodController } from './pod.controller.js'
import { PodService } from './pod.service.js'
import { PodRepository } from './pod.repository.js'
import { OrdersRepository } from '../orders/orders.repository.js'
import type Database from 'better-sqlite3'

const uploadSingle = uploadPhoto()

const createSchema = z.object({
  order_id: z.coerce.number().int().positive(),
  recipient_name: z.string().trim().min(1, 'ระบุชื่อผู้รับสินค้า').max(150),
  signature_data: z.string().min(1, 'ลายเซ็นว่างเปล่า'),
  notes: z.string().trim().max(500).optional().nullable(),
  lat: z.coerce.number().min(-90).max(90).optional().nullable(),
  lng: z.coerce.number().min(-180).max(180).optional().nullable(),
})

const updateSchema = z.object({
  recipient_name: z.string().trim().min(1, 'ระบุชื่อผู้รับสินค้า').max(150).optional(),
  signature_data: z.string().min(1).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
  lat: z.coerce.number().min(-90).max(90).optional().nullable(),
  lng: z.coerce.number().min(-180).max(180).optional().nullable(),
})

export function podRoute(db: Database.Database): Router {
  const service = new PodService(new PodRepository(db), new OrdersRepository(db))
  const controller = new PodController(service)
  const router = Router()

  router.get('/order/:orderId', requireAuth, requirePerm('pod.view'), controller.getByOrder)
  router.get('/:id', requireAuth, requirePerm('pod.view'), controller.getById)
  router.post('/', requireAuth, requirePerm('pod.write'), uploadSingle, validate({ body: createSchema }), controller.create)
  router.put('/:id', requireAuth, requirePerm('pod.write'), uploadSingle, validate({ body: updateSchema }), controller.update)
  router.patch('/:id/verify', requireAuth, requirePerm('pod.verify'), controller.verify)
  router.get('/:id/photo', requireAuth, requirePerm('pod.view'), controller.photo)

  return router
}
