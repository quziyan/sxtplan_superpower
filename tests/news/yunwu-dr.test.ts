import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { resetEnvCacheForTests } from '@/env'
import { YunwuDrSearchAdapter, parseHitsFromContent, stripToolStatusLines } from '@/news/adapters/yunwu-dr'

/**
 * Build an SSE ReadableStream from a single content string — emits one delta frame +
 * `data: [DONE]`. Mirrors what Yunwu / OAI-compat servers send back when stream=true.
 */
function sseResponse(content: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      // Single big delta frame is fine — the consumer concatenates regardless of chunking
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`))
      controller.enqueue(enc.encode(`data: [DONE]\n\n`))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('YunwuDrSearchAdapter', () => {
  let originalFetch: typeof globalThis.fetch
  let envSnapshot: Record<string, string | undefined>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    envSnapshot = {
      YUNWU_API_KEY: process.env.YUNWU_API_KEY,
      YUNWU_BASE_URL: process.env.YUNWU_BASE_URL,
      YUNWU_MODEL: process.env.YUNWU_MODEL,
    }
    resetEnvCacheForTests()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    resetEnvCacheForTests()
  })

  test('happy path: 流式 SSE → 拼接 content → JSON 解析 → SearchHits', async () => {
    process.env.YUNWU_API_KEY = 'sk-test'
    resetEnvCacheForTests()
    const calls: { url: string; body: any }[] = []
    globalThis.fetch = (async (url: any, init: any) => {
      const body = JSON.parse(init.body)
      calls.push({ url: url.toString(), body })
      const kw = body.messages[0].content
      // 用「关键词」的尖括号匹配,避免 prompt 模板里其他 "广州" 字面影响测试分支
      if (kw.includes('「广州 安保」')) {
        return sseResponse('[{"title":"广州治安","url":"https://news.example.com.cn/a","snippet":"sm","publishedAt":"2026-05-07"}]')
      }
      return sseResponse('[{"title":"安全生产","url":"https://news.example.com.cn/b","snippet":"sm","publishedAt":"2026-05-08"}]')
    }) as any

    const adapter = new YunwuDrSearchAdapter()
    const hits = await adapter.query(['广州 安保', '安全 生产'])
    expect(calls).toHaveLength(2)
    // 单条 user message,no system
    expect(calls[0]!.body.messages).toHaveLength(1)
    expect(calls[0]!.body.messages[0].role).toBe('user')
    expect(calls[0]!.body.stream).toBe(true)
    expect(calls[0]!.body.messages[0].content).toContain('「广州 安保」')
    expect(hits).toHaveLength(2)
    expect(hits.map((h) => h.url).sort()).toEqual([
      'https://news.example.com.cn/a',
      'https://news.example.com.cn/b',
    ])
    expect(hits.every((h) => h.publishedAt)).toBe(true)
  })

  test('SSE 多帧拼接 + strip 工具状态行 → 真 JSON 答案', async () => {
    process.env.YUNWU_API_KEY = 'sk-test'
    resetEnvCacheForTests()
    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder()
          // 模拟真实 Yunwu 流:工具状态行 + 真答案分帧
          const frames = [
            `> search("查询中文新闻")\n`,
            `\n[`,
            `{"title":"x","url":"https://a.cn","snippet":"","publishedAt":"2026-05-09"}`,
            `]`,
          ]
          for (const f of frames) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: f } }] })}\n\n`))
          }
          controller.enqueue(enc.encode(`data: [DONE]\n\n`))
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    }) as any

    const adapter = new YunwuDrSearchAdapter()
    const hits = await adapter.query(['kw'])
    expect(hits).toHaveLength(1)
    expect(hits[0]!.url).toBe('https://a.cn')
  })

  test('URL 去重:两个 keyword 召回相同 URL → 只算一条', async () => {
    process.env.YUNWU_API_KEY = 'sk-test'
    resetEnvCacheForTests()
    globalThis.fetch = (async () =>
      sseResponse('[{"title":"同一篇","url":"https://news.example.com.cn/dup","snippet":"","publishedAt":"2026-05-09"}]')
    ) as any

    const adapter = new YunwuDrSearchAdapter()
    const hits = await adapter.query(['kw1', 'kw2'])
    expect(hits).toHaveLength(1)
  })

  test('no API key: 返空 + 不发请求', async () => {
    process.env.YUNWU_API_KEY = ''
    resetEnvCacheForTests()
    let called = false
    globalThis.fetch = (async () => { called = true; return new Response('', { status: 200 }) }) as any

    const adapter = new YunwuDrSearchAdapter()
    const hits = await adapter.query(['x'])
    expect(hits).toEqual([])
    expect(called).toBe(false)
  })

  test('HTTP 500: 该 keyword 返空但不抛', async () => {
    process.env.YUNWU_API_KEY = 'sk-test'
    resetEnvCacheForTests()
    globalThis.fetch = (async () => new Response('upstream error', { status: 500 })) as any

    const adapter = new YunwuDrSearchAdapter()
    const hits = await adapter.query(['x'])
    expect(hits).toEqual([])
  })

  test('SSE 全是工具状态行/废话,无 JSON: 返空', async () => {
    process.env.YUNWU_API_KEY = 'sk-test'
    resetEnvCacheForTests()
    globalThis.fetch = (async () => sseResponse('> search("xxx")\nthis is not JSON at all')) as any

    const adapter = new YunwuDrSearchAdapter()
    const hits = await adapter.query(['x'])
    expect(hits).toEqual([])
  })
})

describe('stripToolStatusLines', () => {
  test('剥 `> ` 开头的行', () => {
    const input = '> search("xxx")\n[{"a":1}]'
    expect(stripToolStatusLines(input)).toBe('[{"a":1}]')
  })
  test('多条状态行', () => {
    const input = '> search(...)\n> tool(...)\n  > nested\n[done]'
    expect(stripToolStatusLines(input)).toBe('[done]')
  })
  test('无状态行原样返回', () => {
    expect(stripToolStatusLines('[1,2,3]')).toBe('[1,2,3]')
  })
})

describe('parseHitsFromContent', () => {
  test('直接 JSON array', () => {
    const hits = parseHitsFromContent('[{"title":"t","url":"https://a.cn","snippet":"s","publishedAt":"2026-05-09"}]')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.title).toBe('t')
    expect(hits[0]!.publishedAt).toBe('2026-05-09')
  })

  test('剥 ```json 包裹', () => {
    const content = '```json\n[{"title":"t","url":"https://a.cn"}]\n```'
    const hits = parseHitsFromContent(content)
    expect(hits).toHaveLength(1)
  })

  test('剥多余前缀 + 抓 [...] 块', () => {
    const content = '搜索完成,以下是结果:\n[{"title":"t","url":"https://a.cn"}]\n谢谢'
    const hits = parseHitsFromContent(content)
    expect(hits).toHaveLength(1)
  })

  test('对象包数组 {results:[...]}', () => {
    const content = '{"results":[{"title":"t","url":"https://a.cn"}]}'
    const hits = parseHitsFromContent(content)
    expect(hits).toHaveLength(1)
  })

  test('丢弃缺 url 或 title 的条目', () => {
    const content = '[{"title":"","url":"x"},{"title":"t","url":""},{"title":"good","url":"https://a.cn"}]'
    const hits = parseHitsFromContent(content)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.title).toBe('good')
  })

  test('空字符串/废话 → 空数组', () => {
    expect(parseHitsFromContent('')).toEqual([])
    expect(parseHitsFromContent('not parseable garbage')).toEqual([])
  })
})
