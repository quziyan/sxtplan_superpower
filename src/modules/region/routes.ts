import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Db } from '@/db/client'
import { authRequired, type AuthContext } from '@/auth/middleware'
import { createRegion, getRegion, listRegions, updateAdminRegionGeom } from './service'

const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
})

const createSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ADMIN_NAMED'), name: z.string().min(1), parentId: z.string().uuid().optional(), geom: polygonSchema }),
  z.object({ kind: z.literal('AD_HOC'), name: z.string().optional(), geom: polygonSchema }),
])

const updateSchema = z.object({ geom: polygonSchema, effectiveFrom: z.string().datetime().optional() })

type Vars = { auth: AuthContext }

export function regionRoutes(db: Db) {
  const app = new Hono<{ Variables: Vars }>()

  // List current-effective regions for picker UIs (e.g. NewWatchListModal).
  // Defaults to ADMIN_NAMED only — pass ?kind=ALL to include AD_HOC. Public
  // for read so the analyst SPA can populate dropdowns before role selection.
  app.get('/', async (c) => {
    const kindParam = c.req.query('kind')
    const kind = kindParam === 'ADMIN_NAMED' || kindParam === 'AD_HOC' || kindParam === 'ALL'
      ? kindParam
      : 'ADMIN_NAMED'
    return c.json(await listRegions(db, { kind }))
  })

  app.post('/', authRequired(db), zValidator('json', createSchema), async (c) => {
    const auth = c.get('auth')
    const body = c.req.valid('json')
    const r = await createRegion(db, { ...(body as any), createdBy: auth.user.id })
    return c.json(r, 201)
  })

  app.get('/:id', async (c) => {
    const id = c.req.param('id')
    const versionParam = c.req.query('version')
    const version = versionParam ? Number.parseInt(versionParam, 10) : undefined
    return c.json(await getRegion(db, id, version))
  })

  app.put('/:id', authRequired(db), zValidator('json', updateSchema), async (c) => {
    const auth = c.get('auth')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const updated = await updateAdminRegionGeom(db, {
      id,
      geom: body.geom as GeoJSON.Polygon,
      ...(body.effectiveFrom ? { effectiveFrom: new Date(body.effectiveFrom) } : {}),
      changedBy: auth.user.id,
    })
    return c.json(updated)
  })

  return app
}
