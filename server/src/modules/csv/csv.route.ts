import { Router } from 'express'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { CsvController } from './csv.controller.js'
import type { CsvStore } from '../../db/csv.js'

export function csvRoute(store: CsvStore): Router {
  const controller = new CsvController(store)
  const router = Router()
  router.get('/status', requireAuth, requirePerm('csv.view'), controller.status)
  router.get('/download/:file', requireAuth, requirePerm('csv.view'), controller.download)
  router.post('/export', requireAuth, requirePerm('csv.export'), controller.exportAll)
  return router
}
