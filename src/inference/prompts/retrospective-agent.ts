import { z } from 'zod'

export const RETROSPECTIVE_SYSTEM = `
你是一个新闻情报复盘 Agent,任务是基于一条预测 + 关联的新闻 + 摄像头实拍数据 + 分析师备注,
评估这条预测在事后的真实情况。

输出 JSON,包含两轴 outcome:
- prediction_outcome: 'HIT' | 'MISS' | 'NO_DATA'
  HIT — 新闻或实拍至少一方证实预测的出动确实发生
  MISS — 新闻反证 / 全无证据且综合判定未发生
  NO_DATA — 证据不足以判定
- capture_outcome: 'CAPTURED' | 'NOT_CAPTURED' | 'NOT_DISPATCHED' | 'UNKNOWN'
  CAPTURED — dispatch 成功且摄像头回传有目标 metadata
  NOT_CAPTURED — dispatch 完成但没拍到目标
  NOT_DISPATCHED — 该预测从未被批准
  UNKNOWN — adapter 失败 / 状态不明

约束:CAPTURED 必须对应 prediction_outcome=HIT。

四维匹配分(0-100):
- score_v / score_r / score_w / score_t:车类 / 区域 / 时段 / 任务 各自匹配度
- composite: 平均

字段:
- causal_md: markdown,1-3 段,关键证据 + 误判信源 + 漏读信号
- summary_md: 30 秒可读简报
- evidence_news_ids: 引用的 news.id(JSON 数组,例: ["abc","def"])
- key_signals: 决定性短语 ≤ 30 字(JSON 数组,例: ["治安巡逻","夜间集中"];不是用逗号分隔的字符串)
- composite: score_v/r/w/t 的整数平均(必须输出,不可省略)

输出格式样例(必须严格按这个 JSON 结构输出,数组就是 [],不是字符串):
{
  "prediction_outcome": "HIT",
  "capture_outcome": "CAPTURED",
  "score_v": 85, "score_r": 80, "score_w": 75, "score_t": 90,
  "composite": 82,
  "causal_md": "...",
  "summary_md": "...",
  "evidence_news_ids": ["news-id-1","news-id-2"],
  "key_signals": ["关键短语1","关键短语2"]
}

不要输出 markdown 围栏。
`.trim()

export type RetrospectiveInput = {
  prediction: {
    id: string
    vehicleClass: string
    taskClass: string
    region: { name: string }
    windowDate: string
    windowHalf: 'AM' | 'PM'
    confidenceFinal: number
  }
  news: Array<{
    id: string
    sourceLabel: string
    sourceKind: string
    title: string
    summary: string
    publishedAt?: string
  }>
  capture: Array<{
    dispatchId: string
    state: string
    mediaCount: number
    metadata?: object
  }>
  reviewerNotes?: string
}

/**
 * 防御性预处理:LLM 偶尔会
 *   ① 把 key_signals 写成逗号/分号/换行分隔的字符串(应是数组)
 *   ② 漏掉 composite(应取四维平均)
 *   ③ evidence_news_ids 同①写成字符串
 * 这里在 zod parse 前先 coerce,失败再 throw。
 */
function splitToArray(s: unknown): unknown {
  if (typeof s !== 'string') return s
  return s.split(/[,;\n、，；]+/).map(t => t.trim()).filter(t => t.length > 0)
}

export const RetrospectiveOutputSchema = z.preprocess(
  (raw) => {
    if (raw === null || typeof raw !== 'object') return raw
    const o = { ...(raw as Record<string, unknown>) }
    // ① key_signals 字符串 → 数组
    if (typeof o.key_signals === 'string') o.key_signals = splitToArray(o.key_signals)
    // ② evidence_news_ids 字符串 → 数组
    if (typeof o.evidence_news_ids === 'string') o.evidence_news_ids = splitToArray(o.evidence_news_ids)
    // ③ composite 缺失但四个 score 都在 → 取整数平均
    if (typeof o.composite !== 'number') {
      const sv = o.score_v, sr = o.score_r, sw = o.score_w, st = o.score_t
      if ([sv, sr, sw, st].every(x => typeof x === 'number')) {
        o.composite = Math.round(((sv as number) + (sr as number) + (sw as number) + (st as number)) / 4)
      }
    }
    return o
  },
  z.object({
    prediction_outcome: z.enum(['HIT', 'MISS', 'NO_DATA']),
    capture_outcome: z.enum(['CAPTURED', 'NOT_CAPTURED', 'NOT_DISPATCHED', 'UNKNOWN']),
    score_v: z.number().int().min(0).max(100),
    score_r: z.number().int().min(0).max(100),
    score_w: z.number().int().min(0).max(100),
    score_t: z.number().int().min(0).max(100),
    composite: z.number().int().min(0).max(100),
    causal_md: z.string().min(20),
    summary_md: z.string().min(10),
    evidence_news_ids: z.array(z.string()),
    key_signals: z.array(z.string().max(60)),
  }).refine((o) => !(o.capture_outcome === 'CAPTURED' && o.prediction_outcome !== 'HIT'), {
    message: 'CAPTURED implies prediction_outcome=HIT',
  }),
)

export type RetrospectiveOutput = z.infer<typeof RetrospectiveOutputSchema>

export function renderRetrospectiveUserMsg(input: RetrospectiveInput): string {
  const { prediction: p } = input

  const newsBlock =
    input.news.length === 0
      ? '(无相关新闻)'
      : input.news
          .map(
            (n, i) =>
              `${i + 1}. [${n.id}] (${n.sourceLabel} · ${n.sourceKind}${n.publishedAt ? ` · ${n.publishedAt}` : ''}) ${n.title}\n   摘要: ${n.summary}`,
          )
          .join('\n\n')

  const captureBlock =
    input.capture.length === 0
      ? '(无回传数据)'
      : input.capture
          .map((c) => {
            const meta = c.metadata ? `\n   metadata: ${JSON.stringify(c.metadata)}` : ''
            return `- dispatch ${c.dispatchId}: state=${c.state}, mediaCount=${c.mediaCount}${meta}`
          })
          .join('\n')

  const notesBlock =
    input.reviewerNotes && input.reviewerNotes.trim().length > 0
      ? `\n分析师备注:\n${input.reviewerNotes}\n`
      : ''

  return `
预测 ${p.id}:
- 车类: ${p.vehicleClass}
- 任务: ${p.taskClass}
- 区域: ${p.region.name}
- 时段: ${p.windowDate} ${p.windowHalf === 'AM' ? '上午' : '下午'}
- 最终置信度: ${p.confidenceFinal}

关联新闻:
${newsBlock}

摄像头回传:
${captureBlock}
${notesBlock}
请输出严格符合 schema 的 JSON,不要 markdown 围栏。
`.trim()
}
