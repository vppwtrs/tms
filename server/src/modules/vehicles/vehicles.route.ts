import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { VEHICLE_STATUSES, VEHICLE_TYPES } from '../../core/constants.js'
import { VehiclesController } from './vehicles.controller.js'
import { VehiclesService } from './vehicles.service.js'
import { VehiclesRepository } from './vehicles.repository.js'
import type Database from 'better-sqlite3'

const vehicleSchema = z.object({
  plate_no: z.string().trim().min(1, 'ระบุเลขทะเบียน').max(20),
  brand: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(60).optional().nullable(),
  vehicle_type: z.enum(VEHICLE_TYPES),
  capacity_kg: z.coerce.number().int().min(1, 'ความจุต้องมากกว่า 0').max(100000),
})

const statusSchema = z.object({ status: z.enum(VEHICLE_STATUSES) })

export function vehiclesRoute(db: Database.Database): Router {
  const service = new VehiclesService(new VehiclesRepository(db))
  const controller = new VehiclesController(service)
  const router = Router()

  router.get('/', requireAuth, requirePerm('vehicles.view'), controller.list)
  router.get('/available', requireAuth, requirePerm('vehicles.view'), controller.listAvailable)
  router.get('/:id', requireAuth, requirePerm('vehicles.view'), controller.getById)
  router.post('/', requireAuth, requirePerm('vehicles.write'), validate({ body: vehicleSchema }), controller.create)
  router.put('/:id', requireAuth, requirePerm('vehicles.write'), validate({ body: vehicleSchema }), controller.update)
  router.patch('/:id/status', requireAuth, requirePerm('vehicles.write'), validate({ body: statusSchema }), controller.setStatus)
  router.delete('/:id', requireAuth, requirePerm('vehicles.delete'), controller.remove)

  return router
}
