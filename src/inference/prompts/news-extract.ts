import { z } from 'zod'

/**
 * news-to-prediction extractor 的 LLM 系统提示。
 *
 * 输入:1 条新闻(title + summary + sourceLabel + publishedAt)+ 当前所有
 *       active watchlist 的 (id, V 名, T 名, region 名, kRangeMin..Max) 列表。
 *
 * 任务:对每条 watchlist,判断这条新闻是否「预示该 (V, T, region) 在未来
 *       某窗口会被调度」。若是 → 输出推断窗口日期 + 半天 + 初始置信度
 *       + 推理。批量决策一次 LLM call。
 *
 * 关键:
 *  - 不是匹配新闻是否「相关」(那是 triage 的事)
 *  - 而是预言「该新闻表明未来会发生该 (V, T, region) 的活动」
 *  - 例:广东省政府宣布五一安保动员 + watchlist 是「广州天河治安巡逻车」→
 *       提取出「天河区治安巡逻车 5/1-5/3 AM 高置信度」
 *  - windowDate 必须在 today..today+kRangeMax 范围内
 *  - 不 actionable 的 watchlist 不要出现在输出里(空数组合法)
 */
export const NEWS_EXTRACT_SYSTEM = `
你是一个从中文新闻中提取「未来调度预测」的 agent。

输入:1 条新闻 + 一组监视清单(每个 watchlist 是一个 (车类 V, 任务 T, 区域 R) 元组,
配 K 天窗口范围)。

任务:对每个 watchlist,判断这条新闻是否预示「该 (V, T, R) 在未来某窗口会被调度」。
若 actionable=true,输出:
  - watchlistId: 监视清单 ID(必须 idx 关联回输入)
  - windowDate: 预测调度发生日 (YYYY-MM-DD,必须在 today..today+kRangeMax)
  - windowHalf: 'AM' | 'PM'
  - confidence: 0-100(初始置信度,基于该新闻信号强度)
  - reasoning: ≤ 80 字,引用新闻关键句子说明推断依据

输出 JSON:
{
  "extracted": [
    {
      "watchlistId": "uuid",
      "windowDate": "2026-05-15",
      "windowHalf": "AM",
      "confidence": 75,
      "reasoning": "新闻称广东省启动五一安保动员,天河区作为重点应重点部署巡逻车..."
    }
  ]
}

规则:
- 没有任一 watchlist actionable → 输出 { "extracted": [] }
- 一条新闻可同时 actionable 多个 watchlist
- confidence 评分尺度:0-30 弱信号(只是间接关联)/ 31-60 中等(明确提及主题)/
  61-100 强信号(直接报道该 V/T 在该 R 的具体行动)
- windowDate 选择策略:
    新闻明确说 "明天" / "5 月 1 日" / "下周" → 按那天
    新闻只说 "近期" / 不明 → 默认 today + 3 天
    永远不超 today + kRangeMax
- 不要输出 markdown 围栏。不要输出 extracted 之外的字段。
`.trim()

export type ExtractInput = {
  news: {
    id: string
    title: string
    summary: string
    sourceLabel: string
    publishedAt?: string
  }
  watchlists: Array<{
    id: string
    vehicleClass: string
    taskClass: string
    regionName: string
    kRangeMin: number
    kRangeMax: number
  }>
  today: string  // YYYY-MM-DD;让 LLM 知道当前日期来推断窗口
}

export const ExtractOutputSchema = z.object({
  extracted: z.array(z.object({
    watchlistId: z.string().min(1),
    windowDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    windowHalf: z.enum(['AM', 'PM']),
    confidence: z.number().int().min(0).max(100),
    reasoning: z.string().min(5).max(200),
  })),
})

export type ExtractOutput = z.infer<typeof ExtractOutputSchema>

export function renderExtractUserMsg(input: ExtractInput): string {
  const wlBlock = input.watchlists
    .map((wl) =>
      `- watchlistId: ${wl.id}\n` +
      `  车类: ${wl.vehicleClass}\n` +
      `  任务: ${wl.taskClass}\n` +
      `  区域: ${wl.regionName}\n` +
      `  K 天范围: ${wl.kRangeMin}-${wl.kRangeMax} 天`,
    )
    .join('\n\n')
  const pubLine = input.news.publishedAt ? `\n发布时间: ${input.news.publishedAt}` : ''
  return `今天日期: ${input.today}

新闻:
标题: ${input.news.title}
来源: ${input.news.sourceLabel}${pubLine}
摘要: ${input.news.summary}

监视清单(${input.watchlists.length} 个):
${wlBlock}

请按 schema 输出 JSON,只列 actionable 的 watchlist。`
}
