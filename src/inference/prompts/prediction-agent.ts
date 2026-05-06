import { z } from 'zod'

export const PREDICTION_AGENT_SYSTEM = `
你是一个新闻情报分析 Agent,任务是基于一组新闻证据,评估在未来某天某时段(AM/PM),
某区域内,某类车辆为执行某任务而出动的概率。

输出 JSON,包含:
- confidence: 0-100 整数(出动概率)
- ci_low / ci_high: 0-100 整数(置信区间下/上界)
- reasoning: 1-3 段中文,解释判断依据
- evidence_ids: 引用的新闻 id 数组(从输入中选)
- key_signals: 决定性信号短语数组,每条 ≤ 30 字

不要输出 markdown 围栏,只输出原始 JSON 对象。
`.trim()

export type PredictionAgentInput = {
  vehicleClass: string
  taskClass: string
  region: { name: string; adminChain: string }
  windowDate: string
  windowHalf: 'AM' | 'PM'
  evidence: Array<{
    id: string
    sourceLabel: string
    sourceKind: 'mainstream' | 'gov' | 'social' | 'foreign'
    title: string
    summary: string
    publishedAt?: string
  }>
  pastCases?: Array<{
    outcome: 'HIT' | 'MISS' | 'NO_DATA'
    summary: string
    confidence: number
  }>
}

export const PredictionAgentOutputSchema = z.object({
  confidence: z.number().int().min(0).max(100),
  ci_low: z.number().int().min(0).max(100),
  ci_high: z.number().int().min(0).max(100),
  reasoning: z.string().min(10),
  evidence_ids: z.array(z.string()),
  key_signals: z.array(z.string().max(60)),
}).refine(d => d.ci_low <= d.confidence && d.confidence <= d.ci_high, {
  message: 'ci must satisfy ci_low ≤ confidence ≤ ci_high',
})

export type PredictionAgentOutput = z.infer<typeof PredictionAgentOutputSchema>

export function renderPredictionUserMsg(input: PredictionAgentInput): string {
  const evidenceBlock = input.evidence
    .map((e) => `[${e.id}] (${e.sourceLabel} · ${e.sourceKind}${e.publishedAt ? ` · ${e.publishedAt}` : ''}) ${e.title}\n  摘要: ${e.summary}`)
    .join('\n\n')
  const pastBlock = (input.pastCases ?? [])
    .map(c => `- 历史 ${c.outcome}(预测 ${c.confidence}):${c.summary}`)
    .join('\n') || '(无历史)'
  return `
预测目标:
- 车类: ${input.vehicleClass}
- 任务: ${input.taskClass}
- 区域: ${input.region.name}(${input.region.adminChain})
- 时段: ${input.windowDate} ${input.windowHalf === 'AM' ? '上午' : '下午'}

证据:
${evidenceBlock}

历史相似案例:
${pastBlock}

请评估并输出 JSON。
`.trim()
}
