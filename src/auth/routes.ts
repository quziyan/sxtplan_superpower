import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { loadEnv } from '@/env'
import type { Db } from '@/db/client'
import { users } from '@/db/schema/user'
import { verifyPassword } from './password'
import { createSession, destroySession, setActiveRole } from './session'
import { signValue } from './cookie'
import { authRequired, type AuthContext } from './middleware'
import { Unauthorized, BadRequest } from '@/lib/errors'

const loginSchema = z.object({ email: z.string().min(3).includes('@'), password: z.string().min(1) })
const roleStateSchema = z.object({ roleKey: z.enum(['DECIDER', 'ANALYST', 'REVIEWER']).nullable() })

type Vars = { auth: AuthContext }

export function authRoutes(db: Db) {
  const app = new Hono<{ Variables: Vars }>()

  app.post('/login', zValidator('json', loginSchema), async (c) => {
    const env = loadEnv()
    const { email, password } = c.req.valid('json')
    const [u] = await db.select().from(users).where(eq(users.email, email))
    if (!u || !u.isActive) throw Unauthorized('invalid credentials')
    if (!(await verifyPassword(password, u.passwordHash))) throw Unauthorized('invalid credentials')
    const session = await createSession(db, u.id)
    const signed = signValue(session.id, env.SESSION_SECRET)
    setCookie(c, 'session', signed, {
      httpOnly: true, sameSite: 'Lax', path: '/',
      secure: env.NODE_ENV === 'production',
      domain: env.COOKIE_DOMAIN,
      maxAge: 7 * 24 * 60 * 60,
    })
    return c.json({ ok: true, userId: u.id })
  })

  app.post('/logout', authRequired(db), async (c) => {
    const auth = c.get('auth') as AuthContext
    await destroySession(db, auth.sessionId)
    deleteCookie(c, 'session', { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/me', authRequired(db), async (c) => {
    const auth = c.get('auth') as AuthContext
    return c.json(auth)
  })

  app.post('/role-state', authRequired(db), zValidator('json', roleStateSchema), async (c) => {
    const auth = c.get('auth') as AuthContext
    const { roleKey } = c.req.valid('json')
    if (roleKey !== null && !auth.availableRoles.includes(roleKey)) {
      throw BadRequest(`user lacks role ${roleKey}`)
    }
    await setActiveRole(db, auth.sessionId, roleKey)
    return c.json({ ok: true, activeRoleKey: roleKey })
  })

  return app
}
