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

输入:
  - 1 条新闻
  - **候选车类列表(follows)**:用户关注的车辆类型集合 — 预测必须从这里选 V
  - 一组监视清单(每个 watchlist 提供任务 T + 区域 R + 关键词 lens)

任务:对每条 (watchlist × 候选 V) 的组合,判断这条新闻是否预示「该 V 在 watchlist.R
执行 watchlist.T 在未来某窗口被调度」。一条新闻可输出多条 prediction(不同 V、不同
windowDate)。

输出 JSON:
{
  "extracted": [
    {
      "watchlistId": "uuid",
      "vehicleClassId": "uuid",       // 必须来自 follows 列表
      "windowDate": "2026-05-15",
      "windowHalf": "AM",
      "confidence": 75,
      "reasoning": "新闻称广东省启动五一安保动员,天河区作为重点应重点部署巡逻车...",
      "locationFine": "广东奥体中心",      // POI 级具体地名,从新闻原文抽取;不确定就留空
      "locationDistrict": "广州市天河区"     // 行政区级,精确到 街道/镇 更佳;不确定就留空
    }
  ]
}

规则:
- 没有任一组合 actionable → 输出 { "extracted": [] }
- 一条新闻可同时产出多条预测(不同 V、不同 windowDate、不同 watchlist 都允许)
- **vehicleClassId 必须 ∈ follows 列表**;不在列表里的 V 不可输出
- **新闻必须真有「事件性」描述**(具体行动、具体时间、具体地点) — 仅仅是政策性
  会议、笼统报道等不构成 prediction;返空数组
- confidence 评分尺度:
    0-30 弱信号(关键词只是间接关联)
    31-60 中等(新闻明确提及关键词主题,但调度未明确)
    61-100 强信号(直接报道该 V 在该 R 的具体行动/事件即将发生)
- windowDate 选择策略:
    新闻明确说 "明天" / "5 月 1 日" / "下周" → 按那天
    新闻只说 "近期" / 不明 → 默认 today + 3 天
    永远不超 today + kRangeMax
    **windowDate 必须 ≥ today,绝不能早于今天**(预测是面向未来的事件,过去的事件不要输出)
    若新闻描述的事件已发生(发布时间 < today 且事件就是发布当时)→ 不要输出该 prediction
- locationFine / locationDistrict 必须**从新闻原文**抽取(不要凭空猜),抽不到就留空
- locationFine 是 POI 级最具体的位置:体育场/学校/广场/景区/路口/酒店等(例:"广东奥体中心"、"白云国际机场 T2")
- locationDistrict 是行政区:精度排序 → 街道 > 区 > 市(例:"广州市天河区天河南街道")
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
  /** Plan-PP:用户关注的候选 V 列表 — LLM 只能从这里选 vehicleClassId。 */
  follows: Array<{ id: string; name: string }>
  watchlists: Array<{
    id: string
    taskClass: string
    regionName: string
    kRangeMin: number
    kRangeMax: number
    keywords?: string[]
  }>
  today: string  // YYYY-MM-DD;让 LLM 知道当前日期来推断窗口
}

export const ExtractOutputSchema = z.object({
  extracted: z.array(z.object({
    watchlistId: z.string().min(1),
    vehicleClassId: z.string().uuid(),
    windowDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    windowHalf: z.enum(['AM', 'PM']),
    confidence: z.number().int().min(0).max(100),
    reasoning: z.string().min(5).max(200),
    // Plan-PP fix9:LLM 从新闻原文抽取最具体的地点 + 行政区粒度,
    // 用于精确定位预测区域(替代 wl 的"通用区域")。
    locationFine: z.string().min(1).max(80).optional(),     // POI 级:"广东奥体中心" / "广州塔下"
    locationDistrict: z.string().min(1).max(40).optional(), // 行政区:"广州市天河区" / "海珠区赤岗街道"
  })),
})

export type ExtractOutput = z.infer<typeof ExtractOutputSchema>

export function renderExtractUserMsg(input: ExtractInput): string {
  const followsBlock = input.follows
    .map((f) => `- vehicleClassId: ${f.id} · 名称: ${f.name}`)
    .join('\n')
  const wlBlock = input.watchlists
    .map((wl) => {
      const lines = [
        `- watchlistId: ${wl.id}`,
        `  任务: ${wl.taskClass}`,
        `  区域: ${wl.regionName}`,
      ]
      if (wl.keywords && wl.keywords.length > 0) {
        lines.push(`  关键词(语义 lens): ${wl.keywords.join(', ')}`)
      }
      lines.push(`  K 天范围: ${wl.kRangeMin}-${wl.kRangeMax} 天`)
      return lines.join('\n')
    })
    .join('\n\n')
  const pubLine = input.news.publishedAt ? `\n发布时间: ${input.news.publishedAt}` : ''
  return `今天日期: ${input.today}

新闻:
标题: ${input.news.title}
来源: ${input.news.sourceLabel}${pubLine}
摘要: ${input.news.summary}

候选车类(${input.follows.length} 个,vehicleClassId 必须从这里选):
${followsBlock}

监视清单(${input.watchlists.length} 个,提供 T/R/keywords lens):
${wlBlock}

请按 schema 输出 JSON,只列 actionable 的 (watchlist, vehicleClass) 组合。`
}
