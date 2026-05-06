import { describe, expect, test } from 'bun:test'
import { NewsTriageOutputSchema, renderNewsTriageUserMsg } from '@/inference/prompts/news-triage-agent'

describe('NewsTriage prompt', () => {
  test('renders with all fields', () => {
    const msg = renderNewsTriageUserMsg({
      prediction: {
        vehicleClass: '应急救援车', taskClass: '抢险救援',
        region: { name: '粤西沿海', adminChain: '中国/广东省/茂名市' },
        windowDate: '2026-05-11', windowHalf: 'AM',
      },
      news: {
        sourceLabel: '南方日报', sourceKind: 'mainstream',
        title: '海葵逼近粤西', summary: '茂名启动 II 级应急响应',
        publishedAt: '2026-05-04',
      },
    })
    expect(msg).toContain('粤西沿海')
    expect(msg).toContain('海葵逼近粤西')
    expect(msg).toContain('上午')
  })

  test('renders without publishedAt', () => {
    const msg = renderNewsTriageUserMsg({
      prediction: {
        vehicleClass: 'V', taskClass: 'T',
        region: { name: 'R', adminChain: 'C' },
        windowDate: '2026-05-15', windowHalf: 'PM',
      },
      news: { sourceLabel: 'X', sourceKind: 'gov', title: 'title', summary: 'summary' },
    })
    expect(msg).toContain('下午')
    expect(msg).not.toContain('undefined')
  })

  test('schema accepts HIGH', () => {
    const r = NewsTriageOutputSchema.safeParse({
      relevant: true, weight: 'HIGH',
      reasoning: '充分理由解释判定依据,超过十字',
      extracted_signals: ['台风登陆确认', '应急响应启动'],
    })
    expect(r.success).toBe(true)
  })

  test('schema rejects unknown weight', () => {
    const r = NewsTriageOutputSchema.safeParse({
      relevant: true, weight: 'OK',
      reasoning: '充分理由解释判定依据,超过十字',
      extracted_signals: [],
    })
    expect(r.success).toBe(false)
  })

  test('schema rejects signal > 60 chars', () => {
    const r = NewsTriageOutputSchema.safeParse({
      relevant: true, weight: 'MED',
      reasoning: '充分理由解释判定依据,超过十字',
      extracted_signals: ['x'.repeat(61)],
    })
    expect(r.success).toBe(false)
  })

  test('schema accepts irrelevant with LOW', () => {
    const r = NewsTriageOutputSchema.safeParse({
      relevant: false, weight: 'LOW',
      reasoning: '与目标无关,只是背景报道,超过十个字符啦',
      extracted_signals: [],
    })
    expect(r.success).toBe(true)
  })
})
