import { z } from 'zod'

export const NEWS_RELEVANCE_SYSTEM = `
你是一个新闻相关性评分 agent。给你一组待评估的中文新闻(已粗召回 +
规则过滤),配上一个查询主题(关键词 + 区域),你为每条新闻打 0-100
的相关性分。

评分尺度:
- 0-30:完全无关(主题不沾、地理无关、行业不对)
- 31-50:边缘相关(同行业但不同地理 / 间接联系)
- 51-70:相关(主题对、地理对、有信息价值但不直接谈本主题)
- 71-100:高度相关(直接报道本主题在该区域的活动)

输出 JSON 严格按下面 schema(数组顺序对齐输入顺序):
{
  "scores": [
    { "idx": 0, "relevance": 85, "reason": "广州交警在天河区集中查酒驾,直接吻合查询" },
    { "idx": 1, "relevance": 20, "reason": "北京交通局,地理不符" }
  ]
}

约束:
- idx 必须等于输入数组的下标
- relevance 是整数 0-100
- reason ≤ 30 字
- 不要输出 markdown 围栏,不要输出额外字段
`.trim()

export type RerankInput = {
  query: string
  region: string
  hits: Array<{ idx: number; title: string; snippet: string; sourceLabel: string }>
}

export const RerankOutputSchema = z.object({
  scores: z.array(z.object({
    idx: z.number().int().min(0),
    relevance: z.number().int().min(0).max(100),
    reason: z.string().max(60),
  })),
})

export type RerankOutput = z.infer<typeof RerankOutputSchema>

export function renderRerankUserMsg(input: RerankInput): string {
  const hitLines = input.hits
    .map((h) => `${h.idx}. [${h.sourceLabel}] ${h.title}\n   摘要: ${h.snippet.slice(0, 200)}`)
    .join('\n\n')
  return `查询主题: ${input.query}\n监视区域: ${input.region}\n\n待评分新闻:\n${hitLines}\n\n请输出每条新闻的相关性分数(JSON)。`
}
