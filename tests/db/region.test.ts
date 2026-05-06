import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { regions } from '@/db/schema/region'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const samplePoly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

describe('region schema', () => {
  test('insert ADMIN_NAMED with version=1', async () => {
    const { db } = ctx
    const result = await db.execute(sql`
      INSERT INTO regions (kind, name, version, geom)
      VALUES ('ADMIN_NAMED', ${'测试区-' + Date.now()}, 1, ST_GeomFromGeoJSON(${JSON.stringify(samplePoly)}))
      RETURNING id, kind, name, version
    `)
    expect((result[0] as any).kind).toBe('ADMIN_NAMED')
    expect((result[0] as any).version).toBe(1)
  })

  test('CHECK rejects ADMIN_NAMED without name', async () => {
    const { db } = ctx
    await expect(
      Promise.resolve(
        db.execute(sql`
          INSERT INTO regions (kind, name, geom)
          VALUES ('ADMIN_NAMED', NULL, ST_GeomFromGeoJSON(${JSON.stringify(samplePoly)}))
        `)
      )
    ).rejects.toThrow()
  })

  test('AD_HOC accepts NULL name', async () => {
    const { db } = ctx
    const result = await db.execute(sql`
      INSERT INTO regions (kind, name, geom)
      VALUES ('AD_HOC', NULL, ST_GeomFromGeoJSON(${JSON.stringify(samplePoly)}))
      RETURNING id
    `)
    expect((result[0] as any).id).toBeDefined()
  })
})
