import { api } from './api'

// Lightweight summary for region pickers (NewWatchListModal, etc.).
// Backend default returns ADMIN_NAMED current-effective only; pass kind='ALL'
// to also include AD_HOC. Pickers nearly always want NAMED so we default to it.
export type RegionListItem = {
  id: string
  kind: 'ADMIN_NAMED' | 'AD_HOC'
  name: string | null
  version: number
}

export async function listRegions(opts: { kind?: 'ADMIN_NAMED' | 'AD_HOC' | 'ALL' } = {}): Promise<RegionListItem[]> {
  const kind = opts.kind ?? 'ADMIN_NAMED'
  const qs = kind === 'ADMIN_NAMED' ? '' : `?kind=${kind}`
  return api<RegionListItem[]>(`/regions${qs}`)
}

// 完整 Region(含 geom GeoJSON Polygon)— 用于 RegionMapModal 渲染 polygon
export type RegionDetail = {
  id: string
  kind: 'ADMIN_NAMED' | 'AD_HOC'
  name: string | null
  parentId: string | null
  version: number
  effectiveFrom: string
  geom: { type: 'Polygon'; coordinates: number[][][] }
  createdBy: string | null
  createdAt: string
}

export async function getRegion(id: string, version?: number): Promise<RegionDetail> {
  const qs = version !== undefined ? `?version=${version}` : ''
  return api<RegionDetail>(`/regions/${id}${qs}`)
}
