import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { dispatchTasks } from '@/db/schema/dispatch'
import { predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { initAdapterPool, resetAdapterPoolForTests } from '@/dispatch/adapter-pool'
import { resetEnvCacheForTests } from '@/env'
import { computeSignature } from '@/webhook/signature'
import { createTestDb } from '../helpers/test-db'
import { buildTestApp } from '../helpers/test-server'

const SECRET = 'test-secret-32chars-aaaaaaaaaaaa'

const TRIAGE_POLY: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

describe('real-gzp webhook flow', () => {
  let envSnapshot: Record<string, string | undefined>

  beforeEach(() => {
    envSnapshot = {
      CAMERA_BACKEND_KIND: process.env.CAMERA_BACKEND_KIND,
      REAL_GZP_API_KEY: process.env.REAL_GZP_API_KEY,
      REAL_GZP_BACKEND_URL: process.env.REAL_GZP_BACKEND_URL,
      WEBHOOK_HMAC_SECRET: process.env.WEBHOOK_HMAC_SECRET,
    }
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetEnvCacheForTests()
    resetAdapterPoolForTests()
    initAdapterPool()
  })

  test('webhook with real-gzp adapter advances dispatch state SENT → COMPLETED', async () => {
    process.env.CAMERA_BACKEND_KIND = 'real-gzp'
    process.env.REAL_GZP_API_KEY = 'test-key'
    process.env.REAL_GZP_BACKEND_URL = 'https://test.example'
    process.env.WEBHOOK_HMAC_SECRET = SECRET

    resetEnvCacheForTests()
    resetAdapterPoolForTests()
    initAdapterPool()

    const ctx = await createTestDb()
    try {
      const app = buildTestApp(ctx.db)

      // --- Seed: prediction + dispatch_task with adapterKey='real-gzp', state=SENT
      const label = `real-gzp-wh-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const reg = (
        await ctx.db.execute<{ id: string; version: number }>(sql`
          INSERT INTO regions (kind, name, version, geom)
          VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(TRIAGE_POLY)}))
          RETURNING id, version
        `)
      )[0]!
      const [vc] = await ctx.db.insert(vehicleClasses).values({ name: `v-${label}`, level: 1 }).returning()
      const [tc] = await ctx.db.insert(taskClasses).values({ name: `t-${label}`, level: 1 }).returning()
      const [p] = await ctx.db
        .insert(predictions)
        .values({
          sourceKind: 'WATCHLIST',
          sourceId: vc!.id,
          regionId: reg.id,
          regionVersion: reg.version,
          windowDate: new Date('2026-05-15'),
          windowHalf: 'AM',
          vehicleClassId: vc!.id,
          taskClassId: tc!.id,
          kDays: 9,
          expiresAt: new Date(Date.now() + 9 * 86400_000),
        })
        .returning()
      const externalId = `ext-real-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const [task] = await ctx.db
        .insert(dispatchTasks)
        .values({
          predictionId: p!.id,
          adapterKey: 'real-gzp',
          externalId,
          state: 'SENT',
          paramsJson: {},
        })
        .returning()

      // --- POST a signed webhook to /webhook/real-gzp
      const body = JSON.stringify({ externalId, state: 'COMPLETED', meta: { ok: true } })
      const sig = computeSignature(body, SECRET)
      const res = await app.request('/webhook/real-gzp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature': sig,
          'x-idempotency-key': `real-test-${Date.now()}-${Math.random()}`,
        },
        body,
      })
      expect(res.status).toBe(200)
      const json = (await res.json()) as { ok: boolean; envelopeId: string; status: string }
      expect(json.ok).toBe(true)
      expect(json.status).toBe('PROCESSED')
      expect(json.envelopeId).toBeTruthy()

      // --- Verify dispatch_task state advanced
      const [updated] = await ctx.db
        .select()
        .from(dispatchTasks)
        .where(eq(dispatchTasks.id, task!.id))
      expect(updated!.state).toBe('COMPLETED')
      expect(updated!.completedAt).not.toBeNull()
    } finally {
      await ctx.cleanup()
    }
  })
})
