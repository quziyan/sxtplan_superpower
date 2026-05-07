import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
const adminUrl = process.env.DATABASE_ADMIN_URL ?? 'postgres://cnp:cnp_dev@localhost:5433/cnp'

beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

describe('police taxonomy seed', () => {
  test('seed creates 5 vehicle subclasses + 5 task subclasses (idempotent)', async () => {
    const env = { ...process.env, DATABASE_ADMIN_URL: adminUrl }
    const r1 = spawnSync('bun', ['src/seeds/police-taxonomy.ts'], { env, encoding: 'utf8' })
    expect(r1.status).toBe(0)
    const r2 = spawnSync('bun', ['src/seeds/police-taxonomy.ts'], { env, encoding: 'utf8' })
    expect(r2.status).toBe(0)

    const vRows = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM vehicle_classes
      WHERE level = 2 AND parent_id IN (SELECT id FROM vehicle_classes WHERE name = '警务车辆' AND level = 1)
    `)
    expect(Number((vRows[0] as any).n)).toBe(5)

    const tRows = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM task_classes
      WHERE level = 2 AND parent_id IN (SELECT id FROM task_classes WHERE name = '警务执法' AND level = 1)
    `)
    expect(Number((tRows[0] as any).n)).toBe(5)

    // tag idempotency: 3 tags x 5 vehicle subclasses = 15
    const vTagRows = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM vehicle_edge_tags
      WHERE vehicle_class_id IN (
        SELECT id FROM vehicle_classes
        WHERE level = 2 AND parent_id IN (SELECT id FROM vehicle_classes WHERE name = '警务车辆' AND level = 1)
      )
    `)
    expect(Number((vTagRows[0] as any).n)).toBe(15)
  }, 30000)
})
