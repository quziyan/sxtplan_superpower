import { z } from 'zod'

export const NEWS_TRIAGE_SYSTEM = `
你是一个新闻情报分流 Agent,任务是判断一条新闻是否对某个预测目标提供有效信息增量。

预测目标的形式是 (车类, 任务类, 区域, 时段) 四元组。
你需要判断这条新闻是否暗示在该目标的时空范围内,该类车将出动执行该任务。

输出 JSON,包含:
- relevant: 是否相关(boolean)
- weight: 'HIGH' | 'MED' | 'LOW'(信号强度;不相关时仍需给一个值,通常 'LOW')
- reasoning: 1-2 段中文,说明判断依据
- extracted_signals: 关键信号短语数组,每条 ≤ 30 字

判断标准:
- HIGH: 新闻明确点名相关单位 / 车型 / 任务,且时间区域吻合
- MED: 新闻暗示相关行动,但具体细节(车型 / 单位 / 时间)模糊
- LOW: 新闻只在背景/语境层面相关,不直接证据

不要输出 markdown 围栏,只输出原始 JSON 对象。
`.trim()

export type NewsTriageInput = {
  prediction: {
    vehicleClass: string
    taskClass: string
    region: { name: string; adminChain: string }
    windowDate: string
    windowHalf: 'AM' | 'PM'
  }
  news: {
    sourceLabel: string
    sourceKind: 'mainstream' | 'gov' | 'social' | 'foreign'
    title: string
    summary: string
    publishedAt?: string
  }
}

export const NewsTriageOutputSchema = z.object({
  relevant: z.boolean(),
  weight: z.enum(['HIGH', 'MED', 'LOW']),
  reasoning: z.string().min(10),
  extracted_signals: z.array(z.string().max(60)),
})

export type NewsTriageOutput = z.infer<typeof NewsTriageOutputSchema>

export function renderNewsTriageUserMsg(input: NewsTriageInput): string {
  const { prediction: p, news: n } = input
  return `
预测目标:
- 车类: ${p.vehicleClass}
- 任务: ${p.taskClass}
- 区域: ${p.region.name}(${p.region.adminChain})
- 时段: ${p.windowDate} ${p.windowHalf === 'AM' ? '上午' : '下午'}

待评估新闻:
来源: ${n.sourceLabel}(${n.sourceKind})${n.publishedAt ? ` · ${n.publishedAt}` : ''}
标题: ${n.title}
摘要: ${n.summary}

请判断这条新闻是否对该预测目标提供信息增量,并输出 JSON。
`.trim()
}
