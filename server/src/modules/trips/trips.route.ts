import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { TRIP_STATUSES } from '../../core/constants.js'
import { TripsController } from './trips.controller.js'
import { TripsService } from './trips.service.js'
import { TripsRepository } from './trips.repository.js'
import { OrdersRepository } from '../orders/orders.repository.js'
import { VehiclesRepository } from '../vehicles/vehicles.repository.js'
import { DriversRepository } from '../drivers/drivers.repository.js'
import type Database from 'better-sqlite3'

const createTripSchema = z.object({
  vehicle_id: z.coerce.number().int().positive(),
  driver_id: z.coerce.number().int().positive(),
  order_ids: z.array(z.coerce.number().int().positive()).min(1, 'เลือกอย่างน้อย 1 ออเดอร์'),
  notes: z.string().trim().max(500).optional().nullable(),
})

const orderIdsSchema = z.object({
  order_ids: z.array(z.coerce.number().int().positive()).min(1, 'เลือกอย่างน้อย 1 ออเดอร์'),
})

const costSchema = z.object({
  fuel_cost: z.coerce.number().int().min(0).optional(),
  toll_cost: z.coerce.number().int().min(0).optional(),
  other_cost: z.coerce.number().int().min(0).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
})

export function tripsRoute(db: Database.Database): Router {
  const service = new TripsService(
    db,
    new TripsRepository(db),
    new OrdersRepository(db),
    new VehiclesRepository(db),
    new DriversRepository(db),
  )
  const controller = new TripsController(service)
  const router = Router()

  router.get('/', requireAuth, requirePerm('dispatch.view'), controller.list)
  router.get('/board', requireAuth, requirePerm('dispatch.view'), controller.board)
  router.get('/:id', requireAuth, requirePerm('dispatch.view'), controller.getById)
  router.post('/', requireAuth, requirePerm('dispatch.write'), validate({ body: createTripSchema }), controller.create)
  router.post('/:id/orders', requireAuth, requirePerm('dispatch.write'), validate({ body: orderIdsSchema }), controller.addOrders)
  router.delete('/:id/orders/:orderId', requireAuth, requirePerm('dispatch.write'), controller.removeOrder)
  router.post('/:id/start', requireAuth, requirePerm('dispatch.write'), controller.start)
  router.post('/:id/complete', requireAuth, requirePerm('dispatch.write'), controller.complete)
  router.post('/:id/cancel', requireAuth, requirePerm('dispatch.write'), controller.cancel)
  router.patch('/:id/costs', requireAuth, requirePerm('dispatch.write'), validate({ body: costSchema }), controller.updateCosts)

  return router
}
