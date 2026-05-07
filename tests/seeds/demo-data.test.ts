/**
 * Smoke test for `seedDemoData()` (au-T8).
 *
 * Goal: ONE seed run produces the documented row counts AND writes media into
 * the in-memory MockOssAdapter. We import `seedDemoData()` directly (not
 * `spawnSync`-based subprocess) so we can inspect the same MockOssAdapter
 * instance after the call.
 *
 * Cleanup at the end deletes every `[DEMO]`-tagged row this run inserted so
 * the dev DB stays free of leftovers if developers run the suite locally.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { MockOssAdapter } from '@/media/adapters/mock-oss'
import { seedDemoData } from '@/seeds/demo-data'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>

beforeAll(async () => {
  ctx = await createTestDb()
  // Make sure no previous run's `[DEMO]` rows linger (idempotency probe would
  // otherwise short-circuit). Delete in FK-safe order.
  await ctx.db.execute(sql`DELETE FROM case_library_entries WHERE retrospective_id IN (SELECT id FROM retrospectives WHERE summary_md LIKE '[DEMO]%')`)
  await ctx.db.execute(sql`DELETE FROM retrospectives WHERE summary_md LIKE '[DEMO]%'`)
  await ctx.db.execute(sql`
    DELETE FROM media_assets WHERE dispatch_id IN (
      SELECT id FROM dispatch_tasks WHERE prediction_id IN (
        SELECT id FROM predictions WHERE source_id IN (
          SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
          UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
        )
      )
    )
  `)
  await ctx.db.execute(sql`
    DELETE FROM dispatch_results WHERE dispatch_id IN (
      SELECT id FROM dispatch_tasks WHERE prediction_id IN (
        SELECT id FROM predictions WHERE source_id IN (
          SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
          UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
        )
      )
    )
  `)
  await ctx.db.execute(sql`
    DELETE FROM dispatch_tasks WHERE prediction_id IN (
      SELECT id FROM predictions WHERE source_id IN (
        SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
        UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
      )
    )
  `)
  await ctx.db.execute(sql`
    DELETE FROM confidence_snapshots WHERE prediction_id IN (
      SELECT id FROM predictions WHERE source_id IN (
        SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
        UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
      )
    )
  `)
  await ctx.db.execute(sql`
    DELETE FROM predictions WHERE source_id IN (
      SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
      UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
    )
  `)
  await ctx.db.execute(sql`DELETE FROM task_cards WHERE name LIKE '[DEMO]%'`)
  await ctx.db.execute(sql`DELETE FROM watch_lists WHERE name LIKE '[DEMO]%'`)
})

afterAll(async () => {
  // Cleanup demo rows we inserted
  if (ctx) {
    await ctx.db.execute(sql`DELETE FROM case_library_entries WHERE retrospective_id IN (SELECT id FROM retrospectives WHERE summary_md LIKE '[DEMO]%')`)
    await ctx.db.execute(sql`DELETE FROM retrospectives WHERE summary_md LIKE '[DEMO]%'`)
    await ctx.db.execute(sql`
      DELETE FROM media_assets WHERE dispatch_id IN (
        SELECT id FROM dispatch_tasks WHERE prediction_id IN (
          SELECT id FROM predictions WHERE source_id IN (
            SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
            UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
          )
        )
      )
    `)
    await ctx.db.execute(sql`
      DELETE FROM dispatch_results WHERE dispatch_id IN (
        SELECT id FROM dispatch_tasks WHERE prediction_id IN (
          SELECT id FROM predictions WHERE source_id IN (
            SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
            UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
          )
        )
      )
    `)
    await ctx.db.execute(sql`
      DELETE FROM dispatch_tasks WHERE prediction_id IN (
        SELECT id FROM predictions WHERE source_id IN (
          SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
          UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
        )
      )
    `)
    await ctx.db.execute(sql`
      DELETE FROM confidence_snapshots WHERE prediction_id IN (
        SELECT id FROM predictions WHERE source_id IN (
          SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
          UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
        )
      )
    `)
    await ctx.db.execute(sql`
      DELETE FROM predictions WHERE source_id IN (
        SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
        UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
      )
    `)
    await ctx.db.execute(sql`DELETE FROM task_cards WHERE name LIKE '[DEMO]%'`)
    await ctx.db.execute(sql`DELETE FROM watch_lists WHERE name LIKE '[DEMO]%'`)
    await ctx.cleanup()
  }
})

describe('seedDemoData', () => {
  test('populates expected counts + writes media to MockOss', async () => {
    const oss = new MockOssAdapter()

    const counts = await seedDemoData(ctx.db, oss)

    expect(counts.alreadySeeded).toBe(false)
    expect(counts.watchlists).toBe(6)
    expect(counts.taskCards).toBe(4)
    expect(counts.predictions).toBe(20)
    expect(counts.confidenceSnapshots).toBe(20)
    expect(counts.dispatchTasks).toBe(10)
    expect(counts.dispatchResults).toBe(9) // 1 FAILED dispatch has no result
    expect(counts.mediaAssets).toBe(12) // 4 HIT/CAPTURED dispatches × 3 media
    expect(counts.retrospectives).toBe(15)
    expect(counts.caseLibraryEntries).toBe(15)

    // ─── DB-side assertions ────────────────────────────────────────────────
    const wl = await ctx.db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM watch_lists WHERE name LIKE '[DEMO]%'`,
    )
    expect(wl[0]?.n).toBe(6)

    const tc = await ctx.db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM task_cards WHERE name LIKE '[DEMO]%'`,
    )
    expect(tc[0]?.n).toBe(4)

    const retro = await ctx.db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM retrospectives WHERE summary_md LIKE '[DEMO]%'`,
    )
    expect(retro[0]?.n).toBe(15)

    // outcome distribution checks
    const hitCaptured = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM retrospectives
      WHERE summary_md LIKE '[DEMO]%' AND prediction_outcome = 'HIT' AND capture_outcome = 'CAPTURED'
    `)
    expect(hitCaptured[0]?.n).toBe(4)

    const noDataUnknown = await ctx.db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM retrospectives
      WHERE summary_md LIKE '[DEMO]%' AND prediction_outcome = 'NO_DATA' AND capture_outcome = 'UNKNOWN'
    `)
    expect(noDataUnknown[0]?.n).toBe(1)

    // ─── MockOss assertions ────────────────────────────────────────────────
    expect(oss.key).toBe('mock')
    const keys = await oss.list('media/demo-')
    expect(keys.length).toBe(12)
    // every key should land under media/demo-<dispatchPrefix>/<i>-<placeholder>.jpg
    for (const k of keys) {
      expect(k.startsWith('media/demo-')).toBe(true)
      expect(k.endsWith('.jpg')).toBe(true)
    }
  })

  test('second call short-circuits via idempotency probe', async () => {
    // Reuse the data inserted by the previous test — `alreadySeeded` should be true.
    const oss = new MockOssAdapter()
    const counts2 = await seedDemoData(ctx.db, oss)
    expect(counts2.alreadySeeded).toBe(true)
    // Counts come from the existing rows; should match the prior run's totals.
    expect(counts2.watchlists).toBe(6)
    expect(counts2.predictions).toBe(20)
    expect(counts2.retrospectives).toBe(15)
    // Idempotent skip means NO new media writes.
    const keys = await oss.list('media/demo-')
    expect(keys.length).toBe(0)
  })
})
