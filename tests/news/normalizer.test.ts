import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ingestHit } from '@/news/normalizer'
import type { SearchHit } from '@/news/types'
import { createTestDb } from '../helpers/test-db'

let ctx: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => { ctx = await createTestDb() })
afterAll(async () => { await ctx.cleanup() })

const makeHit = (id: number): SearchHit => ({
  url: `https://example.com/news/${id}-${Date.now()}`,
  title: `测试新闻 ${id}`,
  snippet: 'a'.repeat(500),  // 500 chars,会被截到 280
  publishedAt: '2026-05-01T08:00:00Z',
  source: { name: '南方日报', kind: 'mainstream' },
})

describe('ingestHit', () => {
  test('first call inserts isNew=true with hash + truncated summary', async () => {
    const hit = makeHit(1)
    const r = await ingestHit(ctx.db, hit)
    expect(r.isNew).toBe(true)
    expect(r.news.url).toBe(hit.url)
    expect(r.news.sourceKind).toBe('MAINSTREAM')
    expect(r.news.summaryZh!.length).toBe(280)
    expect(r.news.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(r.news.publishedAt).not.toBeNull()
  })

  test('second call with same URL returns isNew=false', async () => {
    const hit = makeHit(2)
    const r1 = await ingestHit(ctx.db, hit)
    const r2 = await ingestHit(ctx.db, hit)
    expect(r1.isNew).toBe(true)
    expect(r2.isNew).toBe(false)
    expect(r2.news.id).toBe(r1.news.id)
  })

  test('handles missing publishedAt', async () => {
    const hit = makeHit(3)
    const { publishedAt: _, ...rest } = hit
    const r = await ingestHit(ctx.db, rest)
    expect(r.news.publishedAt).toBeNull()
  })

  test('source kind mapping covers all 4 values', async () => {
    const stamps = [Date.now(), Date.now() + 1, Date.now() + 2, Date.now() + 3]
    const cases: Array<['mainstream' | 'gov' | 'social' | 'foreign', 'MAINSTREAM' | 'GOV' | 'SOCIAL' | 'FOREIGN']> = [
      ['mainstream', 'MAINSTREAM'], ['gov', 'GOV'], ['social', 'SOCIAL'], ['foreign', 'FOREIGN'],
    ]
    for (let i = 0; i < cases.length; i++) {
      const [inputKind, expectedDbKind] = cases[i]!
      const hit: SearchHit = {
        url: `https://kind.example/${stamps[i]}`,
        title: 't', snippet: 's',
        source: { name: 'src', kind: inputKind },
      }
      const r = await ingestHit(ctx.db, hit)
      expect(r.news.sourceKind).toBe(expectedDbKind)
    }
  })

  test('contentHash differs for different urls', async () => {
    const a = await ingestHit(ctx.db, { ...makeHit(10), url: `https://hash.example/a-${Date.now()}` })
    const b = await ingestHit(ctx.db, { ...makeHit(10), url: `https://hash.example/b-${Date.now()}` })
    expect(a.news.contentHash).not.toBe(b.news.contentHash)
  })
})
