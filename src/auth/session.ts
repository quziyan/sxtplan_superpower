import { and, eq, gt } from 'drizzle-orm'
import type { Db } from '@/db/client'
import { sessions, type Session } from '@/db/schema/user'

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7d

export async function createSession(db: Db, userId: string, ttlMs = DEFAULT_TTL_MS): Promise<Session> {
  const expiresAt = new Date(Date.now() + ttlMs)
  const [s] = await db.insert(sessions).values({ userId, expiresAt }).returning()
  return s!
}

export async function getSession(db: Db, id: string): Promise<Session | null> {
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
  return s ?? null
}

export async function destroySession(db: Db, id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id))
}

export async function setActiveRole(db: Db, sessionId: string, roleKey: string | null): Promise<void> {
  await db.update(sessions).set({ activeRoleKey: roleKey }).where(eq(sessions.id, sessionId))
}
