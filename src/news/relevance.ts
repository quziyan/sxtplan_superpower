import { infer } from '@/inference/client'
import { extractJson } from '@/inference/parser'
import { loadEnv } from '@/env'
import {
  NEWS_RELEVANCE_SYSTEM,
  RerankOutputSchema,
  renderRerankUserMsg,
  type RerankOutput,
} from '@/inference/prompts/news-relevance'
import type { SearchHit } from './types'

/**
 * 三段式新闻相关性流水线 — Plan-M。
 *
 *   粗召回(Tavily/gov adapter ~20 hit)
 *     → 过滤(filterHits,规则 0-LLM)
 *     → 精排(rerankHits,1 次 LLM batch 评分)
 *     → top-K(阈值截断)
 *     → news-ingest 写库 + 后续 triage
 *
 * 设计:
 *  - filterHits 是 hot path,纯规则,O(N) 扫一遍。返回 partition {kept, dropped}
 *    以便 pipeline panel 展示丢弃原因。
 *  - rerankHits 一次 LLM batch 调用对 ≤ maxToRerank 条评分,失败降级返原列表(不崩)。
 *    返回 dropped 含 below-threshold 与 over-cap 两种原因。
 *  - 阈值通过 env RELEVANCE_THRESHOLD(默认 50)/ settings 表覆盖。
 */

// A+B+C combo:
//  - 黑名单兜底:Tavily 偶尔返英美本地新闻
//  - 白名单优先:命中即直通(.cn / .gov.cn / 主流中文媒体)
//  - 不再硬丢 no-cjk:非白非黑的英文 hit 进 LLM 精排,由分数兜底
const ENGLISH_DOMAIN_BLOCKLIST = new Set([
  // 全球大媒体
  'cbsnews.com', 'latimes.com', 'newsweek.com', 'nytimes.com',
  'washingtonpost.com', 'bbc.com', 'cnn.com', 'foxnews.com',
  'reuters.com', 'apnews.com', 'usatoday.com', 'wsj.com',
  'bloomberg.com', 'theguardian.com',
  // 实测样本里见过的美国地方/小站
  'greenwichtime.com', 'tampa.gov', 'startribune.com',
  'global-agriculture.com', 'nbcnews.com', 'abcnews.go.com',
])

// 中文媒体白名单 — Plan-PP fix6:配合英文子域前缀黑名单,可放心收 .com 中文媒体。
// host 必须 exact match 或子域(下方 isChineseDomain 用 endsWith 兜)。
// .cn 系 TLD 通过 CN_TLD_SUFFIXES 通配兜底,无需列。
const CHINESE_DOMAIN_WHITELIST = new Set([
  // 央媒
  'xinhuanet.com', 'people.com.cn', 'peopledaily.com.cn',
  'cctv.com', 'chinanews.com.cn', 'china.com.cn',
  // 主流商业 / 财经 / 科技
  'sina.com.cn', 'sina.cn', 'qq.com', '163.com', 'sohu.com', 'ifeng.com',
  'caixin.com', 'huxiu.com',
  // 广东本地
  'nfnews.com', 'dayoo.com', 'southcn.com', 'oeeee.com',
  // 社交
  'weibo.com',
])

const CN_TLD_SUFFIXES = ['.cn', '.com.cn', '.gov.cn', '.org.cn', '.net.cn', '.edu.cn']

// Plan-PP fix6:英文子域前缀黑名单 — 即便 Tavily 扩到 `en.people.com.cn`
// `eu.36kr.com` `english.china.com.cn` 这类英文版,在 client 兜底丢掉。
const ENGLISH_SUBDOMAIN_PREFIXES = ['en.', 'english.', 'eu.', 'us.', 'global.', 'intl.', 'international.']

function hasCjk(s: string): boolean {
  return /[一-鿿㐀-䶿]/.test(s)
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') }
  catch { return '' }
}

function isChineseDomain(host: string): boolean {
  // 1. 英文子域前缀直接否决(en./eu./english./global. 系列)
  if (ENGLISH_SUBDOMAIN_PREFIXES.some((p) => host.startsWith(p))) return false
  // 2. 白名单 exact match 或子域(`epaper.nfnews.com` 通过 `nfnews.com` 命中)
  if (CHINESE_DOMAIN_WHITELIST.has(host)) return true
  for (const w of CHINESE_DOMAIN_WHITELIST) {
    if (host.endsWith('.' + w)) return true
  }
  // 3. CN 系 TLD 兜底
  return CN_TLD_SUFFIXES.some((s) => host.endsWith(s))
}

/** Pipeline trace 中每条丢弃记录的 reason 标签(枚举,前端按需翻译/着色)。 */
export type DropReason =
  | 'no-url'
  | 'no-title'
  | 'short-title'
  | 'no-cjk'
  | 'blocklist'
  | 'expired'
  | 'unknown-date'
  | 'non-chinese-domain'
  | 'duplicate'
  | 'below-threshold'
  | 'over-cap'

export type DropEntry = {
  url: string
  title: string
  reason: DropReason
  /** Optional extra (e.g. rerank score) — 前端展示用 */
  detail?: string
}

export type FilterResult = {
  kept: SearchHit[]
  dropped: DropEntry[]
}

/**
 * 规则过滤 — pure / 同步。规则顺序 + drop 原因(Plan-PP fix4:严格中文门禁):
 *  - title 太短(< 4 chars) → short-title
 *  - hostname 在英文媒体黑名单 → blocklist
 *  - hostname **不在中文白名单 且 不是 .cn 系 TLD** → non-chinese-domain
 *  - 通过 = 进入下游(freshness → LLM 精排)
 *
 * 升级:白名单从"通行证"变"门禁"——非中文域硬丢,Tavily 的语义召回保留,
 * 但链接侧只放中文站。
 */
export function filterHits(hits: SearchHit[]): FilterResult {
  const kept: SearchHit[] = []
  const dropped: DropEntry[] = []
  for (const h of hits) {
    if (!h.title || h.title.length < 4) {
      dropped.push({ url: h.url, title: h.title ?? '', reason: 'short-title' })
      continue
    }
    const host = hostnameOf(h.url)
    if (ENGLISH_DOMAIN_BLOCKLIST.has(host)) {
      dropped.push({ url: h.url, title: h.title, reason: 'blocklist' })
      continue
    }
    if (!isChineseDomain(host)) {
      dropped.push({ url: h.url, title: h.title, reason: 'non-chinese-domain', detail: host })
      continue
    }
    kept.push(h)
  }
  return { kept, dropped }
}

// 暴露给 stage trace / 测试,内部规则参数(供 pipeline panel 展示)。
export const FILTER_RULES_META = {
  min_title_len: 4,
  blocklist_count: ENGLISH_DOMAIN_BLOCKLIST.size,
  whitelist_count: CHINESE_DOMAIN_WHITELIST.size,
  cn_tld_suffixes: CN_TLD_SUFFIXES,
  cjk_required: false,
}

// 测试 / 调试用
export function _isChineseDomain(host: string): boolean { return isChineseDomain(host) }

export type RerankOpts = {
  threshold?: number
  /** 上限:超过此数的 hit 不送 LLM(成本控制),按原序前 N */
  maxToRerank?: number
  /** 测试 / 失败注入 */
  inferFn?: typeof infer
}

export type RerankResult = {
  hits: SearchHit[]
  raw: number
  kept: number
  degraded: boolean
  /** 被丢弃的 hit:over-cap(超过 maxToRerank)或 below-threshold(score 低)。
   *  degraded 时 dropped 为空(降级路径未评分,无法判定丢弃)。*/
  dropped: DropEntry[]
  /** 实际生效的阈值/上限,供 trace 展示。 */
  thresholdUsed: number
  maxToRerankUsed: number
}

/**
 * LLM 精排 — 1 次 batch 调用,失败降级返 input(filter-only output)。
 * 返回按 LLM 评分降序、过阈值后的 SearchHit[] 与 dropped 明细。
 */
export async function rerankHits(
  hits: SearchHit[],
  query: string,
  region: string,
  opts: RerankOpts = {},
): Promise<RerankResult> {
  const env = loadEnv()
  const threshold = opts.threshold ?? env.RELEVANCE_THRESHOLD
  const maxToRerank = opts.maxToRerank ?? 50
  if (hits.length === 0) {
    return {
      hits: [], raw: 0, kept: 0, degraded: false, dropped: [],
      thresholdUsed: threshold, maxToRerankUsed: maxToRerank,
    }
  }
  // gov 源优先排到前面,确保 gov 总能上场
  const sorted = [...hits].sort((a, b) => {
    const aGov = a.source.kind === 'gov' ? 0 : 1
    const bGov = b.source.kind === 'gov' ? 0 : 1
    return aGov - bGov
  })
  const candidates = sorted.slice(0, maxToRerank)
  const overCap = sorted.slice(maxToRerank)
  const inferFn = opts.inferFn ?? infer

  let parsed: RerankOutput
  try {
    const userMsg = renderRerankUserMsg({
      query, region,
      hits: candidates.map((h, i) => ({
        idx: i,
        title: h.title,
        snippet: h.snippet ?? '',
        sourceLabel: h.source.name,
      })),
    })
    const resp = await inferFn({
      messages: [
        { role: 'system', content: NEWS_RELEVANCE_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      responseFormat: 'json_object',
    })
    const json = extractJson(resp.text)
    parsed = RerankOutputSchema.parse(json)
  } catch (err) {
    console.warn(`[rerank] LLM failed, fallback filter-only: ${(err as Error).message}`)
    return {
      hits: candidates, raw: candidates.length, kept: candidates.length, degraded: true,
      dropped: overCap.map((h) => ({ url: h.url, title: h.title, reason: 'over-cap' as const })),
      thresholdUsed: threshold, maxToRerankUsed: maxToRerank,
    }
  }

  const scoreByIdx = new Map<number, number>()
  for (const s of parsed.scores) scoreByIdx.set(s.idx, s.relevance)

  const scored = candidates.map((h, i) => ({ hit: h, score: scoreByIdx.get(i) ?? 0 }))
  const kept = scored.filter((s) => s.score >= threshold).sort((a, b) => b.score - a.score)
  const belowThreshold = scored.filter((s) => s.score < threshold)
  const dropped: DropEntry[] = [
    ...belowThreshold.map((s) => ({
      url: s.hit.url, title: s.hit.title, reason: 'below-threshold' as const,
      detail: `score=${s.score}`,
    })),
    ...overCap.map((h) => ({
      url: h.url, title: h.title, reason: 'over-cap' as const,
    })),
  ]
  return {
    hits: kept.map((s) => s.hit),
    raw: candidates.length,
    kept: kept.length,
    degraded: false,
    dropped,
    thresholdUsed: threshold,
    maxToRerankUsed: maxToRerank,
  }
}
