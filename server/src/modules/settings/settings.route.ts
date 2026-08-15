import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'
import { SettingsController } from './settings.controller.js'
import { SettingsService } from './settings.service.js'
import { SettingsRepository } from './settings.repository.js'
import type Database from 'better-sqlite3'

const updateSchema = z.object({
  org_name: z.string().trim().min(1, 'ระบุชื่อองค์กร').max(200).optional(),
  currency_code: z.string().trim().min(3).max(8).optional(),
  currency_symbol: z.string().trim().min(1).max(8).optional(),
})

export function settingsRoute(db: Database.Database): Router {
  const controller = new SettingsController(new SettingsService(new SettingsRepository(db)))
  const router = Router()

  router.get('/', requireAuth, controller.get)
  router.put('/', requireAuth, requirePerm('settings.manage'), validate({ body: updateSchema }), controller.update)

  return router
}
