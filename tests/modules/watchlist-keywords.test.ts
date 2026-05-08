import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../helpers/test-db'

describe('watchlist keywords', () => {
  test('createWatchList + keywords field round-trips', async () => {
    const ctx = await createTestDb()
    const regionId = crypto.randomUUID()
    const userId = crypto.randomUUID()

    // Region (用真实 schema:geom,不是 polygon)
    await ctx.db.execute(sql`
      INSERT INTO regions(id, version, kind, name, geom, effective_from)
      VALUES(${regionId}::uuid, 1, 'AD_HOC', ${'KW_REG_' + Date.now()},
        ST_GeomFromGeoJSON(${'{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}'}), NOW())
    `)
    // V/T classes (drizzle inserts via schema modules to handle level + no-code-column)
    const { vehicleClasses, taskClasses } = await import('@/db/schema/taxonomy')
    const [vc] = await ctx.db.insert(vehicleClasses).values({ name: 'KWVC ' + Date.now(), level: 1 }).returning()
    const [tc] = await ctx.db.insert(taskClasses).values({ name: 'KWTC ' + Date.now(), level: 1 }).returning()
    // User
    await ctx.db.execute(sql`
      INSERT INTO users(id, email, password_hash, display_name)
      VALUES(${userId}::uuid, ${'kw-svc-' + Date.now() + '@x.com'}, 'x', 'svc')
      ON CONFLICT DO NOTHING
    `)

    const { createWatchList, updateWatchListKeywords } = await import('@/modules/watchlist/service')
    const wl = await createWatchList(ctx.db, {
      name: 'KW Test ' + Date.now(),
      vehicleClassId: vc!.id,
      taskClassId: tc!.id,
      regionId,
      regionVersion: 1,
      keywords: ['防暴', '安保'],
      createdBy: userId,
    })
    expect(wl.keywords).toEqual(['防暴', '安保'])

    const updated = await updateWatchListKeywords(ctx.db, {
      id: wl.id,
      keywords: ['防暴', '安保', '专项整治'],
    })
    expect(updated.keywords).toEqual(['防暴', '安保', '专项整治'])

    const empty = await createWatchList(ctx.db, {
      name: 'KW Empty ' + Date.now(),
      vehicleClassId: vc!.id,
      taskClassId: tc!.id,
      regionId,
      regionVersion: 1,
      createdBy: userId,
    })
    expect(empty.keywords).toEqual([])

    await ctx.cleanup()
  })

  test('updateWatchListKeywords throws when watchlist not found', async () => {
    const ctx = await createTestDb()
    const { updateWatchListKeywords } = await import('@/modules/watchlist/service')
    const fakeId = crypto.randomUUID()
    await expect(
      updateWatchListKeywords(ctx.db, { id: fakeId, keywords: ['x'] })
    ).rejects.toThrow(/not found/)
    await ctx.cleanup()
  })
})
