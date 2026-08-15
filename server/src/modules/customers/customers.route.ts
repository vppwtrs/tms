import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { CUSTOMER_SEGMENTS, INTERACTION_TYPES } from '../../core/constants.js'
import { CustomersController } from './customers.controller.js'
import { CustomersService } from './customers.service.js'
import { CustomersRepository } from './customers.repository.js'
import type Database from 'better-sqlite3'

const customerSchema = z.object({
  name: z.string().trim().min(1, 'ระบุชื่อลูกค้า').max(200),
  contact_person: z.string().trim().max(100).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email('อีเมลไม่ถูกต้อง').max(200).optional().nullable().or(z.literal('')),
  address: z.string().trim().max(500).optional().nullable(),
  segment: z.enum(CUSTOMER_SEGMENTS).optional().default('B'),
  tax_id: z.string().trim().max(30).optional().nullable(),
  credit_terms: z.coerce.number().int().min(0).max(365).optional().nullable(),
  tags: z.string().trim().max(200).optional().nullable(),
  price_note: z.string().trim().max(500).optional().nullable(),
})

const interactionSchema = z.object({
  type: z.enum(INTERACTION_TYPES, { message: 'ประเภทการติดต่อไม่ถูกต้อง' }),
  subject: z.string().trim().min(1, 'ระบุหัวข้อการติดต่อ').max(200),
  note: z.string().trim().max(1000).optional().nullable(),
  happened_at: z.string().min(1, 'ระบุวันเวลาที่ติดต่อ'),
})

const taskSchema = z.object({
  title: z.string().trim().min(1, 'ระบุชื่องานติดตาม').max(200),
  due_at: z.string().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
})

const taskStatusSchema = z.object({
  status: z.enum(['pending', 'done'], { message: 'สถานะงานไม่ถูกต้อง' }),
})

export function customersRoute(db: Database.Database): Router {
  const service = new CustomersService(new CustomersRepository(db))
  const controller = new CustomersController(service)
  const router = Router()

  router.get('/', requireAuth, requirePerm('customers.view'), controller.list)
  router.get('/all', requireAuth, requirePerm('customers.view'), controller.listAll)
  router.get('/:id/detail', requireAuth, requirePerm('customers.view'), controller.getDetail)

  router.get('/:id/interactions', requireAuth, requirePerm('customers.view'), controller.listInteractions)
  router.post('/:id/interactions', requireAuth, requirePerm('customers.write'), validate({ body: interactionSchema }), controller.createInteraction)
  router.delete('/:id/interactions/:interactionId', requireAuth, requirePerm('customers.write'), controller.removeInteraction)

  router.get('/:id/tasks', requireAuth, requirePerm('customers.view'), controller.listTasks)
  router.post('/:id/tasks', requireAuth, requirePerm('customers.write'), validate({ body: taskSchema }), controller.createTask)
  router.patch('/:id/tasks/:taskId/status', requireAuth, requirePerm('customers.write'), validate({ body: taskStatusSchema }), controller.setTaskStatus)
  router.delete('/:id/tasks/:taskId', requireAuth, requirePerm('customers.write'), controller.removeTask)

  router.get('/:id', requireAuth, requirePerm('customers.view'), controller.getById)
  router.post('/', requireAuth, requirePerm('customers.write'), validate({ body: customerSchema }), controller.create)
  router.put('/:id', requireAuth, requirePerm('customers.write'), validate({ body: customerSchema }), controller.update)
  router.delete('/:id', requireAuth, requirePerm('customers.delete'), controller.remove)

  return router
}
