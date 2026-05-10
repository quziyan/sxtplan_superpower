import { describe, expect, test } from 'bun:test'
import { filterHits, rerankHits } from '@/news/relevance'
import type { SearchHit } from '@/news/types'
import type { infer as inferFnType } from '@/inference/client'

function hit(opts: Partial<SearchHit>): SearchHit {
  return {
    title: opts.title ?? '广州警方夜查酒驾',
    url: opts.url ?? 'https://example.cn/a',
    snippet: opts.snippet ?? '',
    source: opts.source ?? { name: 'example.cn', kind: 'mainstream' as const },
    ...(opts.publishedAt ? { publishedAt: opts.publishedAt } : {}),
  }
}

describe('relevance — filterHits (rule-based)', () => {
  test('drops hits with no CJK in title and snippet', () => {
    const r = filterHits([
      hit({ title: '广州治安巡逻', snippet: 'foo bar' }),                  // CJK in title → keep
      hit({ title: 'San Fernando crime spree', snippet: 'no chinese' }),  // no CJK → drop
      hit({ title: 'LA crime', snippet: '广州交警' }),                       // CJK in snippet → keep
    ])
    expect(r.length).toBe(2)
    expect(r[0]!.title).toContain('广州')
  })

  test('drops English domain blocklist', () => {
    const r = filterHits([
      hit({ title: '广州 LAPD report', url: 'https://www.cbsnews.com/x' }),  // CJK + blocked domain
      hit({ title: '广州交警', url: 'https://news.gd.gov.cn/y' }),
    ])
    expect(r.length).toBe(1)
    expect(r[0]!.url).toContain('gd.gov.cn')
  })

  test('drops too-short titles', () => {
    const r = filterHits([
      hit({ title: '广', url: 'https://x.cn/1' }),  // CJK ✓ but title=1 char,< 4
      hit({ title: '广州治安巡逻', url: 'https://x.cn/2' }),
    ])
    expect(r.length).toBe(1)
  })

  test('drops www. prefix correctly when matching blocklist', () => {
    const r = filterHits([
      hit({ title: '广州 news', url: 'https://www.cbsnews.com/abc' }),
      hit({ title: '广州 news', url: 'https://cbsnews.com/abc' }),
      hit({ title: '广州 news', url: 'https://news.example.cn/abc' }),
    ])
    expect(r.length).toBe(1)
    expect(r[0]!.url).toContain('example.cn')
  })
})

describe('relevance — rerankHits (LLM batch)', () => {
  test('happy path: 3 hits, threshold=50, LLM scores 80/40/60 → keeps 80,60 (drops 40)', async () => {
    const hits = [hit({ title: '高分新闻 80' }), hit({ title: '低分新闻 40' }), hit({ title: '中等新闻 60' })]
    const fakeInfer: typeof inferFnType = async () => ({
      text: JSON.stringify({
        scores: [
          { idx: 0, relevance: 80, reason: 'fit' },
          { idx: 1, relevance: 40, reason: 'edge' },
          { idx: 2, relevance: 60, reason: 'ok' },
        ],
      }),
      promptTokens: 0, completionTokens: 0, totalTokens: 0, model: 'fake',
    })
    const r = await rerankHits(hits, 'q', 'r', { threshold: 50, inferFn: fakeInfer })
    expect(r.degraded).toBe(false)
    expect(r.kept).toBe(2)
    expect(r.hits.length).toBe(2)
    // 降序:80 在前
    expect(r.hits[0]!.title).toContain('80')
    expect(r.hits[1]!.title).toContain('60')
  })

  test('LLM fail → fallback filter-only (degraded=true, returns input)', async () => {
    const hits = [hit({ title: '新闻 1' }), hit({ title: '新闻 2' })]
    const failInfer: typeof inferFnType = async () => { throw new Error('LLM down') }
    const r = await rerankHits(hits, 'q', 'r', { inferFn: failInfer })
    expect(r.degraded).toBe(true)
    expect(r.hits.length).toBe(2)  // input 透传
  })

  test('empty hits → empty output, no LLM call', async () => {
    let llmCalled = false
    const trapInfer: typeof inferFnType = async () => {
      llmCalled = true
      return { text: '', promptTokens: 0, completionTokens: 0, totalTokens: 0, model: 'x' }
    }
    const r = await rerankHits([], 'q', 'r', { inferFn: trapInfer })
    expect(r.hits.length).toBe(0)
    expect(llmCalled).toBe(false)
  })

  test('threshold=0 → keeps all', async () => {
    const hits = [hit({ title: 'a' }), hit({ title: 'b' })]
    const fakeInfer: typeof inferFnType = async () => ({
      text: JSON.stringify({ scores: [{ idx: 0, relevance: 5, reason: 'low' }, { idx: 1, relevance: 10, reason: 'low' }] }),
      promptTokens: 0, completionTokens: 0, totalTokens: 0, model: 'fake',
    })
    const r = await rerankHits(hits, 'q', 'r', { threshold: 0, inferFn: fakeInfer })
    expect(r.kept).toBe(2)
  })

  test('LLM bad output (missing idx) → degraded fallback', async () => {
    const hits = [hit({ title: 'a' })]
    const badInfer: typeof inferFnType = async () => ({
      text: '{ "scores": [{ "relevance": 80 }] }',  // 缺 idx
      promptTokens: 0, completionTokens: 0, totalTokens: 0, model: 'fake',
    })
    const r = await rerankHits(hits, 'q', 'r', { inferFn: badInfer })
    expect(r.degraded).toBe(true)
  })
})
