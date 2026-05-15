import { loadEnv } from '@/env'
import type { SearchAdapter, SearchHit, SearchOpts } from '../types'
import { enrichPublishedDates } from '../published-date-fetch'

/**
 * Yunwu DeepResearch SearchAdapter — 走 Yunwu 代理调 *-all 系列模型(gemini-2.5-flash-all,
 * gpt-5.1-all 等),模型自动 invoke 内置 search 工具。OpenAI-compatible streaming API。
 *
 * Plan-PP fix8(对齐 `测试任务/yunwu_search.py`):
 *  - 单条 user message(去 system,避免误导工具调用)
 *  - `stream: true` 流式读取 → 非流式调用时 Yunwu 会把 `> search(...)` 工具状态行
 *    和真正回答合并成一条,常常只看到状态行;流式读取能拿到完整对话(状态行 + 真答案)
 *  - 自然中文 prompt + 内嵌 JSON 输出示例,不再编号约束
 *  - 解析时 strip 掉 `> ` 开头的工具状态行,再用四级 JSON 容错抽数组
 *  - 按 URL 合并去重 / publishedAt HTML 兜底 / 失败 graceful 返空(沿用)
 */

function buildUserMsg(keyword: string, days: number): string {
  return [
    `请以列表的 JSON 格式输出:最近 ${days} 天内,关于「${keyword}」的相关中文新闻。`,
    `要求 JSON 列表中每一项都含以下字段:title(新闻标题)、url(新闻原文链接,必须真实可访问)、snippet(50 字内摘要)、publishedAt(YYYY-MM-DD)。`,
    `输出示例:`,
    `[{"title": "xxx", "url": "https://xxx.cn/yyy", "snippet": "xxx", "publishedAt": "2026-05-10"}, ...]`,
    `约束:`,
    `- URL 必须来自中文媒体(.cn / .com.cn / .gov.cn 系或新华/人民/澎湃/南方/广州日报等)`,
    `- 严格 ${days} 天内发布`,
    `- 最多 10 条,按相关性排序`,
    `- 如无符合,输出 []`,
  ].join('\n')
}

type RawHit = {
  title?: unknown
  url?: unknown
  snippet?: unknown
  publishedAt?: unknown
}

export class YunwuDrSearchAdapter implements SearchAdapter {
  readonly key = 'yunwu-dr'
  readonly kind = 'yunwu-dr' as const

  private cache = new Map<string, { hits: SearchHit[]; expiresAt: number }>()

  async query(keywords: string[], opts: SearchOpts = {}): Promise<SearchHit[]> {
    const env = loadEnv()
    if (!env.YUNWU_API_KEY) {
      console.warn('[yunwu-dr] no API key, returning empty hits (degraded)')
      return []
    }
    const cleanKeywords = keywords.map((k) => k.trim()).filter((k) => k.length > 0)
    if (cleanKeywords.length === 0) return []

    const days = opts.freshnessDays ?? env.NEWS_FRESHNESS_DAYS
    const merged = new Map<string, SearchHit>()
    for (const kw of cleanKeywords) {
      const hits = await this.queryOne(kw, env.YUNWU_BASE_URL, env.YUNWU_API_KEY, env.YUNWU_MODEL, env.YUNWU_TIMEOUT_MS, days)
      for (const h of hits) {
        if (!h.url) continue
        if (!merged.has(h.url)) merged.set(h.url, h)
      }
    }
    const unique = Array.from(merged.values())
    const enriched = await enrichPublishedDates(unique, 4)
    const withDate = enriched.filter((h) => h.publishedAt).length
    console.log(
      `[yunwu-dr] queried ${cleanKeywords.length} keywords → ${enriched.length} unique hits, ` +
      `${withDate} with publishedAt (${enriched.length - withDate} unknown-date will be dropped)`,
    )
    return enriched
  }

  private async queryOne(
    keyword: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    timeoutMs: number,
    days: number,
  ): Promise<SearchHit[]> {
    const cacheKey = JSON.stringify({ keyword, days, model })
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.hits

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'user', content: buildUserMsg(keyword, days) },
          ],
          stream: true,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.warn(`[yunwu-dr] HTTP ${res.status} for "${keyword}", body=${body.slice(0, 200)}`)
        return []
      }
      const fullContent = await consumeSseStream(res)
      console.log(`[yunwu-dr] keyword="${keyword}" stream content (len=${fullContent.length}, first 500):\n${fullContent.slice(0, 500)}`)
      const stripped = stripToolStatusLines(fullContent)
      const hits = parseHitsFromContent(stripped)
      console.log(`[yunwu-dr] keyword="${keyword}" parsed → ${hits.length} hits`)
      this.cache.set(cacheKey, { hits, expiresAt: Date.now() + 24 * 3600_000 })
      return hits
    } catch (e) {
      console.error(`[yunwu-dr] fetch error for "${keyword}": ${(e as Error).message}`)
      return []
    }
  }
}

/**
 * 读取 OpenAI 兼容 SSE 流,拼接所有 `data: {...}` 帧的 `choices[0].delta.content`,
 * 直到 `data: [DONE]` 或流结束。
 */
async function consumeSseStream(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let content = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // 按 SSE 帧分隔(空行)切
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        for (const line of frame.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (!data || data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const delta = parsed.choices?.[0]?.delta?.content
            if (typeof delta === 'string') content += delta
          } catch {
            // 单帧 JSON 解析失败,跳过(可能是 Yunwu 附加的 ping 或非标帧)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return content
}

/**
 * 剥掉 `> search(...)` `> tool(...)` 这类工具调用状态行,只留模型真答案。
 * Yunwu 的 *-all 模型流式输出里,每次工具调用会先发 `> ...` 状态行,然后才是结果。
 */
export function stripToolStatusLines(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^\s*>\s/.test(line))
    .join('\n')
    .trim()
}

/** 从 LLM 输出里提 JSON 数组,容错 Markdown 包裹 / 多余前缀文字。 */
export function parseHitsFromContent(content: string): SearchHit[] {
  const raw = content.trim()
  if (!raw) return []
  // 1) 直接 parse
  const direct = tryParseArray(raw)
  if (direct) return mapToHits(direct)
  // 2) 剥 ```json ... ``` 包裹
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced && fenced[1]) {
    const inner = tryParseArray(fenced[1].trim())
    if (inner) return mapToHits(inner)
  }
  // 3) 正则提第一个 [...] 块
  const bracket = raw.match(/\[[\s\S]*\]/)
  if (bracket) {
    const inner = tryParseArray(bracket[0])
    if (inner) return mapToHits(inner)
  }
  console.warn('[yunwu-dr] could not parse JSON array from content:', raw.slice(0, 200))
  return []
}

function tryParseArray(s: string): RawHit[] | null {
  try {
    const parsed = JSON.parse(s)
    if (Array.isArray(parsed)) return parsed as RawHit[]
    // Yunwu / Gemini 有时把数组包在 `{results: [...]}` 这种对象里
    if (parsed && typeof parsed === 'object') {
      for (const v of Object.values(parsed as Record<string, unknown>)) {
        if (Array.isArray(v)) return v as RawHit[]
      }
    }
    return null
  } catch {
    return null
  }
}

function mapToHits(raw: RawHit[]): SearchHit[] {
  const out: SearchHit[] = []
  for (const r of raw) {
    const url = typeof r.url === 'string' ? r.url.trim() : ''
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    if (!url || !title) continue
    const snippet = typeof r.snippet === 'string' ? r.snippet : ''
    const domain = (() => {
      try { return new URL(url).hostname } catch { return 'yunwu-dr' }
    })()
    const hit: SearchHit = {
      title,
      url,
      snippet,
      source: { name: domain, kind: 'mainstream' as const },
    }
    if (typeof r.publishedAt === 'string' && r.publishedAt.trim()) {
      hit.publishedAt = r.publishedAt.trim()
    }
    out.push(hit)
  }
  return out
}
