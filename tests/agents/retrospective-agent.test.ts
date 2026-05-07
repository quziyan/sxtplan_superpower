import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { runRetrospectiveAgent } from '@/agents/retrospective-agent'
import { dispatchTasks } from '@/db/schema/dispatch'
import { newsEvidence, newsItems, predictions } from '@/db/schema/prediction'
import { caseLibraryEntries, retrospectives } from '@/db/schema/retrospective'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import type { InferenceRequest, InferenceResponse } from '@/inference/types'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  ctx = await createTestDb()
})
afterAll(async () => {
  await ctx.cleanup()
})

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

const HIT_OUTPUT = {
  prediction_outcome: 'HIT' as const,
  capture_outcome: 'CAPTURED' as const,
  score_v: 90,
  score_r: 85,
  score_w: 80,
  score_t: 88,
  composite: 86,
  causal_md: '## 命中分析\n茂名应急局公告启动 II 级响应,实拍回传确认调度。',
  summary_md: '该预测命中,实拍证实。',
  evidence_news_ids: [],
  key_signals: ['II 级响应启动', '实拍回传'],
}

const MISS_OUTPUT = {
  prediction_outcome: 'MISS' as const,
  capture_outcome: 'NOT_CAPTURED' as const,
  score_v: 20,
  score_r: 30,
  score_w: 25,
  score_t: 15,
  composite: 22,
  causal_md: '## 误判分析\n新闻显示事件未发生,实拍未捕获目标。',
  summary_md: '预测未命中,无实拍证据。',
  evidence_news_ids: [],
  key_signals: ['事件未发生'],
}

const NODATA_OUTPUT = {
  prediction_outcome: 'NO_DATA' as const,
  capture_outcome: 'UNKNOWN' as const,
  score_v: 0,
  score_r: 0,
  score_w: 0,
  score_t: 0,
  composite: 0,
  causal_md: '## 无数据分析\n证据不足,adapter 回传失败,无法判定。',
  summary_md: '证据不足,无法判定。',
  evidence_news_ids: [],
  key_signals: ['adapter 失败'],
}

const INVALID_OUTPUT = {
  // CAPTURED + MISS violates the refine() rule
  prediction_outcome: 'MISS' as const,
  capture_outcome: 'CAPTURED' as const,
  score_v: 50,
  score_r: 50,
  score_w: 50,
  score_t: 50,
  composite: 50,
  causal_md: '矛盾输出,违反了 CAPTURED→HIT 约束。',
  summary_md: '违反 schema 约束。',
  evidence_news_ids: [],
  key_signals: ['违反约束'],
}

function mockInferConst(payload: object): typeof import('@/inference/client').infer {
  return async () => ({
    text: JSON.stringify(payload),
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    model: 'mock',
  })
}

function mockInferCapture(payload: object) {
  const calls: InferenceRequest[] = []
  const fn = (async (req: InferenceRequest): Promise<InferenceResponse> => {
    calls.push(req)
    return {
      text: JSON.stringify(payload),
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      model: 'mock',
    }
  }) as unknown as typeof import('@/inference/client').infer
  return { fn, calls }
}

async function setup(
  db: typeof ctx.db,
  label: string,
  opts: { withNews?: number; withDispatch?: { state: string; mediaCount?: number } } = {},
) {
  const reg = (await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [vc] = await db.insert(vehicleClasses).values({ name: `应急车-${label}`, level: 1 }).returning()
  const [tc] = await db.insert(taskClasses).values({ name: `抢险-${label}`, level: 1 }).returning()
  const [p] = await db.insert(predictions).values({
    sourceKind: 'WATCHLIST',
    sourceId: vc!.id,
    regionId: reg.id,
    regionVersion: reg.version,
    windowDate: new Date('2026-05-15'),
    windowHalf: 'AM',
    vehicleClassId: vc!.id,
    taskClassId: tc!.id,
    confidenceNow: 72,
    kDays: 9,
    expiresAt: new Date(Date.now() + 9 * 86400_000),
  }).returning()

  const newsIds: string[] = []
  if (opts.withNews && opts.withNews > 0) {
    for (let i = 0; i < opts.withNews; i++) {
      const [n] = await db.insert(newsItems).values({
        url: `https://news.example/${label}-${i}`,
        sourceKind: 'MAINSTREAM',
        sourceLabel: '南方日报',
        title: `${label} 新闻标题 #${i}`,
        summaryZh: `${label} 摘要 #${i}`,
        contentHash: `h-${label}-${i}`,
      }).returning()
      newsIds.push(n!.id)
      await db.insert(newsEvidence).values({
        predictionId: p!.id,
        newsId: n!.id,
        weight: 'MED',
      })
    }
  }

  let dispatchId: string | null = null
  if (opts.withDispatch) {
    const [d] = await db.insert(dispatchTasks).values({
      predictionId: p!.id,
      adapterKey: 'mock',
      state: opts.withDispatch.state as
        | 'QUEUED' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
        | 'REJECTED_BY_ADAPTER' | 'CANCEL_PENDING' | 'CANCELLED' | 'TIMED_OUT',
      paramsJson: { mediaCount: opts.withDispatch.mediaCount ?? 0 },
    }).returning()
    dispatchId = d!.id
  }
  return { prediction: p!, newsIds, dispatchId }
}

describe('runRetrospectiveAgent', () => {
  test('Happy path: HIT/CAPTURED writes retrospective + case library entry', async () => {
    const { db } = ctx
    const stamp = `ra-hit-${Date.now()}`
    const { prediction } = await setup(db, stamp, {
      withNews: 2,
      withDispatch: { state: 'COMPLETED', mediaCount: 2 },
    })

    const out = await runRetrospectiveAgent(
      db,
      { predictionId: prediction.id },
      mockInferConst(HIT_OUTPUT),
    )
    expect(out.predictionOutcome).toBe('HIT')
    expect(out.captureOutcome).toBe('CAPTURED')
    expect(out.composite).toBe(86)

    const retros = await db.select().from(retrospectives).where(sql`prediction_id = ${prediction.id}::uuid`)
    expect(retros.length).toBe(1)
    expect(retros[0]!.predictionOutcome).toBe('HIT')
    expect(retros[0]!.captureOutcome).toBe('CAPTURED')
    expect(retros[0]!.scoreV).toBe(90)
    expect(retros[0]!.scoreR).toBe(85)
    expect(retros[0]!.scoreW).toBe(80)
    expect(retros[0]!.scoreT).toBe(88)
    expect(retros[0]!.composite).toBe(86)
    expect(retros[0]!.outcomeOverridden).toBe(false)

    const cases = await db.select().from(caseLibraryEntries).where(sql`retrospective_id = ${retros[0]!.id}::uuid`)
    expect(cases.length).toBe(1)
    expect(cases[0]!.bm25Blob.length).toBeGreaterThan(0)
    expect(cases[0]!.predictionSnapshot).toBeTruthy()
  })

  test('MISS/NOT_CAPTURED path persists correct outcome', async () => {
    const { db } = ctx
    const stamp = `ra-miss-${Date.now()}`
    const { prediction } = await setup(db, stamp, {
      withNews: 1,
      withDispatch: { state: 'COMPLETED', mediaCount: 0 },
    })

    const out = await runRetrospectiveAgent(
      db,
      { predictionId: prediction.id },
      mockInferConst(MISS_OUTPUT),
    )
    expect(out.predictionOutcome).toBe('MISS')
    expect(out.captureOutcome).toBe('NOT_CAPTURED')
    expect(out.composite).toBe(22)

    const [r] = await db.select().from(retrospectives).where(sql`prediction_id = ${prediction.id}::uuid`)
    expect(r!.predictionOutcome).toBe('MISS')
    expect(r!.captureOutcome).toBe('NOT_CAPTURED')
  })

  test('NO_DATA/UNKNOWN path with no news + failed dispatch', async () => {
    const { db } = ctx
    const stamp = `ra-nodata-${Date.now()}`
    const { prediction } = await setup(db, stamp, {
      withDispatch: { state: 'FAILED', mediaCount: 0 },
    })

    const out = await runRetrospectiveAgent(
      db,
      { predictionId: prediction.id },
      mockInferConst(NODATA_OUTPUT),
    )
    expect(out.predictionOutcome).toBe('NO_DATA')
    expect(out.captureOutcome).toBe('UNKNOWN')
    expect(out.composite).toBe(0)

    const [r] = await db.select().from(retrospectives).where(sql`prediction_id = ${prediction.id}::uuid`)
    expect(r!.predictionOutcome).toBe('NO_DATA')
    expect(r!.captureOutcome).toBe('UNKNOWN')
  })

  test('Re-run is idempotent — second call updates the existing retrospective row', async () => {
    const { db } = ctx
    const stamp = `ra-rerun-${Date.now()}`
    const { prediction } = await setup(db, stamp, {
      withNews: 1,
      withDispatch: { state: 'COMPLETED', mediaCount: 1 },
    })

    const out1 = await runRetrospectiveAgent(
      db,
      { predictionId: prediction.id },
      mockInferConst(HIT_OUTPUT),
    )
    const out2 = await runRetrospectiveAgent(
      db,
      { predictionId: prediction.id },
      mockInferConst(MISS_OUTPUT),
    )
    // Same retrospective id, updated content
    expect(out2.retrospectiveId).toBe(out1.retrospectiveId)
    expect(out2.predictionOutcome).toBe('MISS')

    const retros = await db.select().from(retrospectives).where(sql`prediction_id = ${prediction.id}::uuid`)
    expect(retros.length).toBe(1)
    expect(retros[0]!.predictionOutcome).toBe('MISS')
    expect(retros[0]!.composite).toBe(22)

    // Case library entry also updated, not duplicated
    const cases = await db.select().from(caseLibraryEntries).where(sql`retrospective_id = ${retros[0]!.id}::uuid`)
    expect(cases.length).toBe(1)
  })

  test('Schema validation failure: invalid LLM JSON throws and writes nothing', async () => {
    const { db } = ctx
    const stamp = `ra-bad-${Date.now()}`
    const { prediction } = await setup(db, stamp, {
      withNews: 1,
      withDispatch: { state: 'COMPLETED', mediaCount: 1 },
    })

    await expect(
      runRetrospectiveAgent(
        db,
        { predictionId: prediction.id },
        mockInferConst(INVALID_OUTPUT),
      ),
    ).rejects.toThrow()

    const retros = await db.select().from(retrospectives).where(sql`prediction_id = ${prediction.id}::uuid`)
    expect(retros.length).toBe(0)
  })

  test('News titles flow through into the user prompt', async () => {
    const { db } = ctx
    const stamp = `ra-prompt-${Date.now()}`
    const { prediction } = await setup(db, stamp, {
      withNews: 2,
      withDispatch: { state: 'COMPLETED', mediaCount: 1 },
    })

    const { fn, calls } = mockInferCapture(HIT_OUTPUT)
    await runRetrospectiveAgent(db, { predictionId: prediction.id }, fn)

    expect(calls.length).toBe(1)
    const userMsg = calls[0]!.messages.find((m) => m.role === 'user')!.content
    expect(userMsg).toContain(`${stamp} 新闻标题 #0`)
    expect(userMsg).toContain(`${stamp} 新闻标题 #1`)
  })

  test('Reviewer notes flow through into the user prompt', async () => {
    const { db } = ctx
    const stamp = `ra-notes-${Date.now()}`
    const { prediction } = await setup(db, stamp, {
      withNews: 1,
      withDispatch: { state: 'COMPLETED', mediaCount: 1 },
    })

    const { fn, calls } = mockInferCapture(HIT_OUTPUT)
    await runRetrospectiveAgent(
      db,
      { predictionId: prediction.id, reviewerNotes: '此处是测试备注 X-Y-Z' },
      fn,
    )
    const userMsg = calls[0]!.messages.find((m) => m.role === 'user')!.content
    expect(userMsg).toContain('此处是测试备注 X-Y-Z')
  })
})
