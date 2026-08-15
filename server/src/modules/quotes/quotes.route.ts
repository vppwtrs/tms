import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { QUOTE_STATUSES } from '../../core/constants.js'
import { QuotesController } from './quotes.controller.js'
import { QuotesService } from './quotes.service.js'
import { QuotesRepository } from './quotes.repository.js'
import type Database from 'better-sqlite3'

const quoteSchema = z.object({
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  origin: z.string().trim().min(1, 'ระบุต้นทาง').max(200),
  destination: z.string().trim().min(1, 'ระบุปลายทาง').max(200),
  distance_km: z.coerce.number().int().min(0).max(5000),
  goods_desc: z.string().trim().min(1, 'ระบุรายละเอียดสินค้า').max(300),
  weight_kg: z.coerce.number().int().min(0, 'น้ำหนักต้องไม่ติดลบ').max(100000),
  fee: z.coerce.number().int().min(0, 'ค่าขนส่งต้องไม่ติดลบ').max(100_000_000),
  status: z.enum(QUOTE_STATUSES).optional(),
  valid_until: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
})

const statusSchema = z.object({
  status: z.enum(QUOTE_STATUSES, { message: 'สถานะใบเสนอราคาไม่ถูกต้อง' }),
})

const convertSchema = z.object({
  scheduled_at: z.string().min(1, 'ระบุกำหนดส่งก่อนแปลงเป็นออเดอร์'),
  notes: z.string().trim().max(500).optional().nullable(),
})

export function quotesRoute(db: Database.Database): Router {
  const service = new QuotesService(new QuotesRepository(db), db)
  const controller = new QuotesController(service)
  const router = Router()

  router.get('/', requireAuth, requirePerm('quotes.view'), controller.list)
  router.get('/by-customer/:customerId', requireAuth, requirePerm('quotes.view'), controller.listByCustomer)
  router.get('/:id', requireAuth, requirePerm('quotes.view'), controller.getById)
  router.post('/', requireAuth, requirePerm('quotes.write'), validate({ body: quoteSchema }), controller.create)
  router.put('/:id', requireAuth, requirePerm('quotes.write'), validate({ body: quoteSchema }), controller.update)
  router.patch('/:id/status', requireAuth, requirePerm('quotes.write'), validate({ body: statusSchema }), controller.setStatus)
  router.post('/:id/convert', requireAuth, requirePerm('quotes.convert'), validate({ body: convertSchema }), controller.convertToOrder)

  return router
}
