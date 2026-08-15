import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { ReportsController } from './reports.controller.js'
import { ReportsService } from './reports.service.js'
import { ReportsRepository } from './reports.repository.js'
import { PodRepository } from '../pod/pod.repository.js'
import { daysAgo } from '../../utils/helpers.js'
import type Database from 'better-sqlite3'

const querySchema = z.object({
  from: z.string().optional().default(daysAgo(29).toISOString().slice(0, 10)),
  to: z.string().optional().default(new Date().toISOString().slice(0, 10)),
})

export function reportsRoute(db: Database.Database): Router {
  const controller = new ReportsController(new ReportsService(new ReportsRepository(db), new PodRepository(db)))
  const router = Router()
  router.get('/', requireAuth, requirePerm('reports.view'), validate({ query: querySchema }), controller.generate)
  router.get('/export', requireAuth, requirePerm('reports.export'), validate({ query: querySchema }), controller.exportExcel)
  return router
}
