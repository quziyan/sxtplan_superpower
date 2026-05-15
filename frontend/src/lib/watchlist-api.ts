import { api } from './api'

export type WatchList = {
  id: string
  name: string
  description: string | null
  vehicleClassId: string
  taskClassId: string
  regionId: string
  regionVersion: number
  kRangeMin: number
  kRangeMax: number
  /** 显式覆盖的搜索关键词。空数组 = 走 V/T/region 派生 fallback。 */
  keywords: string[]
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type CreateWatchListBody = {
  name: string
  description?: string
  // Plan-PP fix:V/T/R/regionVersion 全可选;后端「通用」兜底
  vehicleClassId?: string
  taskClassId?: string
  regionId?: string
  regionVersion?: number
  kRangeMin?: number
  kRangeMax?: number
  keywords?: string[]
}

export async function listWatchLists(activeOnly = false): Promise<WatchList[]> {
  return api<WatchList[]>(`/watchlists${activeOnly ? '?active=true' : ''}`)
}

export async function createWatchList(body: CreateWatchListBody): Promise<WatchList> {
  return api<WatchList>('/watchlists', { method: 'POST', body: JSON.stringify(body) })
}

export async function setWatchListActive(id: string, isActive: boolean): Promise<WatchList> {
  return api<WatchList>(`/watchlists/${id}/active`, {
    method: 'PATCH', body: JSON.stringify({ isActive }),
  })
}

export async function updateWatchListKeywords(id: string, keywords: string[]): Promise<WatchList> {
  return api<WatchList>(`/watchlists/${id}/keywords`, {
    method: 'PATCH', body: JSON.stringify({ keywords }),
  })
}

export async function updateWatchListName(id: string, name: string): Promise<WatchList> {
  return api<WatchList>(`/watchlists/${id}/name`, {
    method: 'PATCH', body: JSON.stringify({ name }),
  })
}

export type DeleteWatchListResp =
  | { ok: true; id: string; predictionCount: number }
  | { error: { code: string; message: string }; predictionCount: number }

export async function deleteWatchList(id: string, cascade = false): Promise<DeleteWatchListResp> {
  return api<DeleteWatchListResp>(`/watchlists/${id}${cascade ? '?cascade=true' : ''}`, { method: 'DELETE' })
}

/** 后端返回该 watchlist 实际生效的关键词:explicit 非空 → explicit;否则 → 派生 fallback。 */
export type ResolvedKeywords = {
  explicit: string[]
  derived: string[]
  resolved: string[]
  source: 'explicit' | 'derived'
}

export async function getResolvedKeywords(id: string): Promise<ResolvedKeywords> {
  return api<ResolvedKeywords>(`/watchlists/${id}/resolved-keywords`)
}
