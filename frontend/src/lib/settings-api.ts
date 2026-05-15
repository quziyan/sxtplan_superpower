import { api } from './api'

// 全局运行时设置 — pipeline 阈值三件套。

export async function getNewsFreshnessDays(): Promise<number> {
  const r = await api<{ value: number }>(`/settings/news-freshness-days`)
  return r.value
}

export async function setNewsFreshnessDays(value: number): Promise<{ ok: boolean; value: number }> {
  return api<{ ok: boolean; value: number }>(`/settings/news-freshness-days`, {
    method: 'PUT', body: JSON.stringify({ value }),
  })
}

export async function getNewsRelevanceThreshold(): Promise<number> {
  const r = await api<{ value: number }>(`/settings/news-relevance-threshold`)
  return r.value
}

export async function setNewsRelevanceThreshold(value: number): Promise<{ ok: boolean; value: number }> {
  return api<{ ok: boolean; value: number }>(`/settings/news-relevance-threshold`, {
    method: 'PUT', body: JSON.stringify({ value }),
  })
}

export async function getNewsMaxToRerank(): Promise<number> {
  const r = await api<{ value: number }>(`/settings/news-max-to-rerank`)
  return r.value
}

export async function setNewsMaxToRerank(value: number): Promise<{ ok: boolean; value: number }> {
  return api<{ ok: boolean; value: number }>(`/settings/news-max-to-rerank`, {
    method: 'PUT', body: JSON.stringify({ value }),
  })
}
