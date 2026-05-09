import { api } from './api'

// 全局运行时设置 — 当前只有 news_freshness_days,后续 key 加在这里。

export async function getNewsFreshnessDays(): Promise<number> {
  const r = await api<{ value: number }>(`/settings/news-freshness-days`)
  return r.value
}

export async function setNewsFreshnessDays(value: number): Promise<{ ok: boolean; value: number }> {
  return api<{ ok: boolean; value: number }>(`/settings/news-freshness-days`, {
    method: 'PUT', body: JSON.stringify({ value }),
  })
}
