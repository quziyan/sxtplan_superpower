import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { fetchAndPersist, type FetcherDeps } from '@/media/fetcher'
import { dispatchTasks, mediaAssets } from '@/db/schema/dispatch'
import { predictions } from '@/db/schema/prediction'
import { taskClasses, vehicleClasses } from '@/db/schema/taxonomy'
import { RETENTION_DAYS } from '@/media/retention'
import { createTestDb } from '../helpers/test-db'
import { makeOssStub } from '../helpers/oss-stub'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const poly: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[120, 30], [121, 30], [121, 31], [120, 31], [120, 30]]],
}

async function createDispatchRow(db: typeof ctx.db, label: string): Promise<string> {
  const reg = (await db.execute<{ id: string; version: number }>(sql`
    INSERT INTO regions (kind, name, version, geom)
    VALUES ('AD_HOC', ${label}, 1, ST_GeomFromGeoJSON(${JSON.stringify(poly)}))
    RETURNING id, version
  `))[0]!
  const [vc] = await db.insert(vehicleClasses).values({ name: `v-${label}`, level: 1 }).returning()
  const [tc] = await db.insert(taskClasses).values({ name: `t-${label}`, level: 1 }).returning()
  const [p] = await db.insert(predictions).values({
    sourceKind: 'WATCHLIST', sourceId: vc!.id,
    regionId: reg.id, regionVersion: reg.version,
    windowDate: new Date('2026-05-15'), windowHalf: 'AM',
    vehicleClassId: vc!.id, taskClassId: tc!.id,
    kDays: 9, expiresAt: new Date(Date.now() + 9 * 86_400_000),
  }).returning()
  const [task] = await db.insert(dispatchTasks).values({
    predictionId: p!.id,
    adapterKey: 'mock',
    state: 'SENT',
  }).returning()
  return task!.id
}

const ORIGINAL_FETCH = globalThis.fetch

function mockFetch(body: Uint8Array, init: { ok?: boolean; status?: number } = {}): typeof fetch {
  return (async (_url: unknown) => {
    const ok = init.ok ?? true
    const status = init.status ?? 200
    return {
      ok,
      status,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    } as unknown as Response
  }) as unknown as typeof fetch
}

describe('fetchAndPersist (MediaFetcher)', () => {
  beforeEach(() => { /* per-test fetch swap installed inside each test */ })
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH })

  test('happy path: fetch → buffer → OSS → MediaAsset row (image → .jpg)', async () => {
    const { db } = ctx
    const dispatchId = await createDispatchRow(db, `media-happy-${Date.now()}`)
    const payload = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]) // fake JPEG magic
    const expectedSha = createHash('sha256').update(Buffer.from(payload)).digest('hex')
    const expectedKey = `media/${dispatchId}/${expectedSha.slice(0, 12)}.jpg`

    globalThis.fetch = mockFetch(payload)

    const oss = makeOssStub('oss://test-bucket/')
    const deps: FetcherDeps = { oss }

    const before = Date.now()
    const row = await fetchAndPersist(
      db,
      { dispatchId, sourceUrl: 'https://example.test/photo.jpg', mediaType: 'image' },
      deps,
    )
    const after = Date.now()

    // OssAdapter.put got the right key + payload
    expect(oss._calls.length).toBe(1)
    expect(oss._calls[0]!.key).toBe(expectedKey)
    expect(oss._calls[0]!.size).toBe(payload.byteLength)

    // Returned row reflects what we inserted
    expect(row.dispatchId).toBe(dispatchId)
    expect(row.ossUri).toBe(`oss://test-bucket/${expectedKey}`)
    expect(row.sourceUrl).toBe('https://example.test/photo.jpg')
    expect(row.mediaType).toBe('image')
    expect(row.sizeBytes).toBe(payload.byteLength)
    expect(row.sha256).toBe(expectedSha)
    expect(row.scanStatus).toBe('OK')

    // retentionUntil is now + 365 days (allow generous tolerance)
    expect(row.retentionUntil).not.toBeNull()
    const retMs = row.retentionUntil!.getTime()
    const expectedMin = before + RETENTION_DAYS * 86_400_000 - 5_000
    const expectedMax = after + RETENTION_DAYS * 86_400_000 + 5_000
    expect(retMs).toBeGreaterThanOrEqual(expectedMin)
    expect(retMs).toBeLessThanOrEqual(expectedMax)

    // DB-side verification: row is actually persisted
    const fetched = await db.select().from(mediaAssets).where(eq(mediaAssets.id, row.id))
    expect(fetched.length).toBe(1)
    expect(fetched[0]!.sha256).toBe(expectedSha)
  })

  test('non-2xx fetch throws and does not call OssAdapter.put or insert a row', async () => {
    const { db } = ctx
    const dispatchId = await createDispatchRow(db, `media-404-${Date.now()}`)
    globalThis.fetch = mockFetch(new Uint8Array(), { ok: false, status: 404 })

    const oss = makeOssStub()
    const deps: FetcherDeps = { oss }

    await expect(
      fetchAndPersist(
        db,
        { dispatchId, sourceUrl: 'https://example.test/missing.jpg', mediaType: 'image' },
        deps,
      ),
    ).rejects.toThrow(/fetch https:\/\/example\.test\/missing\.jpg → 404/)

    expect(oss._calls.length).toBe(0)
    const rows = await db.select().from(mediaAssets).where(eq(mediaAssets.dispatchId, dispatchId))
    expect(rows.length).toBe(0)
  })

  test('extension mapping: image→jpg, video→mp4, metadata→json', async () => {
    const { db } = ctx
    const cases: Array<{ mediaType: 'image' | 'video' | 'metadata'; ext: string }> = [
      { mediaType: 'image', ext: 'jpg' },
      { mediaType: 'video', ext: 'mp4' },
      { mediaType: 'metadata', ext: 'json' },
    ]
    for (const c of cases) {
      const dispatchId = await createDispatchRow(db, `media-ext-${c.mediaType}-${Date.now()}`)
      // Distinct payload per case so sha256 differs and key is unique
      const payload = new Uint8Array([c.mediaType.charCodeAt(0), 1, 2, 3])
      globalThis.fetch = mockFetch(payload)
      const oss = makeOssStub('oss://test-bucket/')
      const deps: FetcherDeps = { oss }
      const row = await fetchAndPersist(
        db,
        { dispatchId, sourceUrl: `https://example.test/${c.mediaType}`, mediaType: c.mediaType },
        deps,
      )
      expect(row.ossUri.endsWith(`.${c.ext}`)).toBe(true)
    }
  })

  test('retentionUntil is now + 365 * 86_400_000 ms (within ±5s)', async () => {
    const { db } = ctx
    const dispatchId = await createDispatchRow(db, `media-ret-${Date.now()}`)
    const payload = new Uint8Array([1, 2, 3, 4])
    globalThis.fetch = mockFetch(payload)
    const oss = makeOssStub('oss://test-bucket/')
    const deps: FetcherDeps = { oss }

    const before = Date.now()
    const row = await fetchAndPersist(
      db,
      { dispatchId, sourceUrl: 'https://example.test/r.jpg', mediaType: 'image' },
      deps,
    )
    const after = Date.now()

    expect(row.retentionUntil).not.toBeNull()
    const delta = row.retentionUntil!.getTime() - before
    expect(delta).toBeGreaterThanOrEqual(RETENTION_DAYS * 86_400_000 - 5_000)
    expect(delta).toBeLessThanOrEqual((after - before) + RETENTION_DAYS * 86_400_000 + 5_000)
  })
})
