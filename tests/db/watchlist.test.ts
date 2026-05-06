import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { taskCards, watchLists } from '@/db/schema/watchlist'
import { hashPassword } from '@/auth/password'
import { users } from '@/db/schema/user'
import { vehicleClasses, taskClasses } from '@/db/schema/taxonomy'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

describe('watchlist + taskcard', () => {
  test('insert watchlist and taskcard', async () => {
    const { db } = ctx
    const stamp = Date.now()
    const reg = (await db.execute<{ id: string; version: number }>(sql`
      INSERT INTO regions (kind, name, version, geom)
      VALUES ('AD_HOC', ${`wl-${stamp}`}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
      RETURNING id, version
    `))[0]!
    const [vc] = await db.insert(vehicleClasses).values({ name: `vc-${stamp}`, level: 1 }).returning()
    const [tc] = await db.insert(taskClasses).values({ name: `tc-${stamp}`, level: 1 }).returning()
    const [u] = await db.insert(users).values({
      email: `wl+${stamp}@x`, passwordHash: await hashPassword('p'),
    }).returning()

    const [wl] = await db.insert(watchLists).values({
      name: `监视清单-${stamp}`,
      vehicleClassId: vc!.id, taskClassId: tc!.id,
      regionId: reg.id, regionVersion: reg.version,
      createdBy: u!.id,
    }).returning()
    expect(wl!.isActive).toBe(true)
    expect(wl!.kRangeMin).toBe(1)
    expect(wl!.kRangeMax).toBe(14)

    const [card] = await db.insert(taskCards).values({
      name: `任务卡-${stamp}`,
      vehicleClassId: vc!.id, taskClassId: tc!.id,
      regionId: reg.id, regionVersion: reg.version,
      targetWindowDate: new Date('2026-05-15'),
      targetWindowHalf: 'AM',
      createdBy: u!.id,
    }).returning()
    expect(card!.targetWindowHalf).toBe('AM')
  })
})
