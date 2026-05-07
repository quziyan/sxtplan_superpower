import { describe, expect, test } from 'bun:test'
import {
  RetrospectiveOutputSchema,
  renderRetrospectiveUserMsg,
  type RetrospectiveInput,
} from '@/inference/prompts/retrospective-agent'

const validBase = {
  prediction_outcome: 'HIT' as const,
  capture_outcome: 'CAPTURED' as const,
  score_v: 80,
  score_r: 75,
  score_w: 70,
  score_t: 85,
  composite: 78,
  causal_md: '关键证据来自南方日报通稿,实拍 metadata 显示目标车辆。',
  summary_md: '预测命中,实拍成功。',
  evidence_news_ids: ['n1', 'n2'],
  key_signals: ['通稿点名出动', '实拍 metadata 命中'],
}

const baseInput: RetrospectiveInput = {
  prediction: {
    id: 'pred-001',
    vehicleClass: '应急救援车',
    taskClass: '抢险救援',
    region: { name: '粤西沿海' },
    windowDate: '2026-05-11',
    windowHalf: 'AM',
    confidenceFinal: 72,
  },
  news: [
    {
      id: 'n1',
      sourceLabel: '南方日报',
      sourceKind: 'mainstream',
      title: '台风登陆茂名',
      summary: '应急救援车队已出动',
      publishedAt: '2026-05-11T07:00:00Z',
    },
    {
      id: 'n2',
      sourceLabel: '应急管理部',
      sourceKind: 'gov',
      title: '部署抢险救援',
      summary: '组织队伍奔赴一线',
    },
  ],
  capture: [
    { dispatchId: 'd-1', state: 'COMPLETED', mediaCount: 4, metadata: { vehicles: 3 } },
  ],
}

describe('RetrospectiveAgent prompt', () => {
  test('schema accepts a valid HIT/CAPTURED output', () => {
    const r = RetrospectiveOutputSchema.safeParse(validBase)
    expect(r.success).toBe(true)
  })

  test('schema rejects MISS+CAPTURED (refine rule)', () => {
    const r = RetrospectiveOutputSchema.safeParse({
      ...validBase,
      prediction_outcome: 'MISS',
      capture_outcome: 'CAPTURED',
    })
    expect(r.success).toBe(false)
  })

  test('schema rejects NO_DATA+CAPTURED (CAPTURED requires HIT)', () => {
    const r = RetrospectiveOutputSchema.safeParse({
      ...validBase,
      prediction_outcome: 'NO_DATA',
      capture_outcome: 'CAPTURED',
    })
    expect(r.success).toBe(false)
  })

  test('schema accepts MISS+NOT_DISPATCHED', () => {
    const r = RetrospectiveOutputSchema.safeParse({
      ...validBase,
      prediction_outcome: 'MISS',
      capture_outcome: 'NOT_DISPATCHED',
    })
    expect(r.success).toBe(true)
  })

  test('schema rejects score out of [0..100]', () => {
    const r = RetrospectiveOutputSchema.safeParse({ ...validBase, score_v: 101 })
    expect(r.success).toBe(false)
    const r2 = RetrospectiveOutputSchema.safeParse({ ...validBase, score_r: -1 })
    expect(r2.success).toBe(false)
  })

  test('schema rejects causal_md shorter than 20 chars', () => {
    const r = RetrospectiveOutputSchema.safeParse({ ...validBase, causal_md: '太短了' })
    expect(r.success).toBe(false)
  })

  test('schema rejects key_signals item longer than 60 chars', () => {
    const r = RetrospectiveOutputSchema.safeParse({
      ...validBase,
      key_signals: ['x'.repeat(61)],
    })
    expect(r.success).toBe(false)
  })

  test('renderRetrospectiveUserMsg produces non-empty string with prediction id, news titles, capture state', () => {
    const msg = renderRetrospectiveUserMsg(baseInput)
    expect(msg.length).toBeGreaterThan(0)
    expect(msg).toContain('pred-001')
    expect(msg).toContain('台风登陆茂名')
    expect(msg).toContain('部署抢险救援')
    expect(msg).toContain('COMPLETED')
    expect(msg).toContain('粤西沿海')
    expect(msg).toContain('上午')
  })

  test('empty news/capture arrays — render still succeeds and includes placeholders', () => {
    const msg = renderRetrospectiveUserMsg({
      ...baseInput,
      news: [],
      capture: [],
    })
    expect(msg).toContain('(无相关新闻)')
    expect(msg).toContain('(无回传数据)')
    expect(msg).toContain('pred-001')
  })

  test('reviewerNotes included when present, omitted when undefined', () => {
    const withNotes = renderRetrospectiveUserMsg({
      ...baseInput,
      reviewerNotes: '现场分析师确认目标车辆型号与摄像头实拍一致。',
    })
    expect(withNotes).toContain('分析师备注')
    expect(withNotes).toContain('现场分析师确认目标车辆型号与摄像头实拍一致。')

    const withoutNotes = renderRetrospectiveUserMsg(baseInput)
    expect(withoutNotes).not.toContain('分析师备注')
  })
})
