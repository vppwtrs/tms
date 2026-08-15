import { Router } from 'express'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { InsightsController } from './insights.controller.js'
import { InsightsService } from './insights.service.js'
import { InsightsRepository } from './insights.repository.js'
import type Database from 'better-sqlite3'

export function insightsRoute(db: Database.Database): Router {
  const controller = new InsightsController(new InsightsService(new InsightsRepository(db)))
  const router = Router()
  router.get('/daily', requireAuth, requirePerm('dashboard.view'), controller.daily)
  return router
}
