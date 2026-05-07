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
import { cleanupDemoData, seedDemoData } from '@/seeds/demo-data'
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

  test('partial seed (retroCount != 0 && != 15) throws hard error', async () => {
    // Simulate a crashed prior run: delete all but 1 [DEMO] retro. The
    // case_library_entries.retrospective_id FK cascades on delete, so we just
    // delete the retro rows — Postgres takes care of dependents.
    //
    // Idempotency probe should now find retroCount=1 → throw "partial seed
    // detected" rather than silently returning alreadySeeded:true.
    await ctx.db.execute(sql`
      DELETE FROM retrospectives
      WHERE summary_md LIKE '[DEMO]%'
        AND id NOT IN (
          SELECT id FROM retrospectives
          WHERE summary_md LIKE '[DEMO]%'
          ORDER BY id
          LIMIT 1
        )
    `)
    const remaining = await ctx.db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM retrospectives WHERE summary_md LIKE '[DEMO]%'`,
    )
    expect(remaining[0]?.n).toBe(1)

    const oss = new MockOssAdapter()
    let caught: unknown
    try {
      await seedDemoData(ctx.db, oss)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('partial seed detected')
    expect((caught as Error).message).toContain('1/15')
    // No new media writes either.
    const keys = await oss.list('media/demo-')
    expect(keys.length).toBe(0)
  })
})

describe('cleanupDemoData', () => {
  // Hard-reset: wipe any leftover [DEMO]% rows from the previous describe block
  // (the partial-seed test leaves 1 retro + the original watchlists/taskcards/
  // predictions/etc still in place). We re-use cleanupDemoData itself for this
  // setup since we trust the cleanup logic at this point — a chicken-and-egg
  // moment, but conceptually the simplest reset path. If cleanupDemoData were
  // broken, test 1 below would catch it.
  beforeAll(async () => {
    const oss = new MockOssAdapter()
    await cleanupDemoData(ctx.db, oss)
  })

  test('removes all seeded rows + clears mock OSS keys', async () => {
    // Seed fresh.
    const oss = new MockOssAdapter()
    const seeded = await seedDemoData(ctx.db, oss)
    expect(seeded.alreadySeeded).toBe(false)

    // Capture pre-cleanup OSS keys for the post-condition check.
    const seededKeys = await oss.list('media/demo-')
    expect(seededKeys.length).toBe(12)
    for (const k of seededKeys) {
      expect(oss._has(k)).toBe(true)
    }

    // Run cleanup.
    const counts = await cleanupDemoData(ctx.db, oss)

    // Returned counts match what was seeded.
    expect(counts.watchlists).toBe(6)
    expect(counts.taskCards).toBe(4)
    expect(counts.predictions).toBe(20)
    expect(counts.confidenceSnapshots).toBe(20)
    expect(counts.dispatchTasks).toBe(10)
    expect(counts.dispatchResults).toBe(9)
    expect(counts.mediaAssets).toBe(12)
    expect(counts.retrospectives).toBe(15)
    expect(counts.caseLibraryEntries).toBe(15)
    expect(counts.ossKeysCleared).toBe(12)

    // ─── DB-side: every demo-tagged table must be empty of [DEMO]% rows ────
    const probes: { sql_: ReturnType<typeof sql>; label: string }[] = [
      { sql_: sql`SELECT COUNT(*)::int AS n FROM watch_lists WHERE name LIKE '[DEMO]%'`, label: 'watch_lists' },
      { sql_: sql`SELECT COUNT(*)::int AS n FROM task_cards WHERE name LIKE '[DEMO]%'`, label: 'task_cards' },
      { sql_: sql`SELECT COUNT(*)::int AS n FROM retrospectives WHERE summary_md LIKE '[DEMO]%'`, label: 'retrospectives' },
      {
        sql_: sql`
          SELECT COUNT(*)::int AS n FROM case_library_entries
          WHERE retrospective_id IN (SELECT id FROM retrospectives WHERE summary_md LIKE '[DEMO]%')
        `,
        label: 'case_library_entries',
      },
      {
        sql_: sql`
          SELECT COUNT(*)::int AS n FROM predictions
          WHERE source_id IN (
            SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
            UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
          )
        `,
        label: 'predictions',
      },
      {
        sql_: sql`
          SELECT COUNT(*)::int AS n FROM confidence_snapshots
          WHERE prediction_id IN (
            SELECT id FROM predictions WHERE source_id IN (
              SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
              UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
            )
          )
        `,
        label: 'confidence_snapshots',
      },
      {
        sql_: sql`
          SELECT COUNT(*)::int AS n FROM dispatch_tasks
          WHERE prediction_id IN (
            SELECT id FROM predictions WHERE source_id IN (
              SELECT id FROM watch_lists WHERE name LIKE '[DEMO]%'
              UNION SELECT id FROM task_cards WHERE name LIKE '[DEMO]%'
            )
          )
        `,
        label: 'dispatch_tasks',
      },
    ]
    for (const p of probes) {
      const r = await ctx.db.execute<{ n: number }>(p.sql_)
      expect(r[0]?.n, `expected 0 ${p.label} after cleanup`).toBe(0)
    }

    // ─── OSS-side: previously-stored keys are gone ─────────────────────────
    for (const k of seededKeys) {
      expect(oss._has(k)).toBe(false)
    }
    const remaining = await oss.list('media/demo-')
    expect(remaining.length).toBe(0)
  })

  test('is idempotent on a clean DB (returns all-zero counts, no error)', async () => {
    // After the previous test the DB is clean. Running cleanup again should be
    // a no-op — every count zero, no thrown error, ossKeysCleared also zero.
    const oss = new MockOssAdapter()
    const counts = await cleanupDemoData(ctx.db, oss)
    expect(counts.retrospectives).toBe(0)
    expect(counts.caseLibraryEntries).toBe(0)
    expect(counts.mediaAssets).toBe(0)
    expect(counts.dispatchResults).toBe(0)
    expect(counts.dispatchTasks).toBe(0)
    expect(counts.predictions).toBe(0)
    expect(counts.confidenceSnapshots).toBe(0)
    expect(counts.taskCards).toBe(0)
    expect(counts.watchlists).toBe(0)
    expect(counts.ossKeysCleared).toBe(0)
  })
})
