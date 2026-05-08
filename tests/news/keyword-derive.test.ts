import { describe, expect, test } from 'bun:test'
import { deriveKeywordsForWatchlist, resolveKeywords } from '@/news/keyword-derive'
import type { WatchList } from '@/db/schema/watchlist'

const baseWl = (overrides: Partial<WatchList> = {}): WatchList => ({
  id: '00000000-0000-0000-0000-000000000001',
  name: 'wl',
  description: null,
  vehicleClassId: '00000000-0000-0000-0000-000000000002',
  taskClassId: '00000000-0000-0000-0000-000000000003',
  regionId: '00000000-0000-0000-0000-000000000004',
  regionVersion: 1,
  kRangeMin: 1,
  kRangeMax: 14,
  isActive: true,
  keywords: [],
  createdBy: '00000000-0000-0000-0000-000000000005',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
}) as WatchList

describe('keyword-derive', () => {
  test('deriveKeywordsForWatchlist: V/T/region 三项 + 去重 + trim', () => {
    const out = deriveKeywordsForWatchlist(
      baseWl(),
      { id: 'x', code: 'VC', name: '巡逻警车' } as any,
      { id: 'y', code: 'TC', name: '治安巡逻' } as any,
      { name: '越秀区' },
    )
    expect(out).toEqual(['巡逻警车', '治安巡逻', '越秀区'])
  })

  test('deriveKeywordsForWatchlist: 区域名 null → 跳过', () => {
    const out = deriveKeywordsForWatchlist(
      baseWl(),
      { id: 'x', code: 'VC', name: 'A' } as any,
      { id: 'y', code: 'TC', name: 'B' } as any,
      { name: null },
    )
    expect(out).toEqual(['A', 'B'])
  })

  test('deriveKeywordsForWatchlist: 重复 V=T 名 → 去重', () => {
    const out = deriveKeywordsForWatchlist(
      baseWl(),
      { id: 'x', code: 'VC', name: '巡逻' } as any,
      { id: 'y', code: 'TC', name: '巡逻' } as any,
      { name: '广州' },
    )
    expect(out).toEqual(['巡逻', '广州'])
  })

  test('resolveKeywords: 显式 keywords 非空 → 用之', () => {
    const out = resolveKeywords(
      baseWl({ keywords: ['防暴', '安保'] }),
      { id: 'x', code: 'VC', name: '巡逻警车' } as any,
      { id: 'y', code: 'TC', name: '治安巡逻' } as any,
      { name: '越秀区' },
    )
    expect(out).toEqual(['防暴', '安保'])
  })

  test('resolveKeywords: 显式 keywords 空 → 降级派生', () => {
    const out = resolveKeywords(
      baseWl({ keywords: [] }),
      { id: 'x', code: 'VC', name: '巡逻警车' } as any,
      { id: 'y', code: 'TC', name: '治安巡逻' } as any,
      { name: '越秀区' },
    )
    expect(out).toEqual(['巡逻警车', '治安巡逻', '越秀区'])
  })

  test('resolveKeywords: 显式 keywords 空字符串 → 过滤', () => {
    const out = resolveKeywords(
      baseWl({ keywords: ['', '  ', '安保'] }),
      { id: 'x', code: 'VC', name: 'V' } as any,
      { id: 'y', code: 'TC', name: 'T' } as any,
      { name: 'R' },
    )
    expect(out).toEqual(['安保'])
  })
})
