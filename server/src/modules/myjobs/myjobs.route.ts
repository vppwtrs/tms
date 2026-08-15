import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requirePerm } from '../../middleware/auth.js'
import { uploadPhoto } from '../../middleware/upload.js'
import { validate } from '../../middleware/validate.js'
import { MyJobsController } from './myjobs.controller.js'
import { MyJobsService } from './myjobs.service.js'
import { MyJobsRepository } from './myjobs.repository.js'
import { TripsService } from '../trips/trips.service.js'
import { TripsRepository } from '../trips/trips.repository.js'
import { PodService } from '../pod/pod.service.js'
import { PodRepository } from '../pod/pod.repository.js'
import { OrdersRepository } from '../orders/orders.repository.js'
import { VehiclesRepository } from '../vehicles/vehicles.repository.js'
import { DriversRepository } from '../drivers/drivers.repository.js'
import type Database from 'better-sqlite3'

/* POD จากมือถือรับได้สองแบบบน endpoint เดียวกัน:
     • JSON        — ลายเซ็นอย่างเดียว (เหมือนเดิม ของเก่าไม่พัง)
     • multipart   — ลายเซ็น + รูปถ่ายหน้างาน field ชื่อ `photo`
   ฝั่งเว็บถ่ายด้วยกล้องในหน้าเว็บแล้วบีบเหลือ ~300KB ก่อนส่ง จึงส่งผ่าน 4G ได้
   โดยไม่ต้องรอกลับมาแนบที่ออฟฟิศ */
const podSchema = z.object({
  order_id: z.coerce.number().int().positive(),
  recipient_name: z.string().trim().min(1, 'ระบุชื่อผู้รับสินค้า').max(150),
  signature_data: z.string().min(1, 'ลายเซ็นว่างเปล่า'),
  notes: z.string().trim().max(500).optional().nullable(),
  lat: z.coerce.number().min(-90).max(90).optional().nullable(),
  lng: z.coerce.number().min(-180).max(180).optional().nullable(),
})

export function myJobsRoute(db: Database.Database): Router {
  const trips = new TripsService(
    db,
    new TripsRepository(db),
    new OrdersRepository(db),
    new VehiclesRepository(db),
    new DriversRepository(db),
  )
  const pod = new PodService(new PodRepository(db), new OrdersRepository(db))
  const service = new MyJobsService(new MyJobsRepository(db), trips, pod)
  const controller = new MyJobsController(service)
  const router = Router()

  router.get('/', requireAuth, requirePerm('myjobs.view'), controller.list)
  router.post('/:id/start', requireAuth, requirePerm('myjobs.progress'), controller.start)
  router.post('/:id/complete', requireAuth, requirePerm('myjobs.progress'), controller.complete)
  /* ปิดทีละจุด — path ขึ้นต้นด้วย /orders/ ไม่ใช่ /:id/ เพราะพารามิเตอร์เป็นเลขออเดอร์
     ไม่ใช่เลขเที่ยว ถ้าใช้รูปแบบเดียวกันจะสับสนตอนอ่าน log */
  router.post('/orders/:id/deliver', requireAuth, requirePerm('myjobs.progress'), controller.deliverOrder)
  router.post(
    '/pod',
    requireAuth,
    requirePerm('myjobs.pod'),
    uploadPhoto(),
    validate({ body: podSchema }),
    controller.createPod,
  )

  return router
}
