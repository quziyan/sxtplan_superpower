/**
 * Demo data seed (au-T8) — populates DB with realistic counts for screenshot/demo runs.
 *
 *   6 watchlists  / 4 task cards  / 20 predictions / 15 retrospectives + case_library
 *   ~10 dispatch_tasks / 12 media_assets backed by 8 placeholder JPGs (rotated)
 *
 * Markers — every demo row's user-visible text starts with `[DEMO]`. The cleanup CLI
 * (au-T9) deletes by that prefix. We do NOT touch schema (no `demo_seed` column).
 *
 * Pre-conditions (fail fast with clear error):
 *   - admin user exists (run `seed:bootstrap`)
 *   - >=5 ADMIN_NAMED regions exist (run `seed:region`)
 *   - >=5 vehicle classes (level=2) exist (run `seed:taxonomy:police`)
 *   - >=5 task classes    (level=2) exist (run `seed:taxonomy:police`)
 *
 * Idempotent — second run detects an existing `[DEMO]` watchlist and exits without
 * inserting again (returns the previously-seeded counts).
 *
 * Reproducible — uses a tiny LCG keyed off a constant so re-runs produce stable
 * windowDate / region picks etc.
 */

import path from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb, type Db } from '@/db/client'
import { confidenceSnapshots, predictions } from '@/db/schema/prediction'
import { dispatchResults, dispatchTasks, mediaAssets } from '@/db/schema/dispatch'
import { taskCards, watchLists } from '@/db/schema/watchlist'
import { caseLibraryEntries, retrospectives } from '@/db/schema/retrospective'
import { getOssAdapter, resetOssAdapterForTests } from '@/media/oss-adapter-pool'
import type { OssAdapter } from '@/media/oss-adapter'

// ─── reproducible RNG ──────────────────────────────────────────────────────
// Tiny LCG (Numerical Recipes constants). Keyed to a constant so demo runs
// against a fresh DB produce identical pickings. Not cryptographic.
function makeRng(seed = 0xC0FFEE): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

// ─── constants ─────────────────────────────────────────────────────────────
const DEMO = '[DEMO]'
const PLACEHOLDERS = [
  '01-patrol-car.jpg',
  '02-traffic-cop.jpg',
  '03-criminal-investigation.jpg',
  '04-comprehensive-mgmt.jpg',
  '05-urban-mgmt.jpg',
  '06-night-patrol.jpg',
  '07-intersection.jpg',
  '08-street-scene.jpg',
] as const

// 5 V/T pairs (task card / prediction text uses these)
const VT_LABELS = [
  { v: '治安巡逻车', t: '街面治安巡逻' },
  { v: '交警执法车', t: '路面交通执法' },
  { v: '刑侦专项车', t: '专项行动' },
  { v: '综治巡防车', t: '综合治理巡查' },
  { v: '城管执法车', t: '城管执法巡查' },
] as const

// retro outcome plan (ordered) — 15 rows, mapped onto 15 of the 20 predictions
type Outcome =
  | 'HIT_CAPTURED'
  | 'HIT_NOT_CAPTURED'
  | 'HIT_NOT_DISPATCHED'
  | 'MISS_NOT_CAPTURED'
  | 'MISS_NOT_DISPATCHED'
  | 'NO_DATA_NOT_DISPATCHED'
  | 'NO_DATA_UNKNOWN'

const RETRO_PLAN: { count: number; outcome: Outcome }[] = [
  { count: 4, outcome: 'HIT_CAPTURED' },
  { count: 2, outcome: 'HIT_NOT_CAPTURED' },
  { count: 1, outcome: 'HIT_NOT_DISPATCHED' },
  { count: 3, outcome: 'MISS_NOT_CAPTURED' },
  { count: 2, outcome: 'MISS_NOT_DISPATCHED' },
  { count: 2, outcome: 'NO_DATA_NOT_DISPATCHED' },
  { count: 1, outcome: 'NO_DATA_UNKNOWN' },
]

type PredictionStatus = 'PROPOSED' | 'APPROVED' | 'EXPIRED' | 'COMPLETED'
const STATUS_DIST: PredictionStatus[] = [
  ...Array<PredictionStatus>(8).fill('PROPOSED'),
  ...Array<PredictionStatus>(6).fill('APPROVED'),
  ...Array<PredictionStatus>(4).fill('COMPLETED'),
  ...Array<PredictionStatus>(2).fill('EXPIRED'),
]

// Outcome → which prediction status the row should land on (ordered to match STATUS_DIST).
// Plan: 4 HIT/CAPTURED → 4 COMPLETED;
//       2 HIT/NOT_CAPTURED → 2 EXPIRED;
//       1 HIT/NOT_DISPATCHED → APPROVED (no dispatch);
//       3 MISS/NOT_CAPTURED → APPROVED (with dispatch+0 media);
//       2 MISS/NOT_DISPATCHED → APPROVED (no dispatch);
//       2 NO_DATA/NOT_DISPATCHED → PROPOSED (no dispatch);
//       1 NO_DATA/UNKNOWN → PROPOSED (with FAILED dispatch).
// Remaining 5 PROPOSED predictions have no retro at all.

// ─── outcome maps to (predictionOutcome, captureOutcome, dispatchState, mediaCount) ───
type RetroSpec = {
  outcome: Outcome
  predictionOutcome: 'HIT' | 'MISS' | 'NO_DATA'
  captureOutcome: 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'
  dispatchState: 'COMPLETED' | 'FAILED' | null // null = no dispatch
  mediaCount: number
  predictionStatus: PredictionStatus
}

const OUTCOME_TO_SPEC: Record<Outcome, Omit<RetroSpec, 'outcome' | 'predictionStatus'>> = {
  HIT_CAPTURED:           { predictionOutcome: 'HIT',     captureOutcome: 'CAPTURED',       dispatchState: 'COMPLETED', mediaCount: 3 },
  HIT_NOT_CAPTURED:       { predictionOutcome: 'HIT',     captureOutcome: 'NOT_CAPTURED',   dispatchState: 'COMPLETED', mediaCount: 0 },
  HIT_NOT_DISPATCHED:     { predictionOutcome: 'HIT',     captureOutcome: 'NOT_DISPATCHED', dispatchState: null,        mediaCount: 0 },
  MISS_NOT_CAPTURED:      { predictionOutcome: 'MISS',    captureOutcome: 'NOT_CAPTURED',   dispatchState: 'COMPLETED', mediaCount: 0 },
  MISS_NOT_DISPATCHED:    { predictionOutcome: 'MISS',    captureOutcome: 'NOT_DISPATCHED', dispatchState: null,        mediaCount: 0 },
  NO_DATA_NOT_DISPATCHED: { predictionOutcome: 'NO_DATA', captureOutcome: 'NOT_DISPATCHED', dispatchState: null,        mediaCount: 0 },
  NO_DATA_UNKNOWN:        { predictionOutcome: 'NO_DATA', captureOutcome: 'UNKNOWN',        dispatchState: 'FAILED',    mediaCount: 0 },
}

// 15 retro specs in fixed order, paired with the prediction status that hosts them.
const RETRO_SPECS: RetroSpec[] = (() => {
  const specs: RetroSpec[] = []
  // Build in order matching STATUS_DIST consumption:
  //   indexes 0-7 PROPOSED, 8-13 APPROVED, 14-17 COMPLETED, 18-19 EXPIRED.
  // We map retros onto prediction indexes:
  //   retros 0..3  (HIT_CAPTURED)        → predIdx 14..17 (COMPLETED)
  //   retros 4..5  (HIT_NOT_CAPTURED)    → predIdx 18..19 (EXPIRED)
  //   retro  6     (HIT_NOT_DISPATCHED)  → predIdx 8      (APPROVED)
  //   retros 7..9  (MISS_NOT_CAPTURED)   → predIdx 9..11  (APPROVED)
  //   retros 10..11(MISS_NOT_DISPATCHED) → predIdx 12..13 (APPROVED)
  //   retros 12..13(NO_DATA_NOT_DISPATCHED) → predIdx 0..1 (PROPOSED)
  //   retro  14    (NO_DATA_UNKNOWN)     → predIdx 2     (PROPOSED)
  //   predIdx 3..7 (PROPOSED) have NO retros (5 leftovers).
  for (const plan of RETRO_PLAN) {
    for (let i = 0; i < plan.count; i++) {
      specs.push({
        outcome: plan.outcome,
        ...OUTCOME_TO_SPEC[plan.outcome],
        // predictionStatus is filled in by mapping below
        predictionStatus: 'PROPOSED', // placeholder, overwritten below
      })
    }
  }
  return specs
})()

// Mapping: retroIdx → predictionIdx (in STATUS_DIST order)
const RETRO_TO_PRED_IDX: number[] = [
  14, 15, 16, 17, // HIT_CAPTURED → COMPLETED
  18, 19,         // HIT_NOT_CAPTURED → EXPIRED
  8,              // HIT_NOT_DISPATCHED → APPROVED
  9, 10, 11,      // MISS_NOT_CAPTURED → APPROVED
  12, 13,         // MISS_NOT_DISPATCHED → APPROVED
  0, 1,           // NO_DATA_NOT_DISPATCHED → PROPOSED
  2,              // NO_DATA_UNKNOWN → PROPOSED
]
// Patch RETRO_SPECS.predictionStatus from the prediction index lookup.
for (let i = 0; i < RETRO_SPECS.length; i++) {
  const spec = RETRO_SPECS[i]
  const predIdx = RETRO_TO_PRED_IDX[i]
  if (spec === undefined || predIdx === undefined) continue
  spec.predictionStatus = STATUS_DIST[predIdx] ?? 'PROPOSED'
}

// ─── public API ────────────────────────────────────────────────────────────
export type SeedDemoCounts = {
  watchlists: number
  taskCards: number
  predictions: number
  confidenceSnapshots: number
  dispatchTasks: number
  dispatchResults: number
  mediaAssets: number
  retrospectives: number
  caseLibraryEntries: number
  alreadySeeded: boolean
}

export async function seedDemoData(db: Db, oss: OssAdapter): Promise<SeedDemoCounts> {
  // 0a. idempotency probe — completion-aware (Finding 2).
  //
  // We probe retrospectives (the LAST table the seed populates) rather than
  // watchlists (the FIRST). If retros == 15, the previous run finished and we
  // skip. If retros > 0 but != 15, a prior run crashed mid-way — make that a
  // hard error so the operator must explicitly clean up before re-running,
  // rather than silently returning `alreadySeeded: true` on a half-seeded DB.
  const existing = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM retrospectives WHERE summary_md LIKE ${`${DEMO}%`}
  `)
  const existingRetros = existing[0]?.n ?? 0
  if (existingRetros === 15) {
    return await collectCounts(db, true)
  }
  if (existingRetros > 0) {
    throw new Error(
      `demo seed found ${existingRetros}/15 retrospectives — partial seed detected; run \`bun src/seeds/demo-data.ts --cleanup\` first (after au-T9 ships) or manually DELETE FROM retrospectives WHERE summary_md LIKE '[DEMO]%' (and cascade dependents)`,
    )
  }

  // 0b. preconditions — admin user, regions, taxonomy
  const adminRes = await db.execute<{ id: string }>(sql`
    SELECT id FROM users WHERE email = 'admin@cnp.local' LIMIT 1
  `)
  const admin = adminRes[0]
  if (!admin) {
    throw new Error('demo seed needs admin user; run seed:bootstrap first')
  }

  const regionsRes = await db.execute<{ id: string; version: number; name: string | null }>(sql`
    SELECT id, version, name
    FROM regions
    WHERE kind = 'ADMIN_NAMED' AND effective_to IS NULL
    ORDER BY name NULLS LAST
    LIMIT 5
  `)
  if (regionsRes.length < 5) {
    throw new Error('demo seed needs >=5 ADMIN_NAMED regions; run seed:region first')
  }

  const vehiclesRes = await db.execute<{ id: string; name: string }>(sql`
    SELECT id, name FROM vehicle_classes WHERE level = 2 ORDER BY name LIMIT 5
  `)
  if (vehiclesRes.length < 5) {
    throw new Error('demo seed needs >=5 vehicle subclasses (level=2); run seed:taxonomy:police first')
  }

  const tasksRes = await db.execute<{ id: string; name: string }>(sql`
    SELECT id, name FROM task_classes WHERE level = 2 ORDER BY name LIMIT 5
  `)
  if (tasksRes.length < 5) {
    throw new Error('demo seed needs >=5 task subclasses (level=2); run seed:taxonomy:police first')
  }

  const rng = makeRng()
  const adminId = admin.id
  const today = new Date()
  // Truncate to local date midnight for windowDate (col is DATE).
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  // ─── 1. Watchlists (6) ───────────────────────────────────────────────────
  const watchlistIds: string[] = []
  for (let i = 0; i < 6; i++) {
    const vt = VT_LABELS[i % VT_LABELS.length]!
    const v = vehiclesRes[i % vehiclesRes.length]!
    const t = tasksRes[i % tasksRes.length]!
    const r = regionsRes[i % regionsRes.length]!
    const [row] = await db.insert(watchLists).values({
      name: `${DEMO} ${vt.v}/${vt.t} 监听 #${i + 1}`,
      description: `${DEMO} 演示监听清单:V=${vt.v} / T=${vt.t} / R=${r.name ?? 'unnamed'}`,
      vehicleClassId: v.id,
      taskClassId: t.id,
      regionId: r.id,
      regionVersion: r.version,
      kRangeMin: 1,
      kRangeMax: 14,
      isActive: true,
      createdBy: adminId,
    }).returning()
    if (row) watchlistIds.push(row.id)
  }

  // ─── 2. Task cards (4) ───────────────────────────────────────────────────
  const taskCardIds: string[] = []
  for (let i = 0; i < 4; i++) {
    const vt = VT_LABELS[i % VT_LABELS.length]!
    const v = vehiclesRes[i % vehiclesRes.length]!
    const t = tasksRes[i % tasksRes.length]!
    const r = regionsRes[(i + 1) % regionsRes.length]!
    const dayOffset = i * 7 // every 7 days
    const target = new Date(todayDate)
    target.setDate(target.getDate() + dayOffset)
    const [row] = await db.insert(taskCards).values({
      name: `${DEMO} ${vt.v}/${vt.t} 任务卡 #${i + 1}`,
      description: `${DEMO} 演示任务卡 — half=${i % 2 === 0 ? 'AM' : 'PM'}`,
      vehicleClassId: v.id,
      taskClassId: t.id,
      regionId: r.id,
      regionVersion: r.version,
      targetWindowDate: target,
      targetWindowHalf: i % 2 === 0 ? 'AM' : 'PM',
      createdBy: adminId,
    }).returning()
    if (row) taskCardIds.push(row.id)
  }

  // ─── 3. Predictions (20) + initial confidence_snapshots ─────────────────
  type PredCtx = {
    id: string
    status: PredictionStatus
    confidenceNow: number
  }
  const predCtxs: PredCtx[] = []
  let snapshotCount = 0
  for (let i = 0; i < 20; i++) {
    const status = STATUS_DIST[i] ?? 'PROPOSED'
    const vtIdx = i % VT_LABELS.length
    const vt = VT_LABELS[vtIdx]!
    const v = vehiclesRes[vtIdx]!
    const t = tasksRes[vtIdx]!
    const r = regionsRes[i % regionsRes.length]!
    // windowDate spread: PROPOSED future, others past — mostly within 60 days.
    const dayOffset =
      status === 'PROPOSED'
        ? Math.floor(rng() * 14) + 1 // future 1..14d
        : -1 * (Math.floor(rng() * 60) + 1) // past 1..60d
    const windowDate = new Date(todayDate)
    windowDate.setDate(windowDate.getDate() + dayOffset)
    const half = i % 2 === 0 ? 'AM' : 'PM'
    const confidenceNow =
      status === 'COMPLETED' ? 80 + Math.floor(rng() * 15)
      : status === 'EXPIRED' ? 50 + Math.floor(rng() * 30)
      : status === 'APPROVED' ? 60 + Math.floor(rng() * 25)
      : 30 + Math.floor(rng() * 40)
    const kDays = Math.floor(rng() * 13) + 1
    // expiresAt: status-dependent, in seconds
    const expiresAt = new Date(windowDate)
    expiresAt.setHours(23, 59, 59)
    if (status === 'PROPOSED' || status === 'APPROVED') {
      // future-ish
      const fwd = Math.floor(rng() * 5) + 1
      expiresAt.setDate(expiresAt.getDate() + fwd)
    } else {
      // already past
      expiresAt.setDate(expiresAt.getDate() + 1)
    }

    const sourceKind = i % 3 === 0 ? 'TASKCARD' : 'WATCHLIST'
    const sourceId =
      sourceKind === 'TASKCARD'
        ? taskCardIds[i % Math.max(1, taskCardIds.length)] ?? watchlistIds[0]!
        : watchlistIds[i % Math.max(1, watchlistIds.length)] ?? watchlistIds[0]!

    const [pRow] = await db.insert(predictions).values({
      sourceKind,
      sourceId,
      regionId: r.id,
      regionVersion: r.version,
      windowDate,
      windowHalf: half,
      vehicleClassId: v.id,
      taskClassId: t.id,
      confidenceNow,
      kDays,
      status,
      cadenceMinutes: 1440,
      expiresAt,
    }).returning()
    if (!pRow) continue
    predCtxs.push({ id: pRow.id, status, confidenceNow })

    // initial confidence snapshot (FULL)
    await db.insert(confidenceSnapshots).values({
      predictionId: pRow.id,
      kind: 'FULL',
      confidence: confidenceNow,
      reasoning: `${DEMO} 初始 FULL 评估 — V=${vt.v} / T=${vt.t}`,
      operator: 'demo-seed',
    })
    snapshotCount += 1
  }

  // ─── 4 + 5. Dispatches + media (driven by RETRO_SPECS) ──────────────────
  type DispCtx = { dispatchId: string; mediaCount: number; predIdx: number }
  const disps: DispCtx[] = []
  let mediaTotal = 0
  let resultsTotal = 0

  // Read placeholder bytes once (Bun.file). Anchor to module dir so the path
  // resolves correctly regardless of the caller's CWD (Finding 1: prior
  // path.resolve('./assets/...') threw ENOENT when invoked from any
  // subdirectory).
  const placeholderBuffers: Buffer[] = []
  for (const fn of PLACEHOLDERS) {
    const filePath = path.resolve(import.meta.dir, '../../assets/demo-placeholders', fn)
    const buf = Buffer.from(await Bun.file(filePath).arrayBuffer())
    placeholderBuffers.push(buf)
  }

  for (let i = 0; i < RETRO_SPECS.length; i++) {
    const spec = RETRO_SPECS[i]!
    const predIdx = RETRO_TO_PRED_IDX[i]
    if (predIdx === undefined) continue
    const pred = predCtxs[predIdx]
    if (!pred) continue
    if (spec.dispatchState === null) continue

    const adapterKey = i % 2 === 0 ? 'mock' : 'simulated-gzp'
    const externalId = `${DEMO.toLowerCase()}-${i}-${pred.id.slice(0, 8)}`
    const sentAt = new Date(Date.now() - (Math.floor(rng() * 5) + 1) * 86_400_000)
    const completedAt = new Date(sentAt.getTime() + 3600_000)

    const [dRow] = await db.insert(dispatchTasks).values({
      predictionId: pred.id,
      adapterKey,
      externalId,
      state: spec.dispatchState,
      paramsJson: { mediaCount: spec.mediaCount, demoSeed: true } as Record<string, unknown>,
      sentAt,
      completedAt: spec.dispatchState === 'COMPLETED' ? completedAt : null,
      cancellationReason: spec.dispatchState === 'FAILED' ? `${DEMO} 模拟失败:adapter timeout` : null,
    }).returning()
    if (!dRow) continue

    // dispatch_result (only for COMPLETED dispatches)
    if (spec.dispatchState === 'COMPLETED') {
      await db.insert(dispatchResults).values({
        dispatchId: dRow.id,
        payloadJson: {
          ok: true,
          mediaCount: spec.mediaCount,
          demoSeed: true,
          note: `${DEMO} 模拟回调结果`,
        } as Record<string, unknown>,
        capturedAt: completedAt,
      })
      resultsTotal += 1
    }

    // media — only for COMPLETED dispatches with mediaCount > 0
    if (spec.dispatchState === 'COMPLETED' && spec.mediaCount > 0) {
      for (let k = 0; k < spec.mediaCount; k++) {
        const phIdx = (mediaTotal + k) % PLACEHOLDERS.length
        const filename = PLACEHOLDERS[phIdx]!
        const body = placeholderBuffers[phIdx]!
        const ossKey = `media/demo-${dRow.id.slice(0, 8)}/${k}-${filename}`
        const putRes = await oss.put(ossKey, body)
        const sourceUrl = `https://demo-source.cnp.local/${filename}`
        const retentionUntil = new Date(Date.now() + 90 * 86_400_000)
        await db.insert(mediaAssets).values({
          dispatchId: dRow.id,
          ossUri: putRes.uri,
          sourceUrl,
          mediaType: 'image/jpeg',
          sizeBytes: putRes.sizeBytes,
          sha256: null,
          scanStatus: 'CLEAN',
          retentionUntil,
        })
        mediaTotal += 1
      }
    }
    disps.push({ dispatchId: dRow.id, mediaCount: spec.mediaCount, predIdx })
  }

  // ─── 6. Retrospectives (15) + 7. case_library_entries (15) ─────────────
  let retroCount = 0
  let caseCount = 0
  for (let i = 0; i < RETRO_SPECS.length; i++) {
    const spec = RETRO_SPECS[i]!
    const predIdx = RETRO_TO_PRED_IDX[i]
    if (predIdx === undefined) continue
    const pred = predCtxs[predIdx]
    if (!pred) continue

    // dispatch ids tied to this prediction (0..1 in our plan)
    const dispatchIdsForPred = disps.filter((d) => d.predIdx === predIdx).map((d) => d.dispatchId)

    const causal = `${DEMO}\n## 复盘原因分析\n本次预测 outcome=${spec.predictionOutcome} / capture=${spec.captureOutcome}。`
    const summary = `${DEMO} 复盘摘要 — ${spec.outcome}`
    const scoreV = spec.predictionOutcome === 'HIT' ? 80 + Math.floor(rng() * 15) : spec.predictionOutcome === 'MISS' ? 25 + Math.floor(rng() * 25) : 0
    const scoreR = spec.predictionOutcome === 'HIT' ? 75 + Math.floor(rng() * 15) : spec.predictionOutcome === 'MISS' ? 30 + Math.floor(rng() * 25) : 0
    const scoreW = spec.predictionOutcome === 'HIT' ? 70 + Math.floor(rng() * 20) : spec.predictionOutcome === 'MISS' ? 25 + Math.floor(rng() * 30) : 0
    const scoreT = spec.captureOutcome === 'CAPTURED' ? 85 + Math.floor(rng() * 10) : spec.captureOutcome === 'NOT_CAPTURED' ? 30 + Math.floor(rng() * 30) : 0
    const composite = Math.round((scoreV + scoreR + scoreW + scoreT) / 4)

    const retroRows = await db.execute<{ id: string }>(sql`
      INSERT INTO retrospectives (
        prediction_id, prediction_outcome, capture_outcome,
        score_v, score_r, score_w, score_t, composite,
        causal_md, summary_md, evidence_news_ids, capture_dispatch_ids,
        outcome_overridden, generated_at, updated_at
      )
      VALUES (
        ${pred.id}::uuid,
        ${spec.predictionOutcome}::prediction_outcome,
        ${spec.captureOutcome}::capture_outcome,
        ${scoreV}, ${scoreR}, ${scoreW}, ${scoreT}, ${composite},
        ${causal}, ${summary},
        ${JSON.stringify([])}::jsonb,
        ${JSON.stringify(dispatchIdsForPred)}::jsonb,
        FALSE,
        NOW(), NOW()
      )
      RETURNING id
    `)
    const retroId = retroRows[0]?.id
    if (!retroId) continue
    retroCount += 1

    const snapshot = {
      id: pred.id,
      status: pred.status,
      confidenceFinal: pred.confidenceNow,
      outcome: spec.outcome,
      demoSeed: true,
    }
    const retrievalKeys = {
      outcome: spec.predictionOutcome,
      captureOutcome: spec.captureOutcome,
      tag: 'demo',
    }
    const bm25 = `${causal}\n\n${summary}`

    await db.insert(caseLibraryEntries).values({
      retrospectiveId: retroId,
      predictionSnapshot: snapshot,
      retrievalKeys,
      bm25Blob: bm25,
    })
    caseCount += 1
  }

  return {
    watchlists: watchlistIds.length,
    taskCards: taskCardIds.length,
    predictions: predCtxs.length,
    confidenceSnapshots: snapshotCount,
    dispatchTasks: disps.length,
    dispatchResults: resultsTotal,
    mediaAssets: mediaTotal,
    retrospectives: retroCount,
    caseLibraryEntries: caseCount,
    alreadySeeded: false,
  }
}

async function collectCounts(db: Db, alreadySeeded: boolean): Promise<SeedDemoCounts> {
  const wl = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM watch_lists WHERE name LIKE ${`${DEMO}%`}`)
  const tc = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM task_cards   WHERE name LIKE ${`${DEMO}%`}`)
  // predictions don't have a name field; we reconcile by joining to demo watchlists/taskcards via source_id.
  const pred = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM predictions
    WHERE source_id IN (SELECT id FROM watch_lists WHERE name LIKE ${`${DEMO}%`})
       OR source_id IN (SELECT id FROM task_cards  WHERE name LIKE ${`${DEMO}%`})
  `)
  const snap = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM confidence_snapshots
    WHERE prediction_id IN (
      SELECT id FROM predictions WHERE source_id IN (
        SELECT id FROM watch_lists WHERE name LIKE ${`${DEMO}%`}
        UNION SELECT id FROM task_cards WHERE name LIKE ${`${DEMO}%`}
      )
    )
  `)
  const disp = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM dispatch_tasks
    WHERE prediction_id IN (
      SELECT id FROM predictions WHERE source_id IN (
        SELECT id FROM watch_lists WHERE name LIKE ${`${DEMO}%`}
        UNION SELECT id FROM task_cards WHERE name LIKE ${`${DEMO}%`}
      )
    )
  `)
  const dispRes = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM dispatch_results
    WHERE dispatch_id IN (
      SELECT id FROM dispatch_tasks WHERE prediction_id IN (
        SELECT id FROM predictions WHERE source_id IN (
          SELECT id FROM watch_lists WHERE name LIKE ${`${DEMO}%`}
          UNION SELECT id FROM task_cards WHERE name LIKE ${`${DEMO}%`}
        )
      )
    )
  `)
  const med = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM media_assets
    WHERE dispatch_id IN (
      SELECT id FROM dispatch_tasks WHERE prediction_id IN (
        SELECT id FROM predictions WHERE source_id IN (
          SELECT id FROM watch_lists WHERE name LIKE ${`${DEMO}%`}
          UNION SELECT id FROM task_cards WHERE name LIKE ${`${DEMO}%`}
        )
      )
    )
  `)
  const retro = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM retrospectives WHERE summary_md LIKE ${`${DEMO}%`}
  `)
  const cases = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM case_library_entries
    WHERE retrospective_id IN (SELECT id FROM retrospectives WHERE summary_md LIKE ${`${DEMO}%`})
  `)
  return {
    watchlists: wl[0]?.n ?? 0,
    taskCards: tc[0]?.n ?? 0,
    predictions: pred[0]?.n ?? 0,
    confidenceSnapshots: snap[0]?.n ?? 0,
    dispatchTasks: disp[0]?.n ?? 0,
    dispatchResults: dispRes[0]?.n ?? 0,
    mediaAssets: med[0]?.n ?? 0,
    retrospectives: retro[0]?.n ?? 0,
    caseLibraryEntries: cases[0]?.n ?? 0,
    alreadySeeded,
  }
}

// ─── public API: cleanup ───────────────────────────────────────────────────
/**
 * Result of `cleanupDemoData()` — count of rows removed per table, plus the
 * number of mock OSS keys cleared. All `[DEMO]%`-prefixed seed rows + cascading
 * dependents are deleted; mock OSS objects under the `media/demo-` prefix are
 * also wiped (best-effort, after the DB tx commits).
 */
export type CleanupResult = {
  retrospectives: number
  caseLibraryEntries: number
  mediaAssets: number
  dispatchResults: number
  dispatchTasks: number
  predictions: number
  confidenceSnapshots: number
  watchlists: number
  taskCards: number
  ossKeysCleared: number
}

/**
 * Inverse of `seedDemoData()` — removes every `[DEMO]`-tagged row + cascades.
 *
 * Strategy: anchor on the two `name LIKE '[DEMO]%'` tables (`watch_lists` +
 * `task_cards`). Any prediction whose `source_id` points at one of those
 * anchors is a demo prediction; from there we cascade to dispatch_tasks →
 * dispatch_results / media_assets, and to confidence_snapshots /
 * retrospectives → case_library_entries by prediction_id / retrospective_id.
 *
 * The delete chain runs inside a single transaction so a partial failure
 * rolls back cleanly. OSS object cleanup runs AFTER the tx commits and is
 * best-effort — Aliyun's adapter throws NotImplementedError; we swallow it
 * with a warning. The MockOssAdapter exposes `delete(key)` (au-T9) and runs
 * to completion.
 *
 * Idempotent — running on a clean DB returns all-zero counts and does not
 * error. Safe to invoke repeatedly.
 */
export async function cleanupDemoData(db: Db, oss: OssAdapter): Promise<CleanupResult> {
  const demoLike = `${DEMO}%`

  // ─── DB: cascading delete in FK-respecting order, wrapped in a tx ────────
  const dbCounts = await db.transaction(async (tx) => {
    // 1. case_library_entries — depends on retrospectives
    const cleRows = await tx.execute<{ id: string }>(sql`
      DELETE FROM case_library_entries
      WHERE retrospective_id IN (
        SELECT id FROM retrospectives WHERE summary_md LIKE ${demoLike}
      )
      RETURNING id
    `)

    // 2. retrospectives — depends on predictions
    const retroRows = await tx.execute<{ id: string }>(sql`
      DELETE FROM retrospectives WHERE summary_md LIKE ${demoLike} RETURNING id
    `)

    // 3. media_assets — depends on dispatch_tasks (which depend on demo predictions)
    const mediaRows = await tx.execute<{ id: string }>(sql`
      DELETE FROM media_assets
      WHERE dispatch_id IN (
        SELECT id FROM dispatch_tasks WHERE prediction_id IN (
          SELECT id FROM predictions WHERE source_id IN (
            SELECT id FROM watch_lists WHERE name LIKE ${demoLike}
            UNION SELECT id FROM task_cards WHERE name LIKE ${demoLike}
          )
        )
      )
      RETURNING id
    `)

    // 4. dispatch_results — depends on dispatch_tasks
    const dispResRows = await tx.execute<{ id: string }>(sql`
      DELETE FROM dispatch_results
      WHERE dispatch_id IN (
        SELECT id FROM dispatch_tasks WHERE prediction_id IN (
          SELECT id FROM predictions WHERE source_id IN (
            SELECT id FROM watch_lists WHERE name LIKE ${demoLike}
            UNION SELECT id FROM task_cards WHERE name LIKE ${demoLike}
          )
        )
      )
      RETURNING id
    `)

    // 5. dispatch_tasks — depends on predictions
    const dispRows = await tx.execute<{ id: string }>(sql`
      DELETE FROM dispatch_tasks
      WHERE prediction_id IN (
        SELECT id FROM predictions WHERE source_id IN (
          SELECT id FROM watch_lists WHERE name LIKE ${demoLike}
          UNION SELECT id FROM task_cards WHERE name LIKE ${demoLike}
        )
      )
      RETURNING id
    `)

    // 6. confidence_snapshots — depends on predictions
    const snapRows = await tx.execute<{ id: string }>(sql`
      DELETE FROM confidence_snapshots
      WHERE prediction_id IN (
        SELECT id FROM predictions WHERE source_id IN (
          SELECT id FROM watch_lists WHERE name LIKE ${demoLike}
          UNION SELECT id FROM task_cards WHERE name LIKE ${demoLike}
        )
      )
      RETURNING id
    `)

    // 7. predictions — anchored on demo watchlists/taskcards by source_id
    const predRows = await tx.execute<{ id: string }>(sql`
      DELETE FROM predictions
      WHERE source_id IN (
        SELECT id FROM watch_lists WHERE name LIKE ${demoLike}
        UNION SELECT id FROM task_cards WHERE name LIKE ${demoLike}
      )
      RETURNING id
    `)

    // 8. task_cards — anchor table
    const tcRows = await tx.execute<{ id: string }>(sql`
      DELETE FROM task_cards WHERE name LIKE ${demoLike} RETURNING id
    `)

    // 9. watch_lists — anchor table
    const wlRows = await tx.execute<{ id: string }>(sql`
      DELETE FROM watch_lists WHERE name LIKE ${demoLike} RETURNING id
    `)

    return {
      caseLibraryEntries: cleRows.length,
      retrospectives: retroRows.length,
      mediaAssets: mediaRows.length,
      dispatchResults: dispResRows.length,
      dispatchTasks: dispRows.length,
      confidenceSnapshots: snapRows.length,
      predictions: predRows.length,
      taskCards: tcRows.length,
      watchlists: wlRows.length,
    }
  })

  // ─── OSS: best-effort key cleanup AFTER tx commits ──────────────────────
  // Mock adapter implements list+delete; Aliyun throws NotImplementedError on
  // both — we swallow + warn so production cleanup runs (and the operator gets
  // a clear hint that OSS lifecycle/console is the right tool there).
  let ossKeysCleared = 0
  if (typeof oss.list === 'function' && typeof oss.delete === 'function') {
    try {
      const keys = await oss.list('media/demo-')
      for (const k of keys) {
        await oss.delete(k)
        ossKeysCleared += 1
      }
    } catch (e) {
      console.warn(
        `[cleanup] OSS clear skipped (${oss.key}): ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  } else {
    console.warn(
      `[cleanup] OSS adapter '${oss.key}' does not support list+delete; skipping object cleanup`,
    )
  }

  return { ...dbCounts, ossKeysCleared }
}

// ─── CLI entry point ───────────────────────────────────────────────────────
async function main() {
  const verbose = process.argv.includes('--verbose')
  const isCleanup = process.argv.includes('--cleanup')

  // Force a fresh OssAdapter read (in case of test pollution).
  resetOssAdapterForTests()
  const oss = getOssAdapter()
  const { db, sql: pg } = createDb('admin')
  try {
    if (isCleanup) {
      console.log('[seed:demo-data] cleanup mode')
      const counts = await cleanupDemoData(db, oss)
      console.log(
        `[cleanup] removed ${counts.retrospectives} retros / ${counts.mediaAssets} media / ` +
          `${counts.dispatchTasks} dispatches / ${counts.dispatchResults} results / ` +
          `${counts.predictions} predictions / ${counts.watchlists} watchlists / ` +
          `${counts.taskCards} taskcards / ${counts.confidenceSnapshots} confidence_snapshots`,
      )
      console.log(`[cleanup] cleared ${counts.ossKeysCleared} mock OSS keys`)
      if (verbose) {
        console.log(JSON.stringify(counts, null, 2))
      }
      console.log('[seed:demo-data] cleanup done')
    } else {
      console.log('[seed:demo-data] start')
      const counts = await seedDemoData(db, oss)
      if (counts.alreadySeeded) {
        console.log(`[seed:demo-data] already seeded (idempotent skip)`)
      }
      if (verbose) {
        console.log(JSON.stringify(counts, null, 2))
      }
      console.log(
        `[seed:demo-data] done — ${counts.watchlists} wl / ${counts.taskCards} tc / ` +
          `${counts.predictions} pred / ${counts.retrospectives} retro / ${counts.mediaAssets} media`,
      )
    }
  } finally {
    await pg.end()
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
