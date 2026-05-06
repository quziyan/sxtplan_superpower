import { describe, expect, test } from 'bun:test'
import { PredictionAgentOutputSchema, renderPredictionUserMsg } from '@/inference/prompts/prediction-agent'

describe('PredictionAgent prompt', () => {
  test('renders without past cases', () => {
    const msg = renderPredictionUserMsg({
      vehicleClass: '应急救援车', taskClass: '抢险救援',
      region: { name: '粤西沿海', adminChain: '中国/广东省/茂名市' },
      windowDate: '2026-05-11', windowHalf: 'AM',
      evidence: [{ id: 'n1', sourceLabel: '南方日报', sourceKind: 'mainstream', title: '台风消息', summary: '...' }],
    })
    expect(msg).toContain('粤西沿海')
    expect(msg).toContain('[n1]')
    expect(msg).toContain('(无历史)')
    expect(msg).toContain('上午')
  })

  test('renders with past cases', () => {
    const msg = renderPredictionUserMsg({
      vehicleClass: 'V', taskClass: 'T',
      region: { name: 'R', adminChain: 'C' },
      windowDate: '2026-05-15', windowHalf: 'PM',
      evidence: [],
      pastCases: [{ outcome: 'HIT', summary: 'past1', confidence: 80 }],
    })
    expect(msg).toContain('历史 HIT(预测 80)')
    expect(msg).toContain('下午')
  })

  test('schema rejects ci_low > confidence', () => {
    const r = PredictionAgentOutputSchema.safeParse({
      confidence: 50, ci_low: 60, ci_high: 70,
      reasoning: '足够长的理由说明，超过十个字符', evidence_ids: ['n1'], key_signals: ['signal'],
    })
    expect(r.success).toBe(false)
  })

  test('schema rejects confidence > ci_high', () => {
    const r = PredictionAgentOutputSchema.safeParse({
      confidence: 80, ci_low: 60, ci_high: 70,
      reasoning: '足够长的理由说明，超过十个字符', evidence_ids: ['n1'], key_signals: ['signal'],
    })
    expect(r.success).toBe(false)
  })

  test('schema accepts valid output', () => {
    const r = PredictionAgentOutputSchema.safeParse({
      confidence: 65, ci_low: 60, ci_high: 70,
      reasoning: '足够长的理由说明，超过十个字符', evidence_ids: ['n1'], key_signals: ['signal'],
    })
    expect(r.success).toBe(true)
  })

  test('schema rejects key_signals with > 60 chars', () => {
    const r = PredictionAgentOutputSchema.safeParse({
      confidence: 65, ci_low: 60, ci_high: 70,
      reasoning: '足够长的理由说明，超过十个字符', evidence_ids: ['n1'],
      key_signals: ['x'.repeat(61)],
    })
    expect(r.success).toBe(false)
  })

  test('schema accepts empty evidence_ids and key_signals', () => {
    const r = PredictionAgentOutputSchema.safeParse({
      confidence: 50, ci_low: 50, ci_high: 50,
      reasoning: '足够长的理由说明，超过十个字符', evidence_ids: [], key_signals: [],
    })
    expect(r.success).toBe(true)
  })
})
