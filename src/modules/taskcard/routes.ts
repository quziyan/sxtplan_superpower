import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Db } from '@/db/client'
import { authRequired, type AuthContext } from '@/auth/middleware'
import { createTaskCard, getTaskCard, listTaskCards } from './service'
import { NotFound } from '@/lib/errors'

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  vehicleClassId: z.string().uuid(),
  taskClassId: z.string().uuid(),
  regionId: z.string().uuid(),
  regionVersion: z.number().int().positive(),
  targetWindowDate: z.string(), // ISO date string
  targetWindowHalf: z.enum(['AM', 'PM']),
})

type Vars = { auth: AuthContext }

export function taskcardRoutes(db: Db) {
  const app = new Hono<{ Variables: Vars }>()

  app.get('/', authRequired(db), async (c) => c.json(await listTaskCards(db)))

  app.post('/', authRequired(db), zValidator('json', createSchema), async (c) => {
    const auth = c.get('auth')
    const body = c.req.valid('json')
    const input: import('./service').CreateTaskCardInput = {
      name: body.name,
      vehicleClassId: body.vehicleClassId,
      taskClassId: body.taskClassId,
      regionId: body.regionId,
      regionVersion: body.regionVersion,
      targetWindowDate: new Date(body.targetWindowDate),
      targetWindowHalf: body.targetWindowHalf,
      createdBy: auth.user.id,
    }
    if (body.description !== undefined) input.description = body.description
    const card = await createTaskCard(db, input)
    return c.json(card, 201)
  })

  app.get('/:id', authRequired(db), async (c) => {
    const card = await getTaskCard(db, c.req.param('id'))
    if (!card) throw NotFound(`taskcard ${c.req.param('id')} not found`)
    return c.json(card)
  })

  return app
}
