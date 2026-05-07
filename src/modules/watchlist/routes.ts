import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Db } from '@/db/client'
import { authRequired, type AuthContext } from '@/auth/middleware'
import { createWatchList, getWatchList, listWatchLists, setWatchListActive } from './service'
import { NotFound } from '@/lib/errors'

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  vehicleClassId: z.string().uuid(),
  taskClassId: z.string().uuid(),
  regionId: z.string().uuid(),
  regionVersion: z.number().int().positive(),
  kRangeMin: z.number().int().positive().optional(),
  kRangeMax: z.number().int().positive().optional(),
})

const setActiveSchema = z.object({ isActive: z.boolean() })

type Vars = { auth: AuthContext }

export function watchlistRoutes(db: Db) {
  const app = new Hono<{ Variables: Vars }>()

  app.get('/', authRequired(db), async (c) => {
    const activeOnly = c.req.query('active') === 'true'
    return c.json(await listWatchLists(db, { activeOnly }))
  })

  app.post('/', authRequired(db), zValidator('json', createSchema), async (c) => {
    const auth = c.get('auth')
    const body = c.req.valid('json')
    const input: import('./service').CreateWatchListInput = {
      name: body.name,
      vehicleClassId: body.vehicleClassId,
      taskClassId: body.taskClassId,
      regionId: body.regionId,
      regionVersion: body.regionVersion,
      createdBy: auth.user.id,
    }
    if (body.description !== undefined) input.description = body.description
    if (body.kRangeMin !== undefined) input.kRangeMin = body.kRangeMin
    if (body.kRangeMax !== undefined) input.kRangeMax = body.kRangeMax
    const wl = await createWatchList(db, input)
    return c.json(wl, 201)
  })

  app.get('/:id', authRequired(db), async (c) => {
    const wl = await getWatchList(db, c.req.param('id'))
    if (!wl) throw NotFound(`watchlist ${c.req.param('id')} not found`)
    return c.json(wl)
  })

  app.patch('/:id/active', authRequired(db), zValidator('json', setActiveSchema), async (c) => {
    const wl = await setWatchListActive(db, c.req.param('id'), c.req.valid('json').isActive)
    return c.json(wl)
  })

  return app
}
