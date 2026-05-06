import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { users, roles, userRoles, sessions } from '@/db/schema/user'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>

beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

describe('user schemas', () => {
  test('insert user + assign role + create session', async () => {
    const { db } = ctx
    const ts = Date.now()
    const [u] = await db.insert(users).values({
      email: `a-${ts}@example.com`, passwordHash: 'x',
    }).returning()
    expect(u!.id).toBeDefined()

    const [r] = await db.insert(roles).values({ key: `DECIDER_${ts}`, label: '决策者' }).returning()
    await db.insert(userRoles).values({ userId: u!.id, roleId: r!.id })

    const [s] = await db.insert(sessions).values({
      userId: u!.id, expiresAt: new Date(Date.now() + 3600_000),
    }).returning()

    expect(s!.userId).toBe(u!.id)

    const got = await db.select().from(users).where(eq(users.id, u!.id))
    expect(got).toHaveLength(1)
  })
})
