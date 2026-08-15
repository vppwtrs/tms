import { Router } from 'express'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { DashboardController } from './dashboard.controller.js'
import { DashboardService } from './dashboard.service.js'
import { DashboardRepository } from './dashboard.repository.js'
import type Database from 'better-sqlite3'

export function dashboardRoute(db: Database.Database): Router {
  const controller = new DashboardController(new DashboardService(new DashboardRepository(db)))
  const router = Router()
  router.get('/summary', requireAuth, requirePerm('dashboard.view'), controller.summary)
  return router
}
