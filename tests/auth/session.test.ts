import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createSession, destroySession, getSession, setActiveRole } from '@/auth/session'
import { users } from '@/db/schema/user'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
let userId: string

beforeAll(async () => {
  ctx = await createTestDb()
  const [u] = await ctx.db.insert(users).values({
    email: `s+${Date.now()}@x`, passwordHash: 'x',
  }).returning()
  userId = u!.id
})
afterAll(async () => { await ctx.cleanup() })

describe('session', () => {
  test('create + get + destroy', async () => {
    const s = await createSession(ctx.db, userId)
    expect(s.id).toBeDefined()
    const got = await getSession(ctx.db, s.id)
    expect(got?.userId).toBe(userId)
    await destroySession(ctx.db, s.id)
    expect(await getSession(ctx.db, s.id)).toBeNull()
  })

  test('expired session not returned', async () => {
    const s = await createSession(ctx.db, userId, -1000) // already expired
    expect(await getSession(ctx.db, s.id)).toBeNull()
  })

  test('setActiveRole writes role_state', async () => {
    const s = await createSession(ctx.db, userId)
    await setActiveRole(ctx.db, s.id, 'DECIDER')
    const got = await getSession(ctx.db, s.id)
    expect(got?.activeRoleKey).toBe('DECIDER')
  })
})
