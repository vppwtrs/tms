import express, { type Express } from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { config } from './config.js'
import { errorHandler } from './middleware/errorHandler.js'
import { authRoute } from './modules/auth/auth.route.js'
import { customersRoute } from './modules/customers/customers.route.js'
import { vehiclesRoute } from './modules/vehicles/vehicles.route.js'
import { driversRoute } from './modules/drivers/drivers.route.js'
import { ordersRoute } from './modules/orders/orders.route.js'
import { tripsRoute } from './modules/trips/trips.route.js'
import { dashboardRoute } from './modules/dashboard/dashboard.route.js'
import { reportsRoute } from './modules/reports/reports.route.js'
import { settingsRoute } from './modules/settings/settings.route.js'
import { podRoute } from './modules/pod/pod.route.js'
import { quotesRoute } from './modules/quotes/quotes.route.js'
import { insightsRoute } from './modules/insights/insights.route.js'
import { csvRoute } from './modules/csv/csv.route.js'
import { myJobsRoute } from './modules/myjobs/myjobs.route.js'
import type { CsvStore } from './db/csv.js'
import { initPermissions } from './db/permissions.js'

export function createApp(db: Database.Database, csv?: CsvStore): Express {
  /* ผูก db ให้ที่เก็บสิทธิ์ก่อนสร้าง route — middleware requirePerm() ต้องใช้ */
  initPermissions(db)

  const app = express()
  app.disable('x-powered-by')

  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() })
  })

  // API — แต่ละโมดูลแยก route แยกไฟล์
  app.use('/api/auth', authRoute(db))
  app.use('/api/customers', customersRoute(db))
  app.use('/api/vehicles', vehiclesRoute(db))
  app.use('/api/drivers', driversRoute(db))
  app.use('/api/orders', ordersRoute(db))
  app.use('/api/trips', tripsRoute(db))
  app.use('/api/dashboard', dashboardRoute(db))
  app.use('/api/reports', reportsRoute(db))
  app.use('/api/settings', settingsRoute(db))
  app.use('/api/pod', podRoute(db))
  app.use('/api/quotes', quotesRoute(db))
  app.use('/api/my-jobs', myJobsRoute(db))
  app.use('/api/insights', insightsRoute(db))
  if (csv) app.use('/api/csv', csvRoute(csv))

  // production: เสิร์ฟ frontend ที่ build แล้ว
  const dist = config.webDistPath
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '7d', index: false }))
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(path.join(dist, 'index.html'))
        return
      }
      next()
    })
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบ endpoint นี้' } })
  })

  app.use(errorHandler)
  return app
}
