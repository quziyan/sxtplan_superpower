import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Db } from '@/db/client'
import { authRequired, type AuthContext } from '@/auth/middleware'
import { attachTaskEdgeTag, attachVehicleEdgeTag, createTaskClass, createVehicleClass, listTaskClasses, listVehicleClasses } from './service'

const classSchema = z.object({
  name: z.string().min(1),
  level: z.union([z.literal(1), z.literal(2)]),
  parentId: z.string().uuid().optional(),
  description: z.string().optional(),
})
const tagSchema = z.object({ tag: z.string().min(1).max(50) })

type Vars = { auth: AuthContext }

export function taxonomyRoutes(db: Db) {
  const app = new Hono<{ Variables: Vars }>()

  app.get('/vehicles', async (c) => c.json(await listVehicleClasses(db)))
  app.post('/vehicles', authRequired(db), zValidator('json', classSchema), async (c) => {
    const { name, level, parentId, description } = c.req.valid('json')
    const input: { name: string; level: 1 | 2; parentId?: string; description?: string } = { name, level }
    if (parentId !== undefined) input.parentId = parentId
    if (description !== undefined) input.description = description
    return c.json(await createVehicleClass(db, input), 201)
  })
  app.post('/vehicles/:id/tags', authRequired(db), zValidator('json', tagSchema), async (c) => {
    const auth = c.get('auth')
    return c.json(await attachVehicleEdgeTag(db, c.req.param('id'), c.req.valid('json').tag, auth.user.id), 201)
  })

  app.get('/tasks', async (c) => c.json(await listTaskClasses(db)))
  app.post('/tasks', authRequired(db), zValidator('json', classSchema), async (c) => {
    const { name, level, parentId, description } = c.req.valid('json')
    const input: { name: string; level: 1 | 2; parentId?: string; description?: string } = { name, level }
    if (parentId !== undefined) input.parentId = parentId
    if (description !== undefined) input.description = description
    return c.json(await createTaskClass(db, input), 201)
  })
  app.post('/tasks/:id/tags', authRequired(db), zValidator('json', tagSchema), async (c) => {
    const auth = c.get('auth')
    return c.json(await attachTaskEdgeTag(db, c.req.param('id'), c.req.valid('json').tag, auth.user.id), 201)
  })

  return app
}
