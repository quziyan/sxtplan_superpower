import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { eq } from 'drizzle-orm'
import { loadEnv } from '@/env'
import type { Db } from '@/db/client'
import { users, userRoles, roles } from '@/db/schema/user'
import { getSession } from './session'
import { verifyValue } from './cookie'
import { Unauthorized } from '@/lib/errors'

export type AuthContext = {
  user: { id: string; email: string; displayName: string | null }
  sessionId: string
  activeRoleKey: string | null
  availableRoles: string[]
}

export function authRequired(db: Db): MiddlewareHandler {
  return async (c, next) => {
    const env = loadEnv()
    const raw = getCookie(c, 'session')
    if (!raw) throw Unauthorized()
    const sessionId = verifyValue(raw, env.SESSION_SECRET)
    if (!sessionId) throw Unauthorized()
    const session = await getSession(db, sessionId)
    if (!session) throw Unauthorized()
    const [u] = await db.select().from(users).where(eq(users.id, session.userId))
    if (!u || !u.isActive) throw Unauthorized()
    const userRoleRows = await db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, u.id))
    c.set('auth', {
      user: { id: u.id, email: u.email, displayName: u.displayName },
      sessionId,
      activeRoleKey: session.activeRoleKey,
      availableRoles: userRoleRows.map((r) => r.key),
    } satisfies AuthContext)
    await next()
  }
}

export function roleRequired(...allowed: string[]): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) throw Unauthorized()
    if (!auth.activeRoleKey || !allowed.includes(auth.activeRoleKey)) {
      throw Unauthorized(`requires role(s): ${allowed.join('|')}`)
    }
    await next()
  }
}
