import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Db } from '@/db/client'
import { authRequired, roleRequired, type AuthContext } from '@/auth/middleware'
import { BadRequest, NotFound } from '@/lib/errors'
import {
  attachTaskEdgeTag, attachVehicleEdgeTag,
  createTaskClass, createVehicleClass,
  listTaskClasses, listVehicleClasses,
  updateVehicleClass, deleteVehicleClass,
  listFollowedVehicleClasses, followVehicleClass, unfollowVehicleClass,
} from './service'

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

  // Plan-PP: vehicle class CRUD — ADMIN only
  app.post('/vehicles', authRequired(db), roleRequired('ADMIN'),
    zValidator('json', classSchema), async (c) => {
      const { name, level, parentId, description } = c.req.valid('json')
      if (level === 2 && !parentId) throw BadRequest('level=2 必须提供 parentId')
      if (level === 1 && parentId) throw BadRequest('level=1 不应提供 parentId')
      const input: { name: string; level: 1 | 2; parentId?: string; description?: string } = { name, level }
      if (parentId !== undefined) input.parentId = parentId
      if (description !== undefined) input.description = description
      return c.json(await createVehicleClass(db, input), 201)
    },
  )
  app.patch('/vehicles/:id', authRequired(db), roleRequired('ADMIN'),
    zValidator('json', z.object({
      name: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
    })), async (c) => {
      const body = c.req.valid('json')
      const patch: { name?: string; description?: string | null } = {}
      if (body.name !== undefined) patch.name = body.name
      if (body.description !== undefined) patch.description = body.description
      const r = await updateVehicleClass(db, c.req.param('id'), patch)
      if (!r) throw NotFound(`vehicle class ${c.req.param('id')} not found`)
      return c.json(r)
    },
  )
  app.delete('/vehicles/:id', authRequired(db), roleRequired('ADMIN'), async (c) => {
    const r = await deleteVehicleClass(db, c.req.param('id'))
    if (!r.deleted) {
      if (r.reason === 'has-children') {
        return c.json({ error: { code: 'HAS_CHILDREN', message: '该 V 节点有子分类,请先删子节点' } }, 409)
      }
      throw NotFound(`vehicle class ${c.req.param('id')} not found`)
    }
    return c.json({ ok: true, id: c.req.param('id') })
  })
  app.post('/vehicles/:id/tags', authRequired(db), zValidator('json', tagSchema), async (c) => {
    const auth = c.get('auth')
    return c.json(await attachVehicleEdgeTag(db, c.req.param('id'), c.req.valid('json').tag, auth.user.id), 201)
  })

  // ── Plan-PP: per-user followed vehicle classes ──────────────────────
  app.get('/me/followed-vehicles', authRequired(db), async (c) => {
    const auth = c.get('auth')
    const ids = await listFollowedVehicleClasses(db, auth.user.id)
    return c.json({ ids })
  })
  app.post('/me/followed-vehicles/:id', authRequired(db), async (c) => {
    const auth = c.get('auth')
    await followVehicleClass(db, auth.user.id, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.delete('/me/followed-vehicles/:id', authRequired(db), async (c) => {
    const auth = c.get('auth')
    await unfollowVehicleClass(db, auth.user.id, c.req.param('id'))
    return c.json({ ok: true })
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
