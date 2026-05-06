import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { spawnSync } from 'node:child_process'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
const fixtureDir = '/tmp/cnp-region-seed-fixture'

beforeAll(async () => {
  ctx = await createTestDb()
  await mkdir(fixtureDir, { recursive: true })
  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'TEST_COUNTRY', adcode: '000000', level: 1 },
        geometry: { type: 'Polygon', coordinates: [[[100, 20], [120, 20], [120, 40], [100, 40], [100, 20]]] } },
      { type: 'Feature', properties: { name: 'TEST_PROVINCE', adcode: '110000', level: 2, parent_adcode: '000000' },
        geometry: { type: 'Polygon', coordinates: [[[105, 25], [115, 25], [115, 35], [105, 35], [105, 25]]] } },
    ],
  }
  await writeFile(`${fixtureDir}/admin.geojson`, JSON.stringify(fc))
})
afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
  await ctx.cleanup()
})

describe('region seed', () => {
  test('seed inserts and is idempotent', async () => {
    const run = () => spawnSync('bun', ['src/modules/region/seed.ts', `${fixtureDir}/admin.geojson`], {
      env: process.env, encoding: 'utf8',
    })
    const r1 = run()
    if (r1.status !== 0) { console.error('seed run 1 stderr:', r1.stderr) }
    expect(r1.status).toBe(0)
    const r2 = run()
    if (r2.status !== 0) { console.error('seed run 2 stderr:', r2.stderr) }
    expect(r2.status).toBe(0) // idempotent

    const result = await ctx.db.execute(sql`SELECT COUNT(*)::int AS n FROM regions WHERE name LIKE 'TEST_%'`)
    expect((result[0] as { n: number }).n).toBe(2) // not duplicated
  }, 30000) // 30s timeout for spawnSync
})
